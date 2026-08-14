import portal from './scoring-entry-v136.js';

const PRIMARY_ALLIANCE = 'WDZ';
const EVENT_TYPES = ['alliance_duel', 'glory_war', 'state_ruler'];
const DAY_NAMES = ['Tank Day', 'Build Day', 'Science Day', 'Hero Day', 'Training Day', 'Enemy Buster'];
const DEFAULTS = {
  dailyMinimum: 6000000,
  duelDays: [6000000, 6000000, 6000000, 6000000, 6000000, 6000000],
  stateRuler: 2250000,
  gloryWar: 0,
  minimumRankedDuelWeeks: 3,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/participation' && request.method === 'GET') {
      const gate = await requireUserViaPortal(request, env, ctx);
      if (gate) return gate;
      return handleParticipation(env);
    }

    if (url.pathname === '/api/scoring-guide' && request.method === 'GET') {
      const gate = await requireUserViaPortal(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await scoringGuide(env)) });
    }

    if (url.pathname === '/api/admin/scoring-model' && request.method === 'GET') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await scoringGuide(env)) });
    }

    if (url.pathname === '/api/admin/scoring-model' && request.method === 'POST') {
      const gate = await requireAdminViaPortal(request, env, ctx);
      if (gate) return gate;
      return updateScoringModel(request, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireUserViaPortal(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function requireAdminViaPortal(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function handleParticipation(env) {
  const [settings, weights, playersResult, dailyResult, eventResult, policyResult, leaveResult, latestCycle] = await Promise.all([
    contributionSettings(env),
    participationWeights(env),
    env.DB.prepare(`SELECT uid,public_id,current_name,alliance_abbr,server_id FROM players WHERE alliance_abbr=?`).bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,day_index,uid,score,captured_at FROM duel_daily`).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,uid,credited_score FROM event_week_scores WHERE event_type IN ('state_ruler','glory_war')`).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier FROM event_week_policy`).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,uid,status FROM player_week_leave WHERE status='away'`).all(),
    env.DB.prepare(`SELECT cycle_id,MAX(captured_at) AS latest_capture FROM duel_daily GROUP BY cycle_id ORDER BY latest_capture DESC LIMIT 1`).first(),
  ]);

  const policy = new Map((policyResult.results || []).map(row => [weekKey(row.event_type, row.cycle_id, row.cycle_week), Number(row.weight_multiplier ?? 1)]));
  const leave = new Set((leaveResult.results || []).map(row => playerWeekKey(row.uid, row.cycle_id, row.cycle_week)));
  const duelWeeks = buildDuelWeeks(dailyResult.results || []);
  const eventWeeks = buildEventWeeks(eventResult.results || []);
  const latestCycleId = String(latestCycle?.cycle_id || '');
  const latestCycleWeeks = [...duelWeeks.values()].filter(week => week.cycleId === latestCycleId);
  const latestCycleComplete = latestCycleWeeks.length >= 4;

  const availability = {
    alliance_duel: duelWeeks.size > 0 && settings.duelDays.some(value => value > 0),
    glory_war: (eventWeeks.get('glory_war')?.size || 0) > 0 && settings.gloryWar > 0,
    state_ruler: (eventWeeks.get('state_ruler')?.size || 0) > 0 && settings.stateRuler > 0,
  };

  const players = (playersResult.results || []).map(player => {
    const uid = String(player.uid);
    const duel = scoreAllianceDuel(uid, duelWeeks, policy, leave, settings);
    const glory = scoreSingleBenchmarkEvent(uid, 'glory_war', eventWeeks.get('glory_war') || new Map(), policy, leave, settings.gloryWar);
    const ruler = scoreSingleBenchmarkEvent(uid, 'state_ruler', eventWeeks.get('state_ruler') || new Map(), policy, leave, settings.stateRuler);
    const components = { alliance_duel: duel, glory_war: glory, state_ruler: ruler };

    let numerator = 0;
    let denominator = 0;
    for (const weight of weights) {
      const component = components[weight.eventType];
      if (!weight.enabled || !availability[weight.eventType] || !component || weight.weight <= 0) continue;
      numerator += component.index * weight.weight;
      denominator += weight.weight;
    }

    const playedLatestWeeks = latestCycleWeeks.filter(week => {
      if (leave.has(playerWeekKey(uid, week.cycleId, week.cycleWeek))) return false;
      return [...week.days.values()].some(day => Number(day.scores.get(uid) || 0) > 0);
    }).length;
    const qualified = !latestCycleComplete || playedLatestWeeks >= settings.minimumRankedDuelWeeks;

    return {
      publicId: String(player.public_id || ''),
      name: String(player.current_name || ''),
      allianceAbbr: String(player.alliance_abbr || ''),
      serverId: Number(player.server_id || 0),
      score: denominator ? round2(numerator / denominator) : 0,
      components,
      minimumDaysHit: duel.minimumDaysHit,
      minimumDaysAvailable: duel.minimumDaysAvailable,
      qualification: {
        qualified,
        finalCheckActive: latestCycleComplete,
        playedDuelWeeks: playedLatestWeeks,
        requiredDuelWeeks: settings.minimumRankedDuelWeeks,
      },
    };
  });

  players.sort((a, b) => {
    if (latestCycleComplete && a.qualification.qualified !== b.qualification.qualified) return a.qualification.qualified ? -1 : 1;
    return b.score - a.score || b.minimumDaysHit - a.minimumDaysHit || Number(b.components.alliance_duel?.raw || 0) - Number(a.components.alliance_duel?.raw || 0) || a.name.localeCompare(b.name);
  });
  players.forEach((row, index) => row.rank = index + 1);

  return json({
    ok: true,
    players,
    weights,
    availability,
    settings,
    method: 'Contribution Score uses fixed Alliance benchmarks, not the top player. Raw scores are uncapped. Each captured week is scored independently; normal weeks count fully, Bye weeks are multiplied by their configured weight, approved On Leave weeks are excluded, and missed non-leave weeks count as zero. Event scores are then combined with the configured event weights.',
  });
}

function buildDuelWeeks(rows) {
  const weeks = new Map();
  for (const row of rows) {
    const key = `${String(row.cycle_id)}|${Number(row.cycle_week)}`;
    if (!weeks.has(key)) weeks.set(key, { cycleId: String(row.cycle_id), cycleWeek: Number(row.cycle_week), days: new Map() });
    const week = weeks.get(key);
    const dayIndex = Number(row.day_index || 0);
    if (!(dayIndex >= 1 && dayIndex <= 6)) continue;
    if (!week.days.has(dayIndex)) week.days.set(dayIndex, { dayIndex, scores: new Map() });
    week.days.get(dayIndex).scores.set(String(row.uid), Number(row.score || 0));
  }
  return weeks;
}

function buildEventWeeks(rows) {
  const byEvent = new Map();
  for (const row of rows) {
    const eventType = String(row.event_type || '');
    if (!byEvent.has(eventType)) byEvent.set(eventType, new Map());
    const weeks = byEvent.get(eventType);
    const key = `${String(row.cycle_id)}|${Number(row.cycle_week)}`;
    if (!weeks.has(key)) weeks.set(key, { cycleId: String(row.cycle_id), cycleWeek: Number(row.cycle_week), scores: new Map() });
    weeks.get(key).scores.set(String(row.uid), Number(row.credited_score || 0));
  }
  return byEvent;
}

function scoreAllianceDuel(uid, weeks, policy, leave, settings) {
  let totalIndex = 0;
  let eligibleWeeks = 0;
  let raw = 0;
  let minimumDaysHit = 0;
  let minimumDaysAvailable = 0;
  let playedWeeks = 0;

  for (const week of weeks.values()) {
    if (leave.has(playerWeekKey(uid, week.cycleId, week.cycleWeek))) continue;
    const availableDays = [...week.days.values()].filter(day => Number(settings.duelDays[day.dayIndex - 1] || 0) > 0);
    if (!availableDays.length) continue;
    eligibleWeeks += 1;
    let weekIndexTotal = 0;
    let played = false;
    for (const day of availableDays) {
      const score = Number(day.scores.get(uid) || 0);
      const benchmark = Number(settings.duelDays[day.dayIndex - 1] || 0);
      raw += score;
      minimumDaysAvailable += 1;
      if (score >= settings.dailyMinimum) minimumDaysHit += 1;
      if (score > 0) played = true;
      weekIndexTotal += benchmark > 0 ? score * 100 / benchmark : 0;
    }
    if (played) playedWeeks += 1;
    const weekIndex = weekIndexTotal / availableDays.length;
    const multiplier = finite(policy.get(weekKey('alliance_duel', week.cycleId, week.cycleWeek)), 1);
    totalIndex += weekIndex * Math.max(0, multiplier);
  }

  return {
    raw,
    index: eligibleWeeks ? round2(totalIndex / eligibleWeeks) : 0,
    weeks: eligibleWeeks,
    playedWeeks,
    minimumDaysHit,
    minimumDaysAvailable,
    benchmarkMode: 'daily',
  };
}

function scoreSingleBenchmarkEvent(uid, eventType, weeks, policy, leave, benchmark) {
  let totalIndex = 0;
  let eligibleWeeks = 0;
  let raw = 0;
  let playedWeeks = 0;
  if (!(benchmark > 0)) return { raw: 0, index: 0, weeks: 0, playedWeeks: 0, benchmark };

  for (const week of weeks.values()) {
    if (leave.has(playerWeekKey(uid, week.cycleId, week.cycleWeek))) continue;
    eligibleWeeks += 1;
    const score = Number(week.scores.get(uid) || 0);
    raw += score;
    if (score > 0) playedWeeks += 1;
    const weekIndex = score * 100 / benchmark;
    const multiplier = finite(policy.get(weekKey(eventType, week.cycleId, week.cycleWeek)), 1);
    totalIndex += weekIndex * Math.max(0, multiplier);
  }

  return { raw, index: eligibleWeeks ? round2(totalIndex / eligibleWeeks) : 0, weeks: eligibleWeeks, playedWeeks, benchmark };
}

async function scoringGuide(env) {
  const [settings, weights, byeWeights] = await Promise.all([contributionSettings(env), participationWeights(env), globalByeWeights(env)]);
  const enabledWeightTotal = weights.filter(row => row.enabled && row.weight > 0).reduce((sum, row) => sum + row.weight, 0);
  return {
    settings,
    weights: weights.map(row => ({ ...row, percent: enabledWeightTotal ? round1(row.weight * 100 / enabledWeightTotal) : 0 })),
    byeWeights,
    rules: {
      normalWeek: 1,
      approvedLeave: 'excluded',
      missedWithoutLeave: 0,
      uncapped: true,
      fixedBenchmarks: true,
      finalRankMinimumDuelWeeks: settings.minimumRankedDuelWeeks,
    },
  };
}

async function updateScoringModel(request, env) {
  const body = await request.json();
  const current = await contributionSettings(env);
  const next = {
    dailyMinimum: clampNumber(body?.dailyMinimum, 0, 1e12, current.dailyMinimum),
    duelDays: current.duelDays.map((value, index) => clampNumber(body?.duelDays?.[index], 1, 1e12, value)),
    stateRuler: clampNumber(body?.stateRuler, 1, 1e12, current.stateRuler),
    gloryWar: clampNumber(body?.gloryWar, 0, 1e12, current.gloryWar),
    minimumRankedDuelWeeks: Math.round(clampNumber(body?.minimumRankedDuelWeeks, 1, 4, current.minimumRankedDuelWeeks)),
  };
  const now = new Date().toISOString();
  const values = [
    ['duel_daily_minimum', next.dailyMinimum, 'Alliance Duel daily minimum'],
    ...next.duelDays.map((value, index) => [`benchmark_duel_day_${index + 1}`, value, `${DAY_NAMES[index]} contribution benchmark`]),
    ['benchmark_state_ruler', next.stateRuler, 'State Ruler contribution benchmark'],
    ['benchmark_glory_war', next.gloryWar, 'Glory War contribution benchmark'],
    ['minimum_ranked_duel_weeks', next.minimumRankedDuelWeeks, 'Minimum played Alliance Duel weeks for final ranked eligibility'],
  ];
  await env.DB.batch(values.map(([key, value, label]) => env.DB.prepare(`
    INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(setting_key) DO UPDATE SET numeric_value=excluded.numeric_value,text_value=excluded.text_value,updated_at=excluded.updated_at
  `).bind(key, value, label, now)));
  return json({ ok: true, ...(await scoringGuide(env)) });
}

async function contributionSettings(env) {
  const keys = [
    'duel_daily_minimum',
    ...Array.from({ length: 6 }, (_, index) => `benchmark_duel_day_${index + 1}`),
    'benchmark_state_ruler',
    'benchmark_glory_war',
    'minimum_ranked_duel_weeks',
  ];
  const placeholders = keys.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT setting_key,numeric_value FROM scoring_settings WHERE setting_key IN (${placeholders})`).bind(...keys).all();
  const map = new Map((result.results || []).map(row => [String(row.setting_key), Number(row.numeric_value)]));
  return {
    dailyMinimum: finite(map.get('duel_daily_minimum'), DEFAULTS.dailyMinimum),
    duelDays: DEFAULTS.duelDays.map((fallback, index) => finite(map.get(`benchmark_duel_day_${index + 1}`), fallback)),
    stateRuler: finite(map.get('benchmark_state_ruler'), DEFAULTS.stateRuler),
    gloryWar: finite(map.get('benchmark_glory_war'), DEFAULTS.gloryWar),
    minimumRankedDuelWeeks: Math.max(1, Math.min(4, Math.round(finite(map.get('minimum_ranked_duel_weeks'), DEFAULTS.minimumRankedDuelWeeks)))),
    dayNames: DAY_NAMES,
  };
}

async function participationWeights(env) {
  const result = await env.DB.prepare(`SELECT event_type,label,weight,enabled FROM participation_weights ORDER BY event_type`).all();
  return (result.results || []).map(row => ({
    eventType: String(row.event_type || ''),
    label: String(row.label || row.event_type || ''),
    weight: Number(row.weight || 0),
    enabled: Number(row.enabled || 0) === 1,
  })).filter(row => EVENT_TYPES.includes(row.eventType));
}

async function globalByeWeights(env) {
  const keys = {
    alliance_duel: 'bye_week_multiplier_alliance_duel',
    state_ruler: 'bye_week_multiplier_state_ruler',
    glory_war: 'bye_week_multiplier_glory_war',
  };
  const result = await env.DB.prepare(`SELECT setting_key,numeric_value FROM scoring_settings WHERE setting_key IN (?,?,?)`)
    .bind(keys.alliance_duel, keys.state_ruler, keys.glory_war).all();
  const map = new Map((result.results || []).map(row => [String(row.setting_key), Number(row.numeric_value)]));
  return {
    alliance_duel: finite(map.get(keys.alliance_duel), 0.35),
    state_ruler: finite(map.get(keys.state_ruler), 0.35),
    glory_war: finite(map.get(keys.glory_war), 0.35),
  };
}

function weekKey(eventType, cycleId, cycleWeek) { return `${String(eventType)}|${String(cycleId)}|${Number(cycleWeek)}`; }
function playerWeekKey(uid, cycleId, cycleWeek) { return `${String(uid)}|${String(cycleId)}|${Number(cycleWeek)}`; }
function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function round1(value) { return Math.round(Number(value || 0) * 10) / 10; }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
