import portal from './scoring-entry-v152.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return keepCurrentDuelDayLive(request, env, ctx);
    }
    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function keepCurrentDuelDayLive(request, env, ctx) {
  const response = await portal.fetch(request, env, ctx);
  if (!response.ok) return response;

  let body = null;
  try { body = await response.clone().json(); } catch (_) {}
  const cycleId = String(body?.cycleId || '').trim();
  const cycleWeek = Number(body?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return response;

  try {
    await env.DB.prepare(`
      UPDATE duel_results
      SET is_win=NULL,
          outcome_source='current_day_live'
      WHERE cycle_id=?
        AND cycle_week=?
        AND outcome_source='current_day_rankings'
    `).bind(cycleId, cycleWeek).run();
  } catch (error) {
    console.error('Could not mark the live Duel day as unresolved', error);
  }

  return response;
}

export function isLiveOutcomeSource(source) {
  return source === 'current_day_rankings' || source === 'current_day_live';
}
