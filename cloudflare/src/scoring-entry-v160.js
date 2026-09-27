import portal from './scoring-entry-v159.js';

const ADMIN_SESSION_HOURS = 8;
const ADMIN_LOGIN_WINDOW_MINUTES = 15;
const ADMIN_LOGIN_ATTEMPT_LIMIT = 8;
const ADMIN_PASSWORD_ITERATIONS = 210_000;
const BOOTSTRAP_SALT = 'pB6s/alHGndgk7HNYyIkpA==';
const BOOTSTRAP_HASH = 'e2CJsw/1zZir8fQvgZm9v3ztCFvxK9QIpTYSaicbBw0=';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const response = await portal.fetch(request, env, ctx);
      return decorateAuthResponse(response, request, env, ctx, false);
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      return decorateAuthResponse(response, request, env, ctx, true);
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      await revokeAdminCookie(request, env);
      const response = await portal.fetch(request, env, ctx);
      const headers = new Headers(response.headers);
      headers.append('set-cookie', clearAdminCookie());
      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname === '/api/auth/admin-login' && request.method === 'POST') {
      return handleAdminLogin(request, env, ctx);
    }

    if (url.pathname === '/api/auth/admin-logout' && request.method === 'POST') {
      await revokeAdminCookie(request, env);
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      headers.append('set-cookie', clearAdminCookie());
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (url.pathname === '/api/auth/admin-password' && request.method === 'POST') {
      return handleAdminPasswordChange(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/admin/')) {
      const gate = await requireAdminPassword(request, env, ctx);
      if (gate.response) return gate.response;
      return portal.fetch(request, env, ctx);
    }

    if ((url.pathname === '/api/glory-war-plan' || url.pathname === '/api/canyon-plan') && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      return sanitizeManageResponse(response, request, env, ctx);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function decorateAuthResponse(response, request, env, ctx, checkAdminCookie) {
  if (!response.ok) return response;
  let payload = {};
  try { payload = await response.clone().json(); } catch (_) { return response; }
  if (!payload?.user) return response;

  const decorated = await decorateUser(payload.user, request, env, ctx, checkAdminCookie);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ...payload, user: decorated }), { status: response.status, headers });
}

async function decorateUser(rawUser, request, env, ctx, checkAdminCookie = true) {
  const identity = await credentialIdentity(rawUser, env);
  let isAdmin = false;
  let adminExpiresAt = '';
  if (checkAdminCookie && identity?.uid) {
    const verified = await verifiedAdminSession(request, env, identity.uid, true);
    isAdmin = Boolean(verified.valid);
    adminExpiresAt = String(verified.expiresAt || '');
  }

  return {
    ...rawUser,
    isAdmin,
    adminEligible: Boolean(identity?.eligible),
    adminSessionExpiresAt: adminExpiresAt
  };
}

async function rawIdentity(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const agent = request.headers.get('user-agent');
  if (cookie) headers.set('cookie', cookie);
  if (agent) headers.set('user-agent', agent);
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers }), env, ctx);
  if (!response.ok) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  const rawUser = payload?.user || null;
  if (!rawUser?.publicId) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  const identity = await credentialIdentity(rawUser, env, true);
  return { rawUser, identity };
}

async function credentialIdentity(rawUser, env, allowBootstrap = false) {
  const publicId = String(rawUser?.publicId || '').trim();
  if (!publicId) return null;
  const player = await env.DB.prepare(`
    SELECT uid,public_id,current_name,is_admin
    FROM players
    WHERE public_id=?
    LIMIT 1
  `).bind(publicId).first();
  if (!player) return null;

  let credential = await env.DB.prepare(`
    SELECT uid,password_salt,password_hash,iterations,updated_at
    FROM admin_credentials
    WHERE uid=?
    LIMIT 1
  `).bind(String(player.uid || '')).first();

  if (!credential && allowBootstrap && Number(player.is_admin || 0) === 1) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_credentials').first();
    if (Number(count?.n || 0) === 0) {
      const now = new Date().toISOString();
      await env.DB.prepare(`
        INSERT INTO admin_credentials(uid,password_salt,password_hash,iterations,created_at,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(uid) DO NOTHING
      `).bind(String(player.uid || ''), BOOTSTRAP_SALT, BOOTSTRAP_HASH, ADMIN_PASSWORD_ITERATIONS, now, now).run();
      credential = await env.DB.prepare(`
        SELECT uid,password_salt,password_hash,iterations,updated_at
        FROM admin_credentials
        WHERE uid=?
        LIMIT 1
      `).bind(String(player.uid || '')).first();
    }
  }

  return {
    uid: String(player.uid || ''),
    publicId,
    name: String(player.current_name || rawUser?.name || ''),
    databaseAdmin: Number(player.is_admin || 0) === 1,
    eligible: Number(player.is_admin || 0) === 1 && Boolean(credential),
    credential
  };
}

async function handleAdminLogin(request, env, ctx) {
  const base = await rawIdentity(request, env, ctx);
  if (base.response) return base.response;
  const { rawUser, identity } = base;
  if (!identity?.eligible || !identity.databaseAdmin) {
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

  const valid = await verifyPassword(password, identity.credential);
  if (!valid) {
    await recordAdminAttempt(env, identity.uid, 0, 'bad_password', ipHash, agent);
    return json({ ok: false, error: 'Incorrect administrator password.' }, 403);
  }

  await recordAdminAttempt(env, identity.uid, 1, 'admin_login', ipHash, agent);
  const session = await createAdminSession(env, identity.uid, ipHash, agent);
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('set-cookie', adminSessionCookie(session.token, ADMIN_SESSION_HOURS * 3600));
  const user = { ...rawUser, isAdmin: true, adminEligible: true, adminSessionExpiresAt: session.expiresAt };
  return new Response(JSON.stringify({ ok: true, user }), { status: 200, headers });
}

async function handleAdminPasswordChange(request, env, ctx) {
  const gate = await requireAdminPassword(request, env, ctx);
  if (gate.response) return gate.response;
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (newPassword.length < 14 || newPassword.length > 128) {
    return json({ ok: false, error: 'New administrator password must be at least 14 characters.' }, 400);
  }
  if (!(await verifyPassword(currentPassword, gate.identity.credential))) {
    return json({ ok: false, error: 'Current administrator password is incorrect.' }, 403);
  }

  const salt = randomBytes(16);
  const saltBase64 = bytesToBase64(salt);
  const hash = await derivePasswordHash(newPassword, salt, ADMIN_PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE admin_credentials
      SET password_salt=?,password_hash=?,iterations=?,updated_at=?
      WHERE uid=?
    `).bind(saltBase64, hash, ADMIN_PASSWORD_ITERATIONS, now, gate.identity.uid),
    env.DB.prepare('DELETE FROM admin_sessions WHERE uid=?').bind(gate.identity.uid)
  ]);

  const ipHash = await privacyHash(clientIp(request), env);
  const agent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const session = await createAdminSession(env, gate.identity.uid, ipHash, agent);
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('set-cookie', adminSessionCookie(session.token, ADMIN_SESSION_HOURS * 3600));
  return new Response(JSON.stringify({ ok: true, adminSessionExpiresAt: session.expiresAt }), { status: 200, headers });
}

async function requireAdminPassword(request, env, ctx) {
  const base = await rawIdentity(request, env, ctx);
  if (base.response) return base;
  const { identity } = base;
  if (!identity?.eligible || !identity.databaseAdmin) {
    return { response: json({ ok: false, error: 'Administrator access is not enabled for this account.' }, 403) };
  }
  const verified = await verifiedAdminSession(request, env, identity.uid, true);
  if (!verified.valid) {
    return { response: json({ ok: false, error: 'Administrator password required. Unlock administrator access first.' }, 403) };
  }
  return { identity, verified };
}

async function sanitizeManageResponse(response, request, env, ctx) {
  if (!response.ok) return response;
  let payload = {};
  try { payload = await response.clone().json(); } catch (_) { return response; }
  const base = await rawIdentity(request, env, ctx);
  let canManage = false;
  if (!base.response && base.identity?.eligible) {
    canManage = Boolean((await verifiedAdminSession(request, env, base.identity.uid, false)).valid);
  }
  payload.canManage = canManage;
  if (!canManage && Array.isArray(payload.history)) payload.history = [];
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(payload), { status: response.status, headers });
}

async function verifiedAdminSession(request, env, uid, touch) {
  const token = cookieValue(request, 'at_admin');
  if (!token) return { valid: false, expiresAt: '' };
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT token_hash,uid,expires_at,last_seen_at
    FROM admin_sessions
    WHERE token_hash=? AND uid=? AND expires_at>?
    LIMIT 1
  `).bind(tokenHash, uid, now).first();
  if (!row) return { valid: false, expiresAt: '' };
  if (touch) {
    const lastSeen = Date.parse(String(row.last_seen_at || '')) || 0;
    if (Date.now() - lastSeen > 5 * 60_000) {
      env.DB.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?').bind(now, tokenHash).run().catch(() => {});
    }
  }
  return { valid: true, expiresAt: String(row.expires_at || '') };
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

async function revokeAdminCookie(request, env) {
  const token = cookieValue(request, 'at_admin');
  if (!token) return;
  const tokenHash = await sha256(token);
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(tokenHash).run().catch(() => {});
}

async function cleanupExpiredAdminSessions(env) {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(new Date().toISOString()).run();
}

async function verifyPassword(password, credential) {
  if (!credential) return false;
  const salt = base64ToBytes(String(credential.password_salt || ''));
  const iterations = Math.max(100_000, Number(credential.iterations || ADMIN_PASSWORD_ITERATIONS));
  const actual = await derivePasswordHash(password, salt, iterations);
  return timingSafeEqual(actual, String(credential.password_hash || ''));
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function recordAdminAttempt(env, uid, success, reason, ipHash, agent) {
  await env.DB.prepare(`
    INSERT INTO admin_login_audit(uid,success,reason,ip_hash,user_agent,created_at)
    VALUES(?,?,?,?,?,?)
  `).bind(uid || null, success ? 1 : 0, reason, ipHash, agent, new Date().toISOString()).run();
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
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

function clearAdminCookie() {
  return 'at_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Priority=High; Max-Age=0';
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
