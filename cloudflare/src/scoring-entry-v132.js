import portal from './scoring-entry-v131.js';

const PRIMARY_ALLIANCE = 'WDZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/participation' || request.method !== 'GET') {
      return portal.fetch(request, env, ctx);
    }

    // Let the underlying authenticated route enforce the existing roster/session gate.
    const gate = await portal.fetch(request, env, ctx);
    if (!gate.ok) return gate;
    return handleParticipation(env);
  }
};

async function handleParticipation(env) {
  const weightsResult = await env.DB.prepare('SELECT event_type,label,weight,enabled FROM participation_weights ORDER BY event_type').all();
  const weights = (weightsResult.results || []).map(row => ({
    eventType: String(row.event_type),
    label: String(row.label),
    weight: Number(row.weight || 0),
    enabled: Number(row.enabled || 0) === 1,
  }));
  const playersResult = await env.DB.prepare(`
    SELECT uid,public_id,current_name,alliance_abbr,server_id FROM players
    WHERE alliance_abbr=?
  `).bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all();
  const [duelRows, eventRows, policyRows] = await Promise.all([
    env.DB.prepare('SELECT cycle_id,cycle_week,uid,score FROM duel_weekly').all(),
    env.DB.prepare('SELECT event_type,cycle_id,cycle_week,uid,credited_score,credit_source FROM event_week_scores').all(),
    env.DB.prepare('SELECT event_type,cycle_id,cycle_week,weight_multiplier FROM event_week_policy').all(),
  ]);

  const policyMap = new Map((policyRows.results || []).map(row => [weekKey(row.event_type, row.cycle_id, row.cycle_week), Number(row.weight_multiplier ?? 1)]));
  const models = new Map();

  const add = (eventType, row, score, source = 'score') => {
    if (!models.has(eventType)) models.set(eventType, new Map());
    const weeks = models.get(eventType);
    const key = `${row.cycle_id}|${Number(row.cycle_week)}`;
    if (!weeks.has(key)) {
      weeks.set(key, {
        cycleId: String(row.cycle_id),
        cycleWeek: Number(row.cycle_week),
        scores: new Map(),
        top: 0,
        hasLeaderboard: eventType !== 'state_ruler',
      });
    }
    const week = weeks.get(key);
    const uid = String(row.uid);
    const value = Number(score || 0);
    const current = Number(week.scores.get(uid) || 0);
    if (value > current) week.scores.set(uid, value);
    week.top = Math.max(week.top, value);
    if (eventType === 'state_ruler' && source === 'leaderboard') week.hasLeaderboard = true;
  };

  for (const row of duelRows.results || []) add('alliance_duel', row, row.score, 'leaderboard');
  for (const row of eventRows.results || []) add(String(row.event_type), row, row.credited_score, String(row.credit_source || 'score'));

  const available = {};
  for (const weight of weights) {
    const weeks = models.get(weight.eventType) || new Map();
    available[weight.eventType] = [...weeks.values()].some(week => week.top > 0 && (weight.eventType !== 'state_ruler' || week.hasLeaderboard));
  }

  const players = (playersResult.results || []).map(player => {
    const components = {};
    let combinedNumerator = 0;
    let combinedDenominator = 0;

    for (const weight of weights) {
      const weeks = models.get(weight.eventType) || new Map();
      let eventNumerator = 0;
      let eventDenominator = 0;
      let rawTotal = 0;
      let scoredWeeks = 0;

      for (const week of weeks.values()) {
        if (week.top <= 0) continue;
        if (weight.eventType === 'state_ruler' && !week.hasLeaderboard) continue;
        const raw = Number(week.scores.get(String(player.uid)) || 0);
        rawTotal += raw;
        const index = Math.min(100, raw * 100 / week.top);
        const multiplier = policyMap.get(weekKey(weight.eventType, week.cycleId, week.cycleWeek)) ?? 1;
        if (multiplier <= 0) continue;
        eventNumerator += index * multiplier;
        eventDenominator += multiplier;
        scoredWeeks += 1;
      }

      const eventIndex = eventDenominator ? eventNumerator / eventDenominator : 0;
      components[weight.eventType] = {
        raw: rawTotal,
        index: Number(eventIndex.toFixed(2)),
        available: Boolean(available[weight.eventType]),
        weight: weight.weight,
        weeks: scoredWeeks,
      };
      if (weight.enabled && available[weight.eventType] && weight.weight > 0) {
        combinedNumerator += eventIndex * weight.weight;
        combinedDenominator += weight.weight;
      }
    }

    return {
      publicId: String(player.public_id || ''),
      name: String(player.current_name || ''),
      allianceAbbr: String(player.alliance_abbr || ''),
      serverId: Number(player.server_id || 0),
      score: combinedDenominator ? Number((combinedNumerator / combinedDenominator).toFixed(2)) : 0,
      components,
    };
  });

  players.sort((a, b) => b.score - a.score || Number(b.components.alliance_duel?.raw || 0) - Number(a.components.alliance_duel?.raw || 0) || a.name.localeCompare(b.name));
  players.forEach((row, index) => row.rank = index + 1);
  return json({
    ok: true,
    players,
    weights,
    availability: available,
    method: 'Each event is normalized week-by-week against that week’s top credited score, then adjusted by the event/week importance multiplier. State Ruler attendance without a leaderboard score receives the configured minimum credit, but an SVS week does not enter the weighted leaderboard until at least one real State Ruler leaderboard score has been captured for that week.'
  });
}

function weekKey(eventType, cycleId, cycleWeek) {
  return `${eventType}|${cycleId}|${Number(cycleWeek)}`;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
