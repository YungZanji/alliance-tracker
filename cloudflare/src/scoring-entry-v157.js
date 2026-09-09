import portal from './scoring-entry-v156.js';

const DEFAULT_GLORY_WAR_BASELINE = 1_000_000;
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
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return enrichContributionSettings(response, env);
    }

    if (url.pathname === '/api/admin/contribution-model' && request.method === 'POST') {
      let requested = {};
      try { requested = await request.clone().json(); } catch (_) {}
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      if (requested.gloryWarBaseline !== undefined) {
        await saveGloryWarBaseline(env, requested.gloryWarBaseline);
      }
      return enrichContributionSettings(response, env);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function enrichParticipation(response, env) {
  let body;
  try { body = await response.json(); } catch (_) { return response; }

  // Archived seasons are intentionally frozen at the score model that existed when
  // they were archived. Do not silently rewrite a historical leaderboard.
  if (body?.archived) return json(body, response.status);

  const baseline = await gloryWarBaseline(env);
  const curveExponent = positiveNumber(body?.contribution?.scales?.curveExponent, DEFAULT_CURVE_EXPONENT);
  const weights = {
    alliance_duel: nonnegativeNumber(body?.contribution?.weights?.alliance_duel, DEFAULT_WEIGHTS.alliance_duel),
    state_ruler: nonnegativeNumber(body?.contribution?.weights?.state_ruler, DEFAULT_WEIGHTS.state_ruler),
    glory_war: nonnegativeNumber(body?.contribution?.weights?.glory_war, DEFAULT_WEIGHTS.glory_war),
  };

  const season = body?.season || null;
  if (!season || !Array.isArray(body?.players)) {
    return json(withGloryModelMeta(body, baseline, curveExponent, weights, 0), response.status);
  }

  const startCycle = String(season.startCycleId || body.cycleId || '').trim();
  const finalCycle = String(season.finalCycleId || '').trim();
  const endAt = String(season.endsAt || '').trim();
  if (!startCycle) {
    return json(withGloryModelMeta(body, baseline, curveExponent, weights, 0), response.status);
  }

  const [identityResult, matchResult, scoreResult, policyResult, leaveResult, noEventResult] = await Promise.all([
    env.DB.prepare('SELECT uid,public_id FROM players').all(),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,captured_at
      FROM glory_war_matches
      WHERE cycle_id>=? AND (?='' OR cycle_id<=?) AND (?='' OR captured_at<=?)
      ORDER BY cycle_id,cycle_week
    `).bind(startCycle, finalCycle, finalCycle, endAt, endAt).all(),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,captured_at
      FROM event_week_scores
      WHERE event_type='glory_war' AND cycle_id>=? AND (?='' OR cycle_id<=?) AND (?='' OR captured_at<=?)
      ORDER BY cycle_id,cycle_week,uid
    `).bind(startCycle, finalCycle, finalCycle, endAt, endAt).all(),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,is_bye,weight_multiplier
      FROM event_week_policy
      WHERE event_type='glory_war' AND cycle_id>=? AND (?='' OR cycle_id<=?)
    `).bind(startCycle, finalCycle, finalCycle).all(),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,uid,status
      FROM player_week_leave
      WHERE cycle_id>=? AND (?='' OR cycle_id<=?) AND status='away'
    `).bind(startCycle, finalCycle, finalCycle).all(),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,status
      FROM event_week_availability
      WHERE event_type='glory_war' AND cycle_id>=? AND (?='' OR cycle_id<=?)
    `).bind(startCycle, finalCycle, finalCycle).all(),
  ]);

  const uidByPublicId = new Map((identityResult.results || []).map(row => [String(row.public_id || ''), String(row.uid || '')]));
  const matches = uniqueGloryWarMatches(matchResult.results || []);
  const scores = new Map((scoreResult.results || []).map(row => [
    playerEventKey(row.uid, row.cycle_id, row.cycle_week),
    row,
  ]));
  const policies = new Map((policyResult.results || []).map(row => [eventKey(row.cycle_id, row.cycle_week), {
    isBye: Number(row.is_bye || 0) === 1,
    multiplier: Math.max(0, finiteNumber(row.weight_multiplier, 1)),
  }]));
  const away = new Set((leaveResult.results || []).map(row => playerEventKey(row.uid, row.cycle_id, row.cycle_week)));
  const noEvents = new Set((noEventResult.results || [])
    .filter(row => String(row.status || '') === 'no_event')
    .map(row => eventKey(row.cycle_id, row.cycle_week)));

  const players = body.players.map(player => {
    const uid = uidByPublicId.get(String(player.publicId || '')) || '';
    const glory = scoreGloryWar(uid, matches, scores, policies, away, noEvents, baseline, curveExponent);
    const duelIndex = Number(player.components?.alliance_duel?.eventIndex || 0);
    const rulerIndex = Number(player.components?.state_ruler?.eventIndex || 0);
    const gloryIndex = Number(glory.eventIndex || 0);
    const duelWeighted = duelIndex * weights.alliance_duel;
    const rulerWeighted = rulerIndex * weights.state_ruler;
    const gloryWeighted = gloryIndex * weights.glory_war;
    const overall = duelWeighted + rulerWeighted + gloryWeighted;

    return {
      ...player,
      score: round2(overall),
      overallContribution: round2(overall),
      components: {
        ...(player.components || {}),
        alliance_duel: {
          ...(player.components?.alliance_duel || {}),
          weight: weights.alliance_duel,
          weightedContribution: round2(duelWeighted),
        },
        state_ruler: {
          ...(player.components?.state_ruler || {}),
          weight: weights.state_ruler,
          weightedContribution: round2(rulerWeighted),
        },
        glory_war: {
          ...glory,
          weight: weights.glory_war,
          weightedContribution: round2(gloryWeighted),
          status: matches.length ? 'active' : 'awaiting_event',
        },
      },
    };
  });

  players.sort((a, b) => {
    const finalCheck = Boolean(a.qualification?.finalCheckActive || b.qualification?.finalCheckActive);
    if (finalCheck && Boolean(a.qualification?.qualified) !== Boolean(b.qualification?.qualified)) {
      return a.qualification?.qualified ? -1 : 1;
    }
    return Number(b.score || 0) - Number(a.score || 0)
      || Number(b.components?.alliance_duel?.eventIndex || 0) - Number(a.components?.alliance_duel?.eventIndex || 0)
      || Number(b.components?.state_ruler?.eventIndex || 0) - Number(a.components?.state_ruler?.eventIndex || 0)
      || Number(b.components?.glory_war?.eventIndex || 0) - Number(a.components?.glory_war?.eventIndex || 0)
      || String(a.name || '').localeCompare(String(b.name || ''));
  });
  players.forEach((row, index) => { row.rank = index + 1; });

  const availableMatches = matches.filter(match => !noEvents.has(eventKey(match.cycleId, match.cycleWeek))).length;
  const enriched = withGloryModelMeta({ ...body, players }, baseline, curveExponent, weights, availableMatches);
  enriched.availability = {
    ...(body.availability || {}),
    glory_war: availableMatches > 0,
  };
  enriched.scoringMode = 'season_combined_contribution_v2';
  enriched.method = `${String(body.method || '').replace(/\s+$/,'')} Glory War uses the same Contribution Index curve with a ${formatNumber(baseline)} baseline. Completed Glory Wars count as zero when a player has no score, while On Leave and explicit No Event weeks are excluded. Bye multipliers apply after the weekly Glory War index is calculated.`.trim();
  return json(enriched, response.status);
}

function withGloryModelMeta(body, baseline, curveExponent, weights, availableMatches) {
  return {
    ...body,
    contribution: {
      ...(body?.contribution || {}),
      weights,
      scales: {
        ...(body?.contribution?.scales || {}),
        gloryWarBaseline: baseline,
        curveExponent,
      },
      provisional: false,
      pendingEvent: null,
      gloryWarStatus: 'active',
      gloryWarEventsAvailable: availableMatches,
    },
  };
}

async function enrichGuide(response, env) {
  let body;
  try { body = await response.json(); } catch (_) { return response; }
  const baseline = await gloryWarBaseline(env);
  const exponent = positiveNumber(body?.contribution?.scales?.curveExponent, DEFAULT_CURVE_EXPONENT);
  const examples = [1, 2, 4, 9].map(multiplier => ({
    performance: baseline * multiplier,
    multiplier,
    index: round1(contributionIndex(baseline * multiplier, baseline, exponent)),
  }));

  return json({
    ...body,
    contribution: {
      ...(body.contribution || {}),
      scales: {
        ...(body.contribution?.scales || {}),
        gloryWarBaseline: baseline,
        curveExponent: exponent,
      },
      examples: {
        ...(body.contribution?.examples || {}),
        gloryWar: examples,
      },
      formula: 'Overall = Duel Index × Duel Weight + State Ruler Index × State Ruler Weight + Glory War Index × Glory War Weight',
      gloryWarStatus: 'active',
      gloryWarRules: {
        baseline,
        missedCompletedEvent: 'zero',
        onLeave: 'excluded',
        noEvent: 'excluded',
        byeMultiplier: 'applied_after_event_index',
        winBonus: false,
      },
      provisional: false,
      pendingEvent: null,
    },
  }, response.status);
}

async function enrichContributionSettings(response, env) {
  let body;
  try { body = await response.json(); } catch (_) { return response; }
  const baseline = await gloryWarBaseline(env);
  return json({
    ...body,
    scales: {
      ...(body.scales || {}),
      gloryWarBaseline: baseline,
    },
  }, response.status);
}

async function saveGloryWarBaseline(env, requested) {
  const current = await gloryWarBaseline(env);
  const value = clampNumber(requested, 1, 1e12, current);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
    VALUES('glory_war_contribution_baseline',?,'Glory War credited score that maps to Contribution Index 100',?)
    ON CONFLICT(setting_key) DO UPDATE SET
      numeric_value=excluded.numeric_value,
      text_value=excluded.text_value,
      updated_at=excluded.updated_at
  `).bind(value, now).run();
  return value;
}

async function gloryWarBaseline(env) {
  try {
    const row = await env.DB.prepare(`
      SELECT numeric_value FROM scoring_settings WHERE setting_key='glory_war_contribution_baseline'
    `).first();
    return positiveNumber(row?.numeric_value, DEFAULT_GLORY_WAR_BASELINE);
  } catch (_) {
    return DEFAULT_GLORY_WAR_BASELINE;
  }
}

export function scoreGloryWar(uid, matches, scores, policies, away, noEvents, baseline, exponent) {
  let adjustedIndexTotal = 0;
  let creditedTotal = 0;
  let eligibleEvents = 0;
  let playedEvents = 0;
  let missedEvents = 0;
  let byeEvents = 0;
  let leaveEvents = 0;
  let noEventCount = 0;
  const events = [];

  for (const match of matches) {
    const key = eventKey(match.cycleId, match.cycleWeek);
    if (noEvents.has(key)) {
      noEventCount += 1;
      events.push({ cycleId: match.cycleId, cycleWeek: match.cycleWeek, status: 'no_event', excluded: true, creditedScore: 0, eventIndex: 0 });
      continue;
    }

    if (uid && away.has(playerEventKey(uid, match.cycleId, match.cycleWeek))) {
      leaveEvents += 1;
      events.push({ cycleId: match.cycleId, cycleWeek: match.cycleWeek, status: 'on_leave', excluded: true, creditedScore: 0, eventIndex: 0 });
      continue;
    }

    const row = uid ? scores.get(playerEventKey(uid, match.cycleId, match.cycleWeek)) : null;
    const credited = Math.max(0, Number(row?.credited_score ?? row?.raw_score ?? 0));
    const baseIndex = contributionIndex(credited, baseline, exponent);
    const policy = policies.get(key) || { isBye: false, multiplier: 1 };
    const weekMultiplier = policy.isBye ? Math.max(0, finiteNumber(policy.multiplier, 1)) : 1;
    const adjustedIndex = baseIndex * weekMultiplier;

    eligibleEvents += 1;
    creditedTotal += credited;
    adjustedIndexTotal += adjustedIndex;
    if (credited > 0) playedEvents += 1;
    else missedEvents += 1;
    if (policy.isBye) byeEvents += 1;

    events.push({
      cycleId: match.cycleId,
      cycleWeek: match.cycleWeek,
      status: credited > 0 ? 'scored' : (row ? 'zero' : 'missed'),
      excluded: false,
      rawScore: row?.raw_score == null ? null : Number(row.raw_score),
      creditedScore: credited,
      baseIndex: round2(baseIndex),
      weekMultiplier,
      eventIndex: round2(adjustedIndex),
      leaderboardPosition: row?.leaderboard_position == null ? null : Number(row.leaderboard_position),
      capturedAt: String(row?.captured_at || match.capturedAt || ''),
    });
  }

  const eventIndex = eligibleEvents ? adjustedIndexTotal / eligibleEvents : 0;
  return {
    raw: creditedTotal,
    creditedTotal,
    averageCreditedScore: eligibleEvents ? round2(creditedTotal / eligibleEvents) : 0,
    index: round2(eventIndex),
    eventIndex: round2(eventIndex),
    baseline,
    eligibleEvents,
    playedEvents,
    missedEvents,
    byeEvents,
    leaveEvents,
    noEventCount,
    events,
  };
}

export function contributionIndex(performance, baseline, exponent) {
  const score = Math.max(0, Number(performance || 0));
  const base = Number(baseline || 0);
  const curve = Number(exponent || 0);
  if (!(score > 0) || !(base > 0) || !(curve > 0)) return 0;
  return 100 * Math.pow(score / base, curve);
}

function uniqueGloryWarMatches(rows) {
  const map = new Map();
  for (const row of rows) {
    const cycleId = String(row.cycle_id || '').trim();
    const cycleWeek = Number(row.cycle_week || 0);
    if (!cycleId || cycleWeek < 1 || cycleWeek > 4) continue;
    const key = eventKey(cycleId, cycleWeek);
    const candidate = { cycleId, cycleWeek, capturedAt: String(row.captured_at || '') };
    const current = map.get(key);
    if (!current || candidate.capturedAt >= current.capturedAt) map.set(key, candidate);
  }
  return [...map.values()].sort((a, b) => a.cycleId.localeCompare(b.cycleId) || a.cycleWeek - b.cycleWeek);
}

function eventKey(cycleId, cycleWeek) {
  return `${String(cycleId || '')}|${Number(cycleWeek || 0)}`;
}

function playerEventKey(uid, cycleId, cycleWeek) {
  return `${String(uid || '')}|${eventKey(cycleId, cycleWeek)}`;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonnegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function round1(value) { return Math.round(Number(value || 0) * 10) / 10; }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }
function formatNumber(value) { return new Intl.NumberFormat('en-US').format(Number(value || 0)); }

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
