import portal from './scoring-entry-v155.js';

const PRIMARY_STATE = 305;
const ACCEPTED_CONFIDENCE = new Set(['explicit', 'ranking_rows']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      let incoming = null;
      try { incoming = await request.clone().json(); } catch (_) {}
      const response = await portal.fetch(request, env, ctx);
      if (response.ok && incoming) {
        try {
          const result = await response.clone().json();
          await ingestStateRulerMatchup(incoming.snapshots || [], result, env);
        } catch (error) {
          console.error('SVS opponent-state ingestion failed', error);
        }
      }
      return response;
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

export function findStateRulerMatchup(snapshots) {
  const relevant = (Array.isArray(snapshots) ? snapshots : [])
    .filter(snapshot => ['state_ruler_rankings', 'state_ruler_attendance'].includes(String(snapshot?.dataset || '')))
    .map(snapshot => {
      const context = snapshot?.context || {};
      const opponentState = Number(context.opponentServerId || context.opponentState || 0);
      const primaryState = Number(context.primaryServerId || PRIMARY_STATE);
      const confidence = String(context.opponentDetectionConfidence || '');
      return {
        opponentState,
        primaryState,
        opponentLabel: String(context.opponentLabel || (opponentState ? `State ${opponentState}` : '')),
        confidence,
        detectionSource: String(context.opponentDetectionSource || ''),
        capturedAt: String(snapshot?.captured_at || snapshot?.capturedAt || ''),
      };
    })
    .filter(row =>
      row.opponentState >= 1
      && row.opponentState <= 99999
      && row.opponentState !== row.primaryState
      && ACCEPTED_CONFIDENCE.has(row.confidence)
    )
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  return relevant[0] || null;
}

async function ingestStateRulerMatchup(snapshots, syncResult, env) {
  const cycleId = String(syncResult?.cycleId || '').trim();
  const cycleWeek = Number(syncResult?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return null;

  const matchup = findStateRulerMatchup(snapshots);
  if (!matchup) return null;
  const updatedAt = matchup.capturedAt || new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO event_week_context(
      event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at,updated_by_uid
    ) VALUES('state_ruler',?,?,?,?, 'svs_capture', ?, NULL)
    ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
      opponent_state=excluded.opponent_state,
      opponent_label=excluded.opponent_label,
      source=excluded.source,
      updated_at=excluded.updated_at,
      updated_by_uid=NULL
    WHERE excluded.updated_at >= event_week_context.updated_at
  `).bind(
    cycleId,
    cycleWeek,
    matchup.opponentState,
    matchup.opponentLabel || `State ${matchup.opponentState}`,
    updatedAt,
  ).run();

  return {
    cycleId,
    cycleWeek,
    opponentState: matchup.opponentState,
    opponentLabel: matchup.opponentLabel || `State ${matchup.opponentState}`,
    source: 'svs_capture',
    confidence: matchup.confidence,
    detectionSource: matchup.detectionSource,
    updatedAt,
  };
}
