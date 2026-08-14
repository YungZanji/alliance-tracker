import portal from './scoring-entry-v142.js';

const DEFAULT_DUEL_BASELINE = 6_000_000;
const DEFAULT_STATE_RULER_BASELINE = 2_250_000;
const DEFAULT_ATTENDANCE_FLOOR = 2_250_000;
const DEFAULT_CURVE_EXPONENT = 0.50;
const DEFAULT_WEIGHTS = {
  alliance_duel: 0.45,
  state_ruler: 0.25,
  glory_war: 0.30,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/participation' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return enrichParticipation(response, env);
    }

    if (url.pathname === '/api/scoring-guide' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return enrichGuide(response, env);
    }

    if (url.pathname === '/api/admin/contribution-model' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await contributionSettings(env)) });
    }

    if (url.pathname === '/api/admin/contribution-model' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return updateContributionSettings(request, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function enrichParticipation(response, env) {
  try {
    const body = await response.json();
    const cycleId = String(body?.cycleId || '').trim();
    const settings = await contributionSettings(env);
    const weights = settings.weights;

    if (!cycleId || !Array.isArray(body?.players)) {
      return json({ ...body, contribution: settings, scoringMode: 'combined_contribution_v1' }, response.status);
    }

    const [scoreResult, policyResult, leaveResult, identityResult] = await Promise.all([
      env.DB.prepare(`
        SELECT cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,captured_at
        FROM event_week_scores
        WHERE event_type='state_ruler' AND cycle_id=?
        ORDER BY cycle_week,uid
      `).bind(cycleId).all(),
      env.DB.prepare(`
        SELECT cycle_week,is_bye,weight_multiplier
        FROM event_week_policy
        WHERE event_type='state_ruler' AND cycle_id=?
      `).bind(cycleId).all(),
      env.DB.prepare(`
        SELECT cycle_week,uid,status
        FROM player_week_leave
        WHERE cycle_id=? AND status='away'
      `).bind(cycleId).all(),
      env.DB.prepare(`SELECT uid,public_id FROM players`).all(),
    ]);

    const stateRows = scoreResult.results || [];
    const availableWeeks = [...new Set(stateRows.map(row => Number(row.cycle_week || 0)).filter(week => week >= 1 && week <= 4))].sort((a, b) => a - b);
    const policies = new Map((policyResult.results || []).map(row => [Number(row.cycle_week), {
      isBye: Number(row.is_bye || 0) === 1,
      multiplier: Math.max(0, Number.isFinite(Number(row.weight_multiplier)) ? Number(row.weight_multiplier) : 1),
    }]));
    const away = new Set((leaveResult.results || []).map(row => `${String(row.uid)}|${Number(row.cycle_week)}`));
    const uidByPublicId = new Map((identityResult.results || []).map(row => [String(row.public_id || ''), String(row.uid || '')]));
    const stateByUidWeek = new Map(stateRows.map(row => [`${String(row.uid)}|${Number(row.cycle_week)}`, row]));

    const players = body.players.map(player => {
      const uid = uidByPublicId.get(String(player.publicId || '')) || '';
      const duel = player.components?.alliance_duel || {};
      const duelPerformance = Number(duel.weightedAverage || 0);
      const duelIndex = contributionIndex(duelPerformance, settings.scales.duelBaseline, settings.scales.curveExponent);
      const stateRuler = scoreStateRuler(uid, availableWeeks, stateByUidWeek, policies, away, settings.scales);
      const gloryIndex = 0;

      const duelWeighted = duelIndex * weights.alliance_duel;
      const stateWeighted = stateRuler.index * weights.state_ruler;
      const gloryWeighted = gloryIndex * weights.glory_war;
      const overall = duelWeighted + stateWeighted + gloryWeighted;

      return {
        ...player,
        score: round2(overall),
        overallContribution: round2(overall),
        components: {
          ...(player.components || {}),
          alliance_duel: {
            ...duel,
            eventIndex: round2(duelIndex),
            baseline: settings.scales.duelBaseline,
            weight: weights.alliance_duel,
            weightedContribution: round2(duelWeighted),
          },
          state_ruler: {
            ...stateRuler,
            weight: weights.state_ruler,
            weightedContribution: round2(stateWeighted),
          },
          glory_war: {
            ...(player.components?.glory_war || {}),
            index: 0,
            eventIndex: 0,
            weight: weights.glory_war,
            weightedContribution: 0,
            status: 'pending_model',
          },
        },
      };
    });

    players.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
      || Number(b.components?.alliance_duel?.eventIndex || 0) - Number(a.components?.alliance_duel?.eventIndex || 0)
      || Number(b.components?.state_ruler?.eventIndex || 0) - Number(a.components?.state_ruler?.eventIndex || 0)
      || String(a.name || '').localeCompare(String(b.name || '')));
    players.forEach((row, index) => { row.rank = index + 1; });

    return json({
      ...body,
      players,
      scoringMode: 'combined_contribution_v1',
      availability: {
        ...(body.availability || {}),
        alliance_duel: true,
        state_ruler: availableWeeks.length > 0,
        glory_war: false,
      },
      weights: settings.weightRows,
      contribution: {
        ...settings,
        stateRulerWeeksAvailable: availableWeeks,
        provisional: true,
        pendingEvent: 'glory_war',
      },
      method: combinedMethod(settings, availableWeeks),
    }, response.status);
  } catch (error) {
    console.error('Could not build combined Contribution Score', error);
    return response;
  }
}

function scoreStateRuler(uid, availableWeeks, scoreMap, policies, away, scales) {
  let adjustedIndexTotal = 0;
  let creditedTotal = 0;
  let eligibleWeeks = 0;
  let playedWeeks = 0;
  let attendanceOnlyWeeks = 0;
  let realScoreWeeks = 0;
  const weeks = [];

  for (const cycleWeek of availableWeeks) {
    if (uid && away.has(`${uid}|${cycleWeek}`)) {
      weeks.push({ cycleWeek, status: 'on_leave', excluded: true, creditedScore: 0, index: 0 });
      continue;
    }

    const row = uid ? scoreMap.get(`${uid}|${cycleWeek}`) : null;
    const credited = Math.max(0, Number(row?.credited_score || 0));
    const baseIndex = contributionIndex(credited, scales.stateRulerBaseline, scales.curveExponent);
    const policy = policies.get(cycleWeek) || { isBye: false, multiplier: 1 };
    const weekMultiplier = policy.isBye ? Math.max(0, Number(policy.multiplier || 0)) : 1;
    const adjustedIndex = baseIndex * weekMultiplier;

    eligibleWeeks += 1;
    creditedTotal += credited;
    adjustedIndexTotal += adjustedIndex;
    if (credited > 0) playedWeeks += 1;
    if (String(row?.credit_source || '') === 'attendance_minimum') attendanceOnlyWeeks += 1;
    if (row?.raw_score !== null && row?.raw_score !== undefined) realScoreWeeks += 1;

    weeks.push({
      cycleWeek,
      status: credited > 0 ? String(row?.credit_source || 'credited') : 'missed',
      excluded: false,
      rawScore: row?.raw_score == null ? null : Number(row.raw_score),
      creditedScore: credited,
      baseIndex: round2(baseIndex),
      weekMultiplier,
      index: round2(adjustedIndex),
      leaderboardPosition: row?.leaderboard_position == null ? null : Number(row.leaderboard_position),
    });
  }

  return {
    raw: creditedTotal,
    creditedTotal,
    averageCreditedScore: eligibleWeeks ? round2(creditedTotal / eligibleWeeks) : 0,
    index: eligibleWeeks ? round2(adjustedIndexTotal / eligibleWeeks) : 0,
    eventIndex: eligibleWeeks ? round2(adjustedIndexTotal / eligibleWeeks) : 0,
    baseline: scales.stateRulerBaseline,
    attendanceFloor: scales.stateRulerAttendanceFloor,
    eligibleWeeks,
    playedWeeks,
    attendanceOnlyWeeks,
    realScoreWeeks,
    weeks,
  };
}

async function enrichGuide(response, env) {
  try {
    const body = await response.json();
    const settings = await contributionSettings(env);
    return json({
      ...body,
      contribution: {
        ...settings,
        examples: contributionExamples(settings.scales),
        formula: 'Overall = Duel Index × Duel Weight + State Ruler Index × State Ruler Weight + Glory War Index × Glory War Weight',
        gloryWarStatus: 'pending_model',
      },
    }, response.status);
  } catch (_) {
    return response;
  }
}

async function updateContributionSettings(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: 'Invalid contribution settings.' }, 400);
  }

  const current = await contributionSettings(env);
  const duelBaseline = clampNumber(body?.duelBaseline, 1, 1e12, current.scales.duelBaseline);
  const stateRulerBaseline = clampNumber(body?.stateRulerBaseline, 1, 1e12, current.scales.stateRulerBaseline);
  const stateRulerAttendanceFloor = clampNumber(body?.stateRulerAttendanceFloor, 0, 1e12, current.scales.stateRulerAttendanceFloor);
  const curveExponent = clampNumber(body?.curveExponent, 0.10, 1.00, current.scales.curveExponent);
  const now = new Date().toISOString();

  await env.DB.batch([
    settingStatement(env, 'duel_contribution_baseline', duelBaseline, 'Weighted Duel Average that maps to Contribution Index 100', now),
    settingStatement(env, 'state_ruler_contribution_baseline', stateRulerBaseline, 'State Ruler credited score that maps to Contribution Index 100', now),
    settingStatement(env, 'state_ruler_attendance_floor', stateRulerAttendanceFloor, 'Minimum State Ruler credit for confirmed attendance without a real leaderboard score', now),
    settingStatement(env, 'contribution_curve_exponent', curveExponent, 'Exponent used to normalize event performance onto the Contribution Index', now),
  ]);

  // Existing attendance-only rows remain connected to the live Admin floor. Real leaderboard scores are never changed.
  await env.DB.prepare(`
    UPDATE event_week_scores
    SET credited_score=?
    WHERE event_type='state_ruler' AND raw_score IS NULL AND credit_source='attendance_minimum'
  `).bind(stateRulerAttendanceFloor).run();

  return json({ ok: true, ...(await contributionSettings(env)) });
}

function settingStatement(env, key, value, text, now) {
  return env.DB.prepare(`
    INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(setting_key) DO UPDATE SET
      numeric_value=excluded.numeric_value,
      text_value=excluded.text_value,
      updated_at=excluded.updated_at
  `).bind(key, value, text, now);
}

async function contributionSettings(env) {
  const [settingResult, weightResult] = await Promise.all([
    env.DB.prepare(`
      SELECT setting_key,numeric_value
      FROM scoring_settings
      WHERE setting_key IN (
        'duel_contribution_baseline',
        'state_ruler_contribution_baseline',
        'state_ruler_attendance_floor',
        'contribution_curve_exponent'
      )
    `).all(),
    env.DB.prepare(`
      SELECT event_type,label,weight,enabled
      FROM participation_weights
      WHERE event_type IN ('alliance_duel','state_ruler','glory_war')
    `).all(),
  ]);

  const values = new Map((settingResult.results || []).map(row => [String(row.setting_key), Number(row.numeric_value)]));
  const rows = weightResult.results || [];
  const weights = { ...DEFAULT_WEIGHTS };
  const labels = { alliance_duel: 'Alliance Duel', state_ruler: 'State Ruler', glory_war: 'Glory War' };
  const enabled = { alliance_duel: true, state_ruler: true, glory_war: true };
  for (const row of rows) {
    const key = String(row.event_type || '');
    if (!(key in weights)) continue;
    weights[key] = Math.max(0, Number.isFinite(Number(row.weight)) ? Number(row.weight) : weights[key]);
    labels[key] = String(row.label || labels[key]);
    enabled[key] = Number(row.enabled || 0) === 1;
  }

  const weightRows = ['alliance_duel', 'state_ruler', 'glory_war'].map(eventType => ({
    eventType,
    label: labels[eventType],
    weight: enabled[eventType] ? weights[eventType] : 0,
    enabled: enabled[eventType],
  }));

  return {
    scales: {
      duelBaseline: positive(values.get('duel_contribution_baseline'), DEFAULT_DUEL_BASELINE),
      stateRulerBaseline: positive(values.get('state_ruler_contribution_baseline'), DEFAULT_STATE_RULER_BASELINE),
      stateRulerAttendanceFloor: nonnegative(values.get('state_ruler_attendance_floor'), DEFAULT_ATTENDANCE_FLOOR),
      curveExponent: clampNumber(values.get('contribution_curve_exponent'), 0.10, 1.00, DEFAULT_CURVE_EXPONENT),
    },
    weights,
    weightRows,
    weightTotal: round4(weights.alliance_duel + weights.state_ruler + weights.glory_war),
  };
}

function contributionExamples(scales) {
  return {
    duel: [1, 2, 4, 9].map(multiplier => ({
      performance: scales.duelBaseline * multiplier,
      multiplier,
      index: round1(contributionIndex(scales.duelBaseline * multiplier, scales.duelBaseline, scales.curveExponent)),
    })),
    stateRuler: [1, 2, 4, 9].map(multiplier => ({
      performance: scales.stateRulerBaseline * multiplier,
      multiplier,
      index: round1(contributionIndex(scales.stateRulerBaseline * multiplier, scales.stateRulerBaseline, scales.curveExponent)),
    })),
  };
}

function contributionIndex(performance, baseline, exponent) {
  const score = Math.max(0, Number(performance || 0));
  const base = Number(baseline || 0);
  const curve = Number(exponent || 0);
  if (!(base > 0) || !(curve > 0) || !(score > 0)) return 0;
  return 100 * Math.pow(score / base, curve);
}

function combinedMethod(settings, availableWeeks) {
  const exponent = settings.scales.curveExponent;
  return `Overall Contribution converts each finalized event performance to a shared index using 100 × (performance ÷ event baseline)^${exponent.toFixed(2)}. Alliance Duel uses the existing Weighted Duel Average against the ${format(settings.scales.duelBaseline)} baseline. State Ruler averages weekly indices against the ${format(settings.scales.stateRulerBaseline)} baseline; confirmed attendance without a real leaderboard score uses the ${format(settings.scales.stateRulerAttendanceFloor)} attendance floor, missed events count as zero, approved leave is excluded, and State Ruler Bye multipliers apply after normalization. Current weights: Alliance Duel ${pct(settings.weights.alliance_duel)}, State Ruler ${pct(settings.weights.state_ruler)}, Glory War ${pct(settings.weights.glory_war)}. Glory War remains reserved but contributes zero until its model is finalized. State Ruler weeks currently included: ${availableWeeks.length ? availableWeeks.join(', ') : 'none'}.`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function positive(value, fallback) { return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback; }
function nonnegative(value, fallback) { return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback; }
function round1(value) { return Math.round(Number(value || 0) * 10) / 10; }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function round4(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function format(value) { return new Intl.NumberFormat('en-US').format(Number(value || 0)); }
function pct(value) { return `${Math.round(Number(value || 0) * 100)}%`; }
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
