import { handleOwnerLogin } from './src/scoring-entry-v161.js';
import portal from './src/scoring-entry-v164.js';

const DUEL_DATASETS = new Set([
  'alliance_duel_season', 'alliance_duel_group', 'alliance_duel_results',
  'alliance_duel_rankings', 'alliance_duel_league_totals'
]);
const ALLIANCE_ID = '0beb659cf5274a96952d91401ae41698';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/auth/owner-login' && request.method === 'POST') {
      if (!env.ADMIN_PASSWORD_PEPPER) return Response.json({ ok: false, error: 'Owner sign-in is not configured.' }, { status: 503 });
      return handleOwnerLogin(request, env, ctx);
    }
    const uploadsEnabled = Boolean(env.UPLOAD_TOKEN_36C);
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      if (!uploadsEnabled) return Response.json({ ok: false, error: '36C sync is not configured.' }, { status: 503 });
      let body;
      try { body = await request.clone().json(); } catch {
        return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
      }
      const token = body?.uploadToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (token !== env.UPLOAD_TOKEN_36C) return Response.json({ ok: false, error: 'Invalid upload token.' }, { status: 401 });
      const snapshots = body?.snapshots;
      const rows = Array.isArray(snapshots) ? snapshots.flatMap(s => s?.context?.rankTypeLabel === 'weekly_own_alliance' && Array.isArray(s.rows) ? s.rows : []) : [];
      if (!rows.length || !snapshots.every(s => DUEL_DATASETS.has(s?.dataset)) ||
          !rows.every(r => r?.allianceId === ALLIANCE_ID && r.allianceAbbr === '36C' && Number(r.serverId) === 261)) {
        return Response.json({ ok: false, error: 'Sync only the validated 36C State 261 Direct Duel session.' }, { status: 422 });
      }
      return portal.fetch(request, { ...env, UPLOAD_TOKEN: env.UPLOAD_TOKEN_36C }, ctx);
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, profileId: '36c-261', alliance: '36C',
        stateId: 261, uploadsEnabled, status: uploadsEnabled ? 'duel_sync_ready' : 'awaiting_capture_setup' });
    }
    // Existing portal authentication enforces administrator credentials and sessions.
    const adminAuth = ['/api/auth/admin-login', '/api/auth/admin-logout', '/api/auth/admin-password'].includes(url.pathname);
    if (env.ADMIN_PASSWORD_PEPPER && (url.pathname.startsWith('/api/admin/') || (adminAuth && request.method === 'POST'))) {
      return portal.fetch(request, env, ctx);
    }
    // Keep other legacy writes disabled.
    if (request.method !== 'GET' && request.method !== 'HEAD' &&
        !['/api/auth/login', '/api/auth/logout', '/api/auth/guest-login'].includes(url.pathname)) {
      return Response.json({ ok: false, error: '36C capture and administrator setup is pending.' }, { status: 503 });
    }
    return portal.fetch(request, env, ctx);
  }
};
