import portal from './src/scoring-entry-v164.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, profileId: '36c-261', alliance: '36C',
        stateId: 261, uploadsEnabled: false, status: 'awaiting_capture_setup' });
    }
    // First launch deliberately cannot ingest unvalidated or old WDZ sessions.
    if (request.method !== 'GET' && request.method !== 'HEAD' &&
        !['/api/auth/login', '/api/auth/logout', '/api/auth/guest-login'].includes(url.pathname)) {
      return Response.json({ ok: false, error: '36C capture and administrator setup is pending.' }, { status: 503 });
    }
    return portal.fetch(request, env, ctx);
  }
};
