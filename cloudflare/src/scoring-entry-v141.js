import portal from './scoring-entry-v140.js';

const DAY_META = [
  { dayIndex: 1, name: 'Tank Day', short: 'Tank', weight: 1 },
  { dayIndex: 2, name: 'Build Day', short: 'Build', weight: 2 },
  { dayIndex: 3, name: 'Science Day', short: 'Science', weight: 2 },
  { dayIndex: 4, name: 'Hero Day', short: 'Hero', weight: 2 },
  { dayIndex: 5, name: 'Training Day', short: 'Training', weight: 2 },
  { dayIndex: 6, name: 'Enemy Buster', short: 'Enemy Buster', weight: 4 },
];
const TOTAL_POINTS = 13;
const WIN_THRESHOLD = 7;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/duel' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return attachDuelOutcomes(response, env);
    }
    return portal.fetch(request, env, ctx);
  }
};

async function attachDuelOutcomes(response, env) {
  try {
    const body = await response.json();
    const cycleId = String(body?.cycleId || '').trim();
    const cycleWeek = Number(body?.cycleWeek || 0);
    if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return json(body, response.status);

    const [results, overrides, setting] = await Promise.all([
      env.DB.prepare(`
        SELECT day_index,event_name,alliance_score,opponent_score,is_win,captured_at
        FROM duel_results
        WHERE cycle_id=? AND cycle_week=?
        ORDER BY day_index
      `).bind(cycleId, cycleWeek).all(),
      env.DB.prepare(`
        SELECT day_index,is_win,source,note,updated_at
        FROM duel_day_outcome_override
        WHERE cycle_id=? AND cycle_week=?
        ORDER BY day_index
      `).bind(cycleId, cycleWeek).all(),
      env.DB.prepare(`SELECT numeric_value FROM scoring_settings WHERE setting_key='secured_week_multiplier_alliance_duel'`).first(),
    ]);

    const byDay = new Map();
    for (const row of overrides.results || []) {
      byDay.set(Number(row.day_index), {
        isWin: Number(row.is_win || 0) === 1,
        source: String(row.source || 'override'),
        allianceScore: null,
        opponentScore: null,
        capturedAt: String(row.updated_at || ''),
      });
    }
    for (const row of results.results || []) {
      if (row.is_win === null || row.is_win === undefined) continue;
      byDay.set(Number(row.day_index), {
        isWin: Number(row.is_win || 0) === 1,
        source: 'captured_result',
        allianceScore: row.alliance_score == null ? null : Number(row.alliance_score),
        opponentScore: row.opponent_score == null ? null : Number(row.opponent_score),
        capturedAt: String(row.captured_at || ''),
      });
    }

    let pointsWon = 0;
    let securedDayIndex = 0;
    const dayStates = new Map();
    for (const meta of DAY_META) {
      const result = byDay.get(meta.dayIndex);
      if (result?.isWin) pointsWon += meta.weight;
      const securedHere = !securedDayIndex && pointsWon >= WIN_THRESHOLD;
      if (securedHere) securedDayIndex = meta.dayIndex;
      dayStates.set(meta.dayIndex, {
        ...meta,
        ...(result || {}),
        known: Boolean(result),
        cumulativePointsWon: pointsWon,
        securedHere,
      });
    }

    const securedWeight = clamp01(setting?.numeric_value, 0.35);
    body.days = (body.days || []).map(day => {
      const state = dayStates.get(Number(day.dayIndex || 0)) || {};
      const afterSecured = securedDayIndex > 0 && Number(day.dayIndex || 0) > securedDayIndex;
      return {
        ...day,
        outcomeKnown: Boolean(state.known),
        isWin: state.known ? Boolean(state.isWin) : null,
        duelPointValue: Number(state.weight || 0),
        cumulativeDuelPointsWon: Number(state.cumulativePointsWon || 0),
        weekSecuredHere: Boolean(state.securedHere),
        afterWeekSecured: afterSecured,
        securedWeekMultiplier: afterSecured ? securedWeight : 1,
        officialAllianceScore: day.officialAllianceScore ?? state.allianceScore ?? null,
        opponentScore: state.opponentScore ?? null,
        outcomeSource: String(state.source || ''),
      };
    });
    body.weekOutcome = {
      totalPoints: TOTAL_POINTS,
      winThreshold: WIN_THRESHOLD,
      pointsWon,
      secured: securedDayIndex > 0,
      securedDayIndex,
      securedDayName: DAY_META.find(day => day.dayIndex === securedDayIndex)?.name || '',
      securedWeekWeight: securedWeight,
      knownDays: [...byDay.keys()].length,
    };
    body.summary = {
      ...(body.summary || {}),
      duelPointsWon: pointsWon,
      duelPointsPossible: TOTAL_POINTS,
      weekSecured: securedDayIndex > 0,
      weekSecuredDayIndex: securedDayIndex,
    };
    return json(body, response.status);
  } catch (error) {
    console.error('Could not attach Duel win outcomes', error);
    return response;
  }
}

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
