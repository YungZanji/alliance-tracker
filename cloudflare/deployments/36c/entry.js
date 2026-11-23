import { handleLeaguePower, handleLeague } from './catalog-power.js';
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
    if (url.pathname === '/api/duel/league' && request.method === 'GET') return handleLeague(request,env,ctx,portal);
    if (url.pathname === '/api/duel/league-power' && request.method === 'GET') return handleLeaguePower(request,env,ctx,portal);
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
      // Opponent ranking rows are used in memory to calculate team totals; only
      // primary alliance player rows are persisted by the Duel ingest pipeline.
      const own = r => r?.allianceId === ALLIANCE_ID && r.allianceAbbr === '36C' && Number(r.serverId) === 261;
      for (const snapshot of snapshots) {
        if (snapshot.dataset === 'alliance_duel_rankings' &&
            snapshot.rows?.some(row => row?.allianceAbbr === '36C' && !own(row))) {
          return Response.json({ ok: false, error: 'Invalid 36C player identity.' }, { status: 422 });
        }
        if (snapshot.dataset === 'alliance_duel_results' && Array.isArray(snapshot.rows)) {
          snapshot.rows = snapshot.rows.map(row => row?.mvp && !rows.some(member => String(member.uid) === String(row.mvp.uid)) ? { ...row, mvp: null } : row);
        }
      }
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      return portal.fetch(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(body) }), { ...env, UPLOAD_TOKEN: env.UPLOAD_TOKEN_36C }, ctx);
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, profileId: '36c-261', alliance: '36C',
        stateId: 261, uploadsEnabled, status: uploadsEnabled ? 'duel_sync_ready' : 'awaiting_capture_setup' });
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      const headers = new Headers(response.headers);
      headers.append('set-cookie', 'at_admin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
      return new Response(response.body, { status: response.status, headers });
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
