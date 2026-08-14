import portal from './scoring-entry-v149.js';

const SESSION_COOKIE = 'at_session';

export default {
  async fetch(request, env, ctx) {
    // The shared event/auth layers require players.login_enabled=1 for any
    // authenticated read request. Guest identities cannot use normal UID login
    // because their UID is non-numeric, so enabling this flag is safe and lets
    // the existing read-only session travel through every older auth layer.
    try { await ensureGuestReadIdentity(request, env); } catch (error) {
      console.warn('Guest read-identity promotion skipped:', error);
    }
    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function ensureGuestReadIdentity(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT s.uid,p.login_enabled
    FROM auth_sessions s
    JOIN guest_accounts g ON g.guest_uid=s.uid
    JOIN players p ON p.uid=s.uid
    WHERE s.token_hash=?
      AND s.expires_at>?
      AND g.active=1
      AND g.expires_at>?
    LIMIT 1
  `).bind(tokenHash, now, now).first();
  if (!row || !String(row.uid || '').startsWith('guest:')) return;
  if (Number(row.login_enabled || 0) === 1) return;
  await env.DB.prepare('UPDATE players SET login_enabled=1 WHERE uid=?').bind(String(row.uid)).run();
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
