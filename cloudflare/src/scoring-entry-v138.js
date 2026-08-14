import portal from './scoring-entry-v137.js';

const PRIMARY_ALLIANCE = 'WDZ';
const DAY_META = [
  { dayIndex: 1, name: 'Tank Day', short: 'Tank', weight: 1 },
  { dayIndex: 2, name: 'Build Day', short: 'Build', weight: 2 },
  { dayIndex: 3, name: 'Science Day', short: 'Science', weight: 2 },
  { dayIndex: 4, name: 'Hero Day', short: 'Hero', weight: 2 },
  { dayIndex: 5, name: 'Training Day', short: 'Training', weight: 2 },
  { dayIndex: 6, name: 'Enemy Buster', short: 'Enemy Buster', weight: 4 },
];
const TOTAL_DAY_WEIGHT = DAY_META.reduce((sum, day) => sum + day.weight, 0);
const WEEK_WIN_THRESHOLD = Math.floor(TOTAL_DAY_WEIGHT / 2) + 1;
const DEFAULT_DAILY_MINIMUM = 6_000_000;
const DEFAULT_MINIMUM_RANKED_WEEKS = 3;
const DEFAULT_BYE_WEIGHT = 0.35;
const DEFAULT_SECURED_WEEK_WEIGHT = 0.35;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/participation' && request.method === 'GET') {
      const gate = await requireUser(request, env, ctx);
      if (gate) return gate;
      return handleDuelLeaderboard(env);
    }

    if (url.pathname === '/api/scoring-guide' && request.method === 'GET') {
      const gate = await requireUser(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await duelGuide(env)) });
    }

    if (url.pathname === '/api/admin/scoring-model' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await duelGuide(env)) });
    }

    if (url.pathname === '/api/admin/scoring-model' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return updateDuelSettings(request, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireUser(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function handleDuelLeaderboard(env) {
  const latest = await env.DB.prepare(`
    SELECT cycle_id, MAX(captured_at) AS latest_capture
    FROM duel_daily
    GROUP BY cycle_id
    ORDER BY latest_capture DESC
    LIMIT 1
  `).first();
  const cycleId = String(latest?.cycle_id || '');
  const settings = await duelSettings(env);

  if (!cycleId) {
    return json({
      ok: true,
      cycleId: '',
      players: [],
      availability: { alliance_duel: false, state_ruler: false, glory_war: false },
      weights: [{ eventType: 'alliance_duel', label: 'Alliance Duel', weight: 1, enabled: true }],
      settings,
      method: duelMethodCopy(settings),
      dayWeights: DAY_META,
      totalDayWeight: TOTAL_DAY_WEIGHT,
    });
  }

  const [playersResult, dailyResult, policyResult, leaveResult, resultResult, overrideResult] = await Promise.all([
    env.DB.prepare(`
      SELECT uid,public_id,current_name,alliance_abbr,server_id
      FROM players
      WHERE alliance_abbr=?
    `).bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all(),
    env.DB.prepare(`
      SELECT cycle_week,day_index,uid,score,captured_at
      FROM duel_daily
      WHERE cycle_id=?
      ORDER BY cycle_week,day_index
    `).bind(cycleId).all(),
    env.DB.prepare(`
      SELECT cycle_week,is_bye,weight_multiplier
      FROM event_week_policy
      WHERE event_type='alliance_duel' AND cycle_id=?
    `).bind(cycleId).all(),
    env.DB.prepare(`
      SELECT cycle_week,uid,status
      FROM player_week_leave
      WHERE cycle_id=? AND status='away'
    `).bind(cycleId).all(),
    env.DB.prepare(`
      SELECT cycle_week,day_index,is_win,alliance_score,opponent_score,captured_at
      FROM duel_results
      WHERE cycle_id=?
      ORDER BY cycle_week,day_index
    `).bind(cycleId).all(),
    env.DB.prepare(`
      SELECT cycle_week,day_index,is_win,source,updated_at
      FROM duel_day_outcome_override
      WHERE cycle_id=?
      ORDER BY cycle_week,day_index
    `).bind(cycleId).all(),
  ]);

  const weeks = buildWeeks(dailyResult.results || []);
  const policies = new Map((policyResult.results || []).map(row => [Number(row.cycle_week), {
    isBye: Number(row.is_bye || 0) === 1,
    multiplier: Math.max(0, finite(row.weight_multiplier, 1)),
  }]));
  const away = new Set((leaveResult.results || []).map(row => `${String(row.uid)}|${Number(row.cycle_week)}`));
  const outcomes = buildWeekOutcomes(resultResult.results || [], overrideResult.results || []);
  const cycleComplete = Boolean(weeks.get(4)?.days.has(6));

  const players = (playersResult.results || []).map(player => {
    const uid = String(player.uid);
    const duel = scorePlayerDuel(uid, weeks, policies, away, outcomes, settings);
    const qualified = !cycleComplete || duel.playedWeeks >= settings.minimumRankedDuelWeeks;
    return {
      publicId: String(player.public_id || ''),
      name: String(player.current_name || ''),
      allianceAbbr: String(player.alliance_abbr || ''),
      serverId: Number(player.server_id || 0),
      score: duel.weightedAverage,
      components: {
        alliance_duel: {
          ...duel,
          index: duel.weightedAverage,
        },
        state_ruler: { raw: 0, index: 0, weeks: 0 },
        glory_war: { raw: 0, index: 0, weeks: 0 },
      },
      minimumDaysHit: duel.minimumDaysHit,
      minimumDaysAvailable: duel.minimumDaysAvailable,
      qualification: {
        qualified,
        finalCheckActive: cycleComplete,
        playedDuelWeeks: duel.playedWeeks,
        requiredDuelWeeks: settings.minimumRankedDuelWeeks,
      },
    };
  });

  players.sort((a, b) => {
    if (cycleComplete && a.qualification.qualified !== b.qualification.qualified) return a.qualification.qualified ? -1 : 1;
    return Number(b.score || 0) - Number(a.score || 0)
      || Number(b.components.alliance_duel.consistencyPercent || 0) - Number(a.components.alliance_duel.consistencyPercent || 0)
      || Number(b.components.alliance_duel.eligibleRaw || 0) - Number(a.components.alliance_duel.eligibleRaw || 0)
      || a.name.localeCompare(b.name);
  });
  players.forEach((row, index) => { row.rank = index + 1; });

  return json({
    ok: true,
    cycleId,
    players,
    availability: { alliance_duel: true, state_ruler: false, glory_war: false },
    weights: [{ eventType: 'alliance_duel', label: 'Alliance Duel', weight: 1, enabled: true }],
    settings,
    dayWeights: DAY_META,
    totalDayWeight: TOTAL_DAY_WEIGHT,
    weekWinThreshold: WEEK_WIN_THRESHOLD,
    method: duelMethodCopy(settings),
  });
}

function buildWeeks(rows) {
  const weeks = new Map();
  for (const row of rows) {
    const cycleWeek = Number(row.cycle_week || 0);
    const dayIndex = Number(row.day_index || 0);
    if (!(cycleWeek >= 1 && cycleWeek <= 4) || !(dayIndex >= 1 && dayIndex <= 6)) continue;
    if (!weeks.has(cycleWeek)) weeks.set(cycleWeek, { cycleWeek, days: new Map() });
    const week = weeks.get(cycleWeek);
    if (!week.days.has(dayIndex)) week.days.set(dayIndex, { dayIndex, scores: new Map(), capturedAt: '' });
    const day = week.days.get(dayIndex);
    day.scores.set(String(row.uid), Number(row.score || 0));
    if (String(row.captured_at || '') > day.capturedAt) day.capturedAt = String(row.captured_at || '');
  }
  return weeks;
}

function buildWeekOutcomes(results, overrides) {
  const byWeek = new Map();
  const put = (row, priority) => {
    const cycleWeek = Number(row.cycle_week || 0);
    const dayIndex = Number(row.day_index || 0);
    if (!(cycleWeek >= 1 && cycleWeek <= 4) || !(dayIndex >= 1 && dayIndex <= 6)) return;
    if (!byWeek.has(cycleWeek)) byWeek.set(cycleWeek, { days: new Map(), securedDayIndex: 0, pointsWon: 0 });
    const week = byWeek.get(cycleWeek);
    const current = week.days.get(dayIndex);
    if (!current || priority >= current.priority) {
      week.days.set(dayIndex, { isWin: Number(row.is_win || 0) === 1, priority });
    }
  };
  for (const row of overrides) put(row, 1);
  for (const row of results) if (row.is_win !== null && row.is_win !== undefined) put(row, 2);

  for (const week of byWeek.values()) {
    let points = 0;
    for (const meta of DAY_META) {
      const day = week.days.get(meta.dayIndex);
      if (day?.isWin) points += meta.weight;
      if (!week.securedDayIndex && points >= WEEK_WIN_THRESHOLD) week.securedDayIndex = meta.dayIndex;
    }
    week.pointsWon = points;
  }
  return byWeek;
}

function scorePlayerDuel(uid, weeks, policies, away, outcomes, settings) {
  const dayAverages = [];
  let weightedNumerator = 0;
  let availableWeight = 0;
  let raw = 0;
  let eligibleRaw = 0;
  let minimumDaysHit = 0;
  let minimumDaysAvailable = 0;
  const playedWeeks = new Set();

  for (const week of weeks.values()) {
    for (const day of week.days.values()) raw += Number(day.scores.get(uid) || 0);
  }

  for (const meta of DAY_META) {
    let adjustedTotal = 0;
    let rawTotal = 0;
    let eligibleWeeks = 0;

    for (const week of weeks.values()) {
      const day = week.days.get(meta.dayIndex);
      if (!day) continue;
      if (away.has(`${uid}|${week.cycleWeek}`)) continue;

      const score = Number(day.scores.get(uid) || 0);
      const policy = policies.get(week.cycleWeek) || { isBye: false, multiplier: 1 };
      const byeMultiplier = policy.isBye ? Math.max(0, finite(policy.multiplier, settings.byeWeight)) : 1;
      const securedDayIndex = Number(outcomes.get(week.cycleWeek)?.securedDayIndex || 0);
      const afterWeekSecured = securedDayIndex > 0 && meta.dayIndex > securedDayIndex;
      const securedMultiplier = afterWeekSecured ? settings.securedWeekWeight : 1;
      const multiplier = byeMultiplier * securedMultiplier;

      eligibleWeeks += 1;
      rawTotal += score;
      eligibleRaw += score;
      adjustedTotal += score * multiplier;
      if (score > 0) playedWeeks.add(week.cycleWeek);

      if (!policy.isBye) {
        minimumDaysAvailable += 1;
        if (score >= settings.dailyMinimum) minimumDaysHit += 1;
      }
    }

    if (!eligibleWeeks) {
      dayAverages.push({ ...meta, average: 0, rawAverage: 0, eligibleWeeks: 0 });
      continue;
    }

    const average = adjustedTotal / eligibleWeeks;
    const rawAverage = rawTotal / eligibleWeeks;
    dayAverages.push({ ...meta, average: round2(average), rawAverage: round2(rawAverage), eligibleWeeks });
    weightedNumerator += average * meta.weight;
    availableWeight += meta.weight;
  }

  const weightedAverage = availableWeight ? weightedNumerator / availableWeight : 0;
  const consistencyPercent = minimumDaysAvailable ? minimumDaysHit * 100 / minimumDaysAvailable : 0;

  return {
    raw,
    eligibleRaw,
    weightedAverage: round2(weightedAverage),
    consistencyPercent: round1(consistencyPercent),
    dayAverages,
    availableDayWeight: availableWeight,
    totalDayWeight: TOTAL_DAY_WEIGHT,
    playedWeeks: playedWeeks.size,
    minimumDaysHit,
    minimumDaysAvailable,
    scoringMode: 'weighted_day_average_secured_week',
  };
}

async function duelGuide(env) {
  const settings = await duelSettings(env);
  return {
    settings,
    duel: {
      dayWeights: DAY_META,
      totalDayWeight: TOTAL_DAY_WEIGHT,
      weekWinThreshold: WEEK_WIN_THRESHOLD,
      dailyMinimum: settings.dailyMinimum,
      minimumRankedDuelWeeks: settings.minimumRankedDuelWeeks,
      byeWeight: settings.byeWeight,
      securedWeekWeight: settings.securedWeekWeight,
    },
    rules: {
      approvedLeave: 'excluded',
      missedWithoutLeave: 0,
      byeWeeksDiscounted: true,
      byeExcludedFromMinimumConsistency: true,
      securedWeekDiscounted: true,
      securedWeekStartsAfterClinchingDay: true,
      securedWeekThreshold: WEEK_WIN_THRESHOLD,
      decisiveWins: false,
      otherEventScoringFinalized: false,
    },
  };
}

async function updateDuelSettings(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const current = await duelSettings(env);
  const dailyMinimum = clampNumber(body?.dailyMinimum, 0, 1e12, current.dailyMinimum);
  const minimumRankedDuelWeeks = Math.round(clampNumber(body?.minimumRankedDuelWeeks, 1, 4, current.minimumRankedDuelWeeks));
  const securedWeekWeight = clampNumber(body?.securedWeekWeight, 0, 1, current.securedWeekWeight);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
      VALUES('duel_daily_minimum',?,'Alliance Duel daily minimum',?)
      ON CONFLICT(setting_key) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at
    `).bind(dailyMinimum, now),
    env.DB.prepare(`
      INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
      VALUES('minimum_ranked_duel_weeks',?,'Minimum played Alliance Duel weeks for final ranked eligibility',?)
      ON CONFLICT(setting_key) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at
    `).bind(minimumRankedDuelWeeks, now),
    env.DB.prepare(`
      INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
      VALUES('secured_week_multiplier_alliance_duel',?,'Alliance Duel score multiplier after the week is secured',?)
      ON CONFLICT(setting_key) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at
    `).bind(securedWeekWeight, now),
  ]);
  return json({ ok: true, ...(await duelGuide(env)) });
}

async function duelSettings(env) {
  const result = await env.DB.prepare(`
    SELECT setting_key,numeric_value
    FROM scoring_settings
    WHERE setting_key IN ('duel_daily_minimum','minimum_ranked_duel_weeks','bye_week_multiplier_alliance_duel','secured_week_multiplier_alliance_duel')
  `).all();
  const values = new Map((result.results || []).map(row => [String(row.setting_key), Number(row.numeric_value)]));
  return {
    dailyMinimum: finite(values.get('duel_daily_minimum'), DEFAULT_DAILY_MINIMUM),
    minimumRankedDuelWeeks: Math.max(1, Math.min(4, Math.round(finite(values.get('minimum_ranked_duel_weeks'), DEFAULT_MINIMUM_RANKED_WEEKS)))),
    byeWeight: Math.max(0, finite(values.get('bye_week_multiplier_alliance_duel'), DEFAULT_BYE_WEIGHT)),
    securedWeekWeight: Math.max(0, Math.min(1, finite(values.get('secured_week_multiplier_alliance_duel'), DEFAULT_SECURED_WEEK_WEIGHT))),
  };
}

function duelMethodCopy(settings) {
  return `Alliance Duel ranking averages each player's Tank, Build, Science, Hero, Training and Enemy Buster scores across the current four-week Duel League, then weights those day averages 1 / 2 / 2 / 2 / 2 / 4 to match Duel win-point value. The day that reaches 7 of 13 week points still counts fully; only later days are multiplied by the Secured Week Weight (${Math.round(settings.securedWeekWeight * 100)}%). Approved On Leave weeks are excluded. Bye weeks are discounted by their configured multiplier. The ${format(settings.dailyMinimum)} daily standard is tracked separately as Consistency.`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function round1(value) { return Math.round(Number(value || 0) * 10) / 10; }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function format(value) { return new Intl.NumberFormat('en-US').format(Number(value || 0)); }
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
