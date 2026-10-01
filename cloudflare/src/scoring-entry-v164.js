import portal from './scoring-entry-v163.js';

// Confirm the Glory War ingestion performed by v155 before the desktop marks
// its local score snapshot as synchronized. v155 intentionally leaves its
// regular Duel response unchanged, including failures in Glory ingestion.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/sync' || request.method !== 'POST') {
      return portal.fetch(request, env, ctx);
    }
    const copy = request.clone();
    const response = await portal.fetch(request, env, ctx);
    if (!response.ok) return response;
    let body, result;
    try {
      [body, result] = await Promise.all([copy.json(), response.clone().json()]);
    } catch (_) {
      return response;
    }
    if (!result?.ok) return response;
    const glory = (Array.isArray(body?.snapshots) ? body.snapshots : [])
      .filter(snapshot => snapshot?.dataset === 'glory_war_rankings');
    if (!glory.length) return response;
    try {
      const sourceHash = String(glory[glory.length - 1].source_hash || glory[glory.length - 1].sourceHash || '');
      if (!sourceHash) throw new Error('Missing Glory War source hash.');
      const match = await env.DB.prepare(
        'SELECT cycle_id,cycle_week,result,opponent_alliance_abbr,opponent_server_id,player_count FROM glory_war_matches WHERE source_hash=? ORDER BY captured_at DESC LIMIT 1'
      ).bind(sourceHash).first();
      if (!match) throw new Error('Glory War match was not persisted.');
      const scores = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM event_week_scores WHERE event_type='glory_war' AND cycle_id=? AND cycle_week=? AND source_hash=?"
      ).bind(match.cycle_id, match.cycle_week, sourceHash).first();
      const playerCount = Number(scores?.n || 0);
      if (playerCount < 1) throw new Error('Glory War player scores were not persisted.');
      return json({ ...result, glorySync: {
        ok: true, playerCount, cycleId: match.cycle_id, cycleWeek: match.cycle_week, result: match.result,
        opponentAllianceAbbr: match.opponent_alliance_abbr,
        opponentServerId: match.opponent_server_id
      } }, response.status, response.headers);
    } catch (error) {
      console.error('Glory War sync verification failed', error);
      return json({ ok: false, code: 'GLORY_SYNC_UNVERIFIED',
        error: `Glory War ingestion was not verified: ${String(error?.message || error)}. Retry is safe.` }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

function json(value, status, baseHeaders) {
  const headers = new Headers(baseHeaders || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers });
}
