import portal from './scoring-entry-v148.js';

const SESSION_COOKIE = 'at_session';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Guest login is handled by the existing guest layer. Re-emit its cookie as
    // SameSite=Lax so a successful temporary login survives normal navigation
    // and reloads on the custom portal domain.
    if (url.pathname === '/api/auth/guest-login' && request.method === 'POST') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      const headers = new Headers(response.headers);
      const cookie = headers.get('set-cookie');
      if (cookie) headers.set('set-cookie', cookie.replace(/SameSite=Strict/gi, 'SameSite=Lax'));
      headers.set('x-alliance-guest-session', 'created');
      return new Response(response.body, { status: response.status, headers });
    }

    // Do not make the regular-player auth bootstrap rediscover a synthetic
    // guest identity. Resolve guest sessions explicitly and return the guest
    // user contract directly. This prevents a valid guest login from falling
    // back to the UID login screen during the page reload/bootstrap cycle.
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const resolved = await resolveGuestSession(request, env);
      if (resolved.kind === 'guest') {
        return json({
          ok: true,
          user: {
            publicId: String(resolved.row.public_id || ''),
            name: String(resolved.row.display_name || resolved.row.current_name || 'Guest'),
            allianceAbbr: 'GUEST',
            allianceName: 'Guest Access',
            serverId: Number(resolved.row.server_id || 305),
            country: '',
            isAdmin: false,
            isGuest: true,
            guestUsername: String(resolved.row.username || ''),
            guestExpiresAt: String(resolved.row.guest_expires_at || ''),
          }
        });
      }
      if (resolved.kind === 'expired-guest') {
        if (resolved.tokenHash) {
          try { await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(resolved.tokenHash).run(); } catch (_) {}
        }
        return clearSession(json({ ok: false, error: 'Guest access has expired. Ask an administrator for a new guest login.' }, 401));
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function resolveGuestSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return { kind: 'none' };
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT
      s.uid,
      s.expires_at AS session_expires_at,
      g.guest_id,
      g.username,
      g.display_name,
      g.expires_at AS guest_expires_at,
      g.active AS guest_active,
      p.public_id,
      p.current_name,
      p.server_id
    FROM auth_sessions s
    LEFT JOIN guest_accounts g ON g.guest_uid=s.uid
    LEFT JOIN players p ON p.uid=s.uid
    WHERE s.token_hash=?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row || !String(row.uid || '').startsWith('guest:')) return { kind: 'normal', tokenHash };
  const now = Date.now();
  const sessionExpiry = Date.parse(String(row.session_expires_at || '')) || 0;
  const guestExpiry = Date.parse(String(row.guest_expires_at || '')) || 0;
  const valid = Number(row.guest_active || 0) === 1 && sessionExpiry > now && guestExpiry > now && row.guest_id && row.public_id;
  return valid ? { kind: 'guest', row, tokenHash } : { kind: 'expired-guest', row, tokenHash };
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function clearSession(response) {
  const headers = new Headers(response.headers);
  headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(response.body, { status: response.status, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
