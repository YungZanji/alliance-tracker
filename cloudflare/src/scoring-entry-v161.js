import portal from './scoring-entry-v160.js';

const ADMIN_SESSION_HOURS = 8;
const ADMIN_LOGIN_WINDOW_MINUTES = 15;
const ADMIN_LOGIN_ATTEMPT_LIMIT = 8;
const BOOTSTRAP_PREFIX = 'sha256:';
const HMAC_PREFIX = 'hmac256:';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/admin-login' && request.method === 'POST') {
      try {
        return await handleAdminLogin(request, env, ctx);
      } catch (error) {
        console.error('Administrator login runtime failure', error);
        return json({
          ok: false,
          error: 'Administrator authentication failed on the server. Please try again.',
          code: 'ADMIN_AUTH_RUNTIME'
        }, 500);
      }
    }

    if (url.pathname === '/api/auth/admin-password' && request.method === 'POST') {
      try {
        return await handleAdminPasswordChange(request, env, ctx);
      } catch (error) {
        console.error('Administrator password-change runtime failure', error);
        return json({
          ok: false,
          error: 'Administrator password change failed on the server. Please try again.',
          code: 'ADMIN_PASSWORD_RUNTIME'
        }, 500);
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handleAdminLogin(request, env, ctx) {
  const identity = await adminIdentity(request, env, ctx);
  if (identity.response) return identity.response;
  if (!identity.databaseAdmin || !identity.credential) {
    return json({ ok: false, error: 'Administrator access is not enabled for this account.' }, 403);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const password = String(body?.password || '');
  if (!password) return json({ ok: false, error: 'Enter your administrator password.' }, 400);

  await cleanupExpiredAdminSessions(env);
  const ipHash = await privacyHash(clientIp(request), env);
  const agent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const cutoff = new Date(Date.now() - ADMIN_LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM admin_login_audit
    WHERE success=0 AND created_at>=? AND (uid=? OR ip_hash=?)
  `).bind(cutoff, identity.uid, ipHash).first();

  if (Number(recent?.n || 0) >= ADMIN_LOGIN_ATTEMPT_LIMIT) {
    await recordAdminAttempt(env, identity.uid, 0, 'rate_limited', ipHash, agent);
    return json({ ok: false, error: 'Too many administrator password attempts. Try again in 15 minutes.' }, 429);
  }

  const valid = await verifyPassword(password, identity.credential, env);
  if (!valid) {
    await recordAdminAttempt(env, identity.uid, 0, 'bad_password', ipHash, agent);
    return json({ ok: false, error: 'Incorrect administrator password.' }, 403);
  }

  if (String(identity.credential.password_hash || '').startsWith(BOOTSTRAP_PREFIX)) {
    await upgradeCredentialToHmac(env, identity.uid, password, identity.credential.password_salt);
  }

  await recordAdminAttempt(env, identity.uid, 1, 'admin_login', ipHash, agent);
  const session = await createAdminSession(env, identity.uid, ipHash, agent);
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  headers.append('set-cookie', adminSessionCookie(session.token, ADMIN_SESSION_HOURS * 3600));
  return new Response(JSON.stringify({
    ok: true,
    user: {
      ...identity.rawUser,
      isAdmin: true,
      adminEligible: true,
      adminSessionExpiresAt: session.expiresAt
    }
  }), { status: 200, headers });
}

async function handleAdminPasswordChange(request, env, ctx) {
  const identity = await adminIdentity(request, env, ctx);
  if (identity.response) return identity.response;
  if (!identity.databaseAdmin || !identity.credential) {
    return json({ ok: false, error: 'Administrator access is not enabled for this account.' }, 403);
  }

  const verified = await verifiedAdminSession(request, env, identity.uid);
  if (!verified.valid) {
    return json({ ok: false, error: 'Administrator password required. Unlock administrator access first.' }, 403);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (newPassword.length < 14 || newPassword.length > 128) {
    return json({ ok: false, error: 'New administrator password must be at least 14 characters.' }, 400);
  }
  if (!(await verifyPassword(currentPassword, identity.credential, env))) {
    return json({ ok: false, error: 'Current administrator password is incorrect.' }, 403);
  }

  const salt = randomBytes(16);
  const saltBase64 = bytesToBase64(salt);
  const digest = await deriveHmacPassword(newPassword, saltBase64, env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE admin_credentials
      SET password_salt=?,password_hash=?,iterations=1,updated_at=?
      WHERE uid=?
    `).bind(saltBase64, `${HMAC_PREFIX}${digest}`, now, identity.uid),
    env.DB.prepare('DELETE FROM admin_sessions WHERE uid=?').bind(identity.uid)
  ]);

  const ipHash = await privacyHash(clientIp(request), env);
  const agent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const session = await createAdminSession(env, identity.uid, ipHash, agent);
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  headers.append('set-cookie', adminSessionCookie(session.token, ADMIN_SESSION_HOURS * 3600));
  return new Response(JSON.stringify({ ok: true, adminSessionExpiresAt: session.expiresAt }), { status: 200, headers });
}

async function adminIdentity(request, env, ctx) {
  const authUrl = new URL(request.url);
  authUrl.pathname = '/api/auth/me';
  authUrl.search = '';
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const agent = request.headers.get('user-agent');
  if (cookie) headers.set('cookie', cookie);
  if (agent) headers.set('user-agent', agent);

  const response = await portal.fetch(new Request(authUrl.toString(), { method: 'GET', headers }), env, ctx);
  if (!response.ok) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };

  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  const rawUser = payload?.user || null;
  const publicId = String(rawUser?.publicId || '').trim();
  if (!publicId) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };

  const player = await env.DB.prepare(`
    SELECT uid,public_id,current_name,is_admin
    FROM players
    WHERE public_id=?
    LIMIT 1
  `).bind(publicId).first();
  if (!player) return { response: json({ ok: false, error: 'Player identity is unavailable.' }, 403) };

  const credential = await env.DB.prepare(`
    SELECT uid,password_salt,password_hash,iterations,updated_at
    FROM admin_credentials
    WHERE uid=?
    LIMIT 1
  `).bind(String(player.uid || '')).first();

  return {
    rawUser,
    uid: String(player.uid || ''),
    databaseAdmin: Number(player.is_admin || 0) === 1,
    credential
  };
}

async function verifyPassword(password, credential, env) {
  if (!credential) return false;
  const stored = String(credential.password_hash || '');
  const saltBase64 = String(credential.password_salt || '');

  if (stored.startsWith(HMAC_PREFIX)) {
    const actual = await deriveHmacPassword(password, saltBase64, env);
    return timingSafeEqual(actual, stored.slice(HMAC_PREFIX.length));
  }

  if (stored.startsWith(BOOTSTRAP_PREFIX)) {
    const actual = await deriveBootstrapDigest(password, saltBase64);
    return timingSafeEqual(actual, stored.slice(BOOTSTRAP_PREFIX.length));
  }

  throw new Error('Unsupported administrator credential format.');
}

async function upgradeCredentialToHmac(env, uid, password, saltBase64) {
  const digest = await deriveHmacPassword(password, saltBase64, env);
  await env.DB.prepare(`
    UPDATE admin_credentials
    SET password_hash=?,iterations=1,updated_at=?
    WHERE uid=?
  `).bind(`${HMAC_PREFIX}${digest}`, new Date().toISOString(), uid).run();
}

async function deriveBootstrapDigest(password, saltBase64) {
  const salt = base64ToBytes(saltBase64);
  const passwordBytes = new TextEncoder().encode(String(password));
  const combined = new Uint8Array(salt.length + passwordBytes.length);
  combined.set(salt, 0);
  combined.set(passwordBytes, salt.length);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return bytesToBase64(new Uint8Array(digest));
}

async function deriveHmacPassword(password, saltBase64, env) {
  const pepper = String(env.ADMIN_PASSWORD_PEPPER || env.UPLOAD_TOKEN || '');
  if (!pepper) throw new Error('Administrator password pepper is not configured.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = new TextEncoder().encode(`${saltBase64}|${String(password)}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return bytesToBase64(new Uint8Array(signature));
}

async function verifiedAdminSession(request, env, uid) {
  const token = cookieValue(request, 'at_admin');
  if (!token) return { valid: false };
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT token_hash
    FROM admin_sessions
    WHERE token_hash=? AND uid=? AND expires_at>?
    LIMIT 1
  `).bind(tokenHash, uid, now).first();
  return { valid: Boolean(row) };
}

async function createAdminSession(env, uid, ipHash, agent) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 3600_000).toISOString();
  await env.DB.prepare(`
    INSERT INTO admin_sessions(token_hash,uid,created_at,expires_at,last_seen_at,ip_hash,user_agent)
    VALUES(?,?,?,?,?,?,?)
  `).bind(tokenHash, uid, now.toISOString(), expiresAt, now.toISOString(), ipHash, agent).run();
  return { token, expiresAt };
}

async function cleanupExpiredAdminSessions(env) {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(new Date().toISOString()).run();
}

async function recordAdminAttempt(env, uid, success, reason, ipHash, agent) {
  await env.DB.prepare(`
    INSERT INTO admin_login_audit(uid,success,reason,ip_hash,user_agent,created_at)
    VALUES(?,?,?,?,?,?)
  `).bind(uid || null, success ? 1 : 0, reason, ipHash, agent, new Date().toISOString()).run();
}

function clientIp(request) {
  return String(request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

async function privacyHash(value, env) {
  return sha256(`${String(env.UPLOAD_TOKEN || 'alliance-tracker')}|admin|${String(value || '')}`);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function randomToken() {
  return bytesToBase64(randomBytes(32)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function adminSessionCookie(token, maxAge) {
  return `at_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Priority=High; Max-Age=${maxAge}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
