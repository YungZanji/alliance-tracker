import portal from './scoring-entry-v141.js';

const PRIMARY_ALLIANCE = 'WDZ';
const DAY_NAMES = ['Tank Day', 'Build Day', 'Science Day', 'Hero Day', 'Training Day', 'Enemy Buster'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleSyncWithOutcomeFallback(request, env, ctx);
    }
    return portal.fetch(request, env, ctx);
  }
};

async function handleSyncWithOutcomeFallback(request, env, ctx) {
  let body;
  try {
    body = await request.clone().json();
  } catch (_) {
    return portal.fetch(request, env, ctx);
  }

  const response = await portal.fetch(request, env, ctx);
  if (!response.ok) return response;

  let result;
  try {
    result = await response.clone().json();
  } catch (_) {
    return response;
  }

  const cycleId = String(result?.cycleId || '').trim();
  const cycleWeek = Number(result?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return response;

  try {
    const derived = await ingestCompletedDayOutcomes(
      Array.isArray(body?.snapshots) ? body.snapshots : [],
      cycleId,
      cycleWeek,
      env,
    );
    return json({
      ...result,
      duelOutcomeFallback: {
        completedDaySnapshots: derived.snapshots,
        derivedDays: derived.days,
        source: 'completed_days_combined_rankings',
      },
    }, response.status);
  } catch (error) {
    console.error('Could not derive Duel outcomes from completed-day rankings', error);
    return response;
  }
}

async function ingestCompletedDayOutcomes(snapshots, cycleId, cycleWeek, env) {
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const bestByDay = new Map();
  let snapshotCount = 0;

  for (const snapshot of snapshots) {
    if (String(snapshot?.dataset || '') !== 'alliance_duel_rankings') continue;
    if (String(snapshot?.context?.rankTypeLabel || '') !== 'completed_days') continue;
    snapshotCount += 1;

    const capturedAt = String(snapshot?.captured_at || snapshot?.capturedAt || new Date().toISOString());
    const sourceHash = String(snapshot?.source_hash || snapshot?.sourceHash || '');
    const grouped = new Map();

    for (const raw of Array.isArray(snapshot?.rows) ? snapshot.rows : []) {
      const dayIndex = Number(raw?.dayIndex || 0);
      const alliance = String(raw?.allianceAbbr || '').trim();
      if (dayIndex < 1 || dayIndex > 6 || !alliance) continue;
      if (!grouped.has(dayIndex)) grouped.set(dayIndex, new Map());
      const totals = grouped.get(dayIndex);
      totals.set(alliance, Number(totals.get(alliance) || 0) + Number(raw?.score || 0));
    }

    for (const [dayIndex, totals] of grouped.entries()) {
      const allianceScore = Number(totals.get(primary) || 0);
      const opponents = [...totals.entries()].filter(([abbr]) => abbr !== primary);
      if (!totals.has(primary) || !opponents.length) continue;
      opponents.sort((a, b) => Number(b[1]) - Number(a[1]));
      const [opponentAbbr, opponentScoreRaw] = opponents[0];
      const opponentScore = Number(opponentScoreRaw || 0);
      if (allianceScore === opponentScore) continue; // Do not guess a tiebreak rule.

      const candidate = {
        dayIndex,
        allianceScore,
        opponentScore,
        opponentAbbr,
        isWin: allianceScore > opponentScore ? 1 : 0,
        capturedAt,
        sourceHash: sourceHash ? `completed-days:${sourceHash}` : `completed-days:${cycleId}:${cycleWeek}:${dayIndex}:${capturedAt}`,
      };
      const current = bestByDay.get(dayIndex);
      if (!current || candidate.capturedAt >= current.capturedAt) bestByDay.set(dayIndex, candidate);
    }
  }

  if (!bestByDay.size) return { snapshots: snapshotCount, days: [] };

  const statements = [];
  for (const row of bestByDay.values()) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO duel_results(
        cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,
        alliance_score,opponent_score,is_win,mvp_uid,mvp_name,mvp_score,captured_at,source_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      cycleId,
      cycleWeek,
      '',
      0,
      row.dayIndex,
      DAY_NAMES[row.dayIndex - 1] || `Day ${row.dayIndex}`,
      row.allianceScore,
      row.opponentScore,
      row.isWin,
      '',
      '',
      0,
      row.capturedAt,
      row.sourceHash,
    ));
  }
  await env.DB.batch(statements);

  return {
    snapshots: snapshotCount,
    days: [...bestByDay.values()].sort((a, b) => a.dayIndex - b.dayIndex).map(row => ({
      dayIndex: row.dayIndex,
      isWin: row.isWin === 1,
      allianceScore: row.allianceScore,
      opponentScore: row.opponentScore,
      opponentAbbr: row.opponentAbbr,
    })),
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
