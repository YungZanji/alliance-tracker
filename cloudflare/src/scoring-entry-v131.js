import portal from './scoring-entry-v130.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await portal.fetch(request, env, ctx);
    if (url.pathname !== '/api/admin/scoring-context' || request.method !== 'GET' || !response.ok) {
      return response;
    }
    try {
      const body = await response.json();
      const cyclesResult = await env.DB.prepare(`
        SELECT cycle_id,MAX(cycle_week) AS latest_week,MAX(captured_at) AS latest_capture
        FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC
      `).all();
      body.cycles = (cyclesResult.results || []).map(row => ({
        id: String(row.cycle_id || ''),
        latestWeek: Number(row.latest_week || 1),
        latestCapture: String(row.latest_capture || ''),
      }));
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    } catch (_) {
      return response;
    }
  }
};
