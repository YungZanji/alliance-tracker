import portal from './scoring-entry-v145.js';

const GUEST_SESSION_COOKIE = 'at_session';
const PASSWORD_ITERATIONS = 120000;
const MAX_GUEST_HOURS = 24 * 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/guest-login' && request.method === 'POST') {
      return handleGuestLogin(request, env);
    }

    if (url.pathname === '/api/admin/guests' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return listGuests(env);
    }
    if (url.pathname === '/api/admin/guests' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return createGuest(request, env);
    }
    if (url.pathname === '/api/admin/guests/purge-expired' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      const purged = await cleanupExpiredGuests(env);
      return json({ ok: true, purged });
    }
    const guestDelete = url.pathname.match(/^\/api\/admin\/guests\/([^/]+)$/);
    if (guestDelete && request.method === 'DELETE') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return deleteGuest(decodeURIComponent(guestDelete[1]), env);
    }

    // Guest accounts are intentionally read-only. Authentication/logout remain allowed.
    if (url.pathname.startsWith('/api/') && request.method !== 'GET' && ![
      '/api/auth/login', '/api/auth/logout', '/api/auth/guest-login'
    ].includes(url.pathname)) {
      const guest = await currentGuestSession(request, env);
      if (guest) return json({ ok: false, error: 'Guest access is read-only.' }, 403);
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      const guest = await currentGuestSession(request, env);
      if (!guest) return response;
      try {
        const body = await response.json();
        body.user = { ...(body.user || {}), isGuest: true, guestExpiresAt: guest.expires_at, guestUsername: guest.username };
        return json(body, response.status);
      } catch (_) {
        return response;
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredGuests(env));
  }
};

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function handleGuestLogin(request, env) {
  await cleanupExpiredGuests(env);
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || '');
  if (!username || !password) return json({ ok: false, error: 'Enter the guest username and password.' }, 400);

  const now = new Date().toISOString();
  const row = await env.DB.prepare(`
    SELECT g.*,p.public_id,p.current_name,p.alliance_abbr,p.alliance_name,p.server_id,p.country
    FROM guest_accounts g JOIN players p ON p.uid=g.guest_uid
    WHERE g.username_key=? AND g.active=1 AND g.expires_at>?
  `).bind(username, now).first();

  const ipHash = await privacyHash(clientIp(request), env);
  const enteredHash = await privacyHash(`guest:${username}`, env);
  const agent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const country = String(request.cf?.country || '');
  const colo = String(request.cf?.colo || '');

  if (!row || !(await verifyPassword(password, row.password_salt, row.password_hash, Number(row.password_iterations || PASSWORD_ITERATIONS)))) {
    await recordGuestLogin(env, { uid: row?.guest_uid || null, enteredHash, name: row?.display_name || '', success: 0, reason: 'guest_invalid', ipHash, country, colo, agent, now });
    return json({ ok: false, error: 'Guest username or password is incorrect, or this guest login has expired.' }, 401);
  }

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const sessionExpires = String(row.expires_at);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO auth_sessions(token_hash,uid,created_at,expires_at,last_seen_at,ip_hash,user_agent) VALUES(?,?,?,?,?,?,?)`)
      .bind(tokenHash, row.guest_uid, now, sessionExpires, now, ipHash, agent),
    env.DB.prepare(`UPDATE guest_accounts SET last_login_at=?,login_count=login_count+1 WHERE guest_id=?`).bind(now, row.guest_id),
    env.DB.prepare(`UPDATE players SET last_login_at=?,login_count=login_count+1,last_seen_at=? WHERE uid=?`).bind(now, now, row.guest_uid),
    env.DB.prepare(`INSERT INTO login_audit(uid,entered_uid_hash,player_name,success,reason,ip_hash,country,colo,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.guest_uid, enteredHash, String(row.display_name || ''), 1, 'guest_login', ipHash, country, colo, agent, now),
  ]);

  const maxAge = Math.max(1, Math.floor((Date.parse(sessionExpires) - Date.now()) / 1000));
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  headers.append('set-cookie', `${GUEST_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
  return new Response(JSON.stringify({
    ok: true,
    user: {
      publicId: String(row.public_id || ''),
      name: String(row.display_name || row.current_name || 'Guest'),
      allianceAbbr: 'GUEST',
      allianceName: 'Guest Access',
      serverId: Number(row.server_id || 305),
      country: '',
      isAdmin: false,
      isGuest: true,
      guestUsername: String(row.username || ''),
      guestExpiresAt: sessionExpires,
    }
  }), { status: 200, headers });
}

async function listGuests(env) {
  await cleanupExpiredGuests(env);
  const result = await env.DB.prepare(`
    SELECT guest_id,username,display_name,created_at,expires_at,last_login_at,login_count,active
    FROM guest_accounts
    ORDER BY expires_at ASC,created_at DESC
  `).all();
  const now = Date.now();
  return json({
    ok: true,
    guests: (result.results || []).map(row => ({
      guestId: String(row.guest_id || ''),
      username: String(row.username || ''),
      displayName: String(row.display_name || ''),
      createdAt: String(row.created_at || ''),
      expiresAt: String(row.expires_at || ''),
      lastLoginAt: String(row.last_login_at || ''),
      loginCount: Number(row.login_count || 0),
      active: Number(row.active || 0) === 1 && Date.parse(String(row.expires_at || '')) > now,
      remainingSeconds: Math.max(0, Math.floor((Date.parse(String(row.expires_at || '')) - now) / 1000)),
    }))
  });
}

async function createGuest(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const username = normalizeUsername(body?.username);
  const displayName = String(body?.displayName || body?.username || '').trim().slice(0, 60);
  let password = String(body?.password || '');
  const durationHours = clampNumber(body?.durationHours, 1, MAX_GUEST_HOURS, 24);
  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    return json({ ok: false, error: 'Guest username must be 3–32 characters using letters, numbers, dots, dashes, or underscores.' }, 400);
  }
  if (displayName.length < 2) return json({ ok: false, error: 'Give this guest login a display label.' }, 400);
  const generatedPassword = !password;
  if (!password) password = generatePassword();
  if (password.length < 8 || password.length > 128) return json({ ok: false, error: 'Guest password must be at least 8 characters.' }, 400);

  const existing = await env.DB.prepare('SELECT guest_id FROM guest_accounts WHERE username_key=?').bind(username).first();
  if (existing) return json({ ok: false, error: 'That guest username is already in use.' }, 409);

  const guestId = `g_${randomToken(10)}`;
  const guestUid = `guest:${guestId}`;
  const publicId = `guest-${randomToken(12)}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + durationHours * 3_600_000).toISOString();
  const salt = randomToken(18);
  const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO players(uid,public_id,current_name,alliance_id,alliance_abbr,alliance_name,server_id,country,first_seen_at,last_seen_at,login_enabled,is_admin)
      VALUES(?,?,?,NULL,'GUEST','Guest Access',305,'',?,?,0,0)
    `).bind(guestUid, publicId, `Guest · ${displayName}`, nowIso, nowIso),
    env.DB.prepare(`
      INSERT INTO guest_accounts(guest_id,username,username_key,display_name,guest_uid,password_salt,password_hash,password_iterations,created_at,expires_at,last_login_at,login_count,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,0,1)
    `).bind(guestId, String(body?.username || '').trim(), username, displayName, guestUid, salt, passwordHash, PASSWORD_ITERATIONS, nowIso, expiresAt),
  ]);

  return json({
    ok: true,
    guest: { guestId, username: String(body?.username || '').trim(), displayName, createdAt: nowIso, expiresAt, durationHours, active: true },
    password: generatedPassword ? password : null,
    passwordGenerated: generatedPassword,
  }, 201);
}

async function deleteGuest(guestId, env) {
  const row = await env.DB.prepare('SELECT guest_uid,username FROM guest_accounts WHERE guest_id=?').bind(guestId).first();
  if (!row) return json({ ok: false, error: 'Guest account not found.' }, 404);
  await env.DB.prepare('DELETE FROM players WHERE uid=?').bind(row.guest_uid).run();
  return json({ ok: true, deleted: guestId, username: String(row.username || '') });
}

async function cleanupExpiredGuests(env) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`SELECT guest_uid FROM guest_accounts WHERE active=0 OR expires_at<=?`).bind(now).all();
  const rows = result.results || [];
  if (!rows.length) return 0;
  const statements = rows.map(row => env.DB.prepare('DELETE FROM players WHERE uid=?').bind(row.guest_uid));
  for (let i = 0; i < statements.length; i += 80) await env.DB.batch(statements.slice(i, i + 80));
  return rows.length;
}

async function currentGuestSession(request, env) {
  const token = cookieValue(request, GUEST_SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  const now = new Date().toISOString();
  return env.DB.prepare(`
    SELECT g.guest_id,g.username,g.display_name,g.expires_at
    FROM auth_sessions s JOIN guest_accounts g ON g.guest_uid=s.uid
    WHERE s.token_hash=? AND s.expires_at>? AND g.active=1 AND g.expires_at>?
  `).bind(hash, now, now).first();
}

async function recordGuestLogin(env, row) {
  try {
    await env.DB.prepare(`INSERT INTO login_audit(uid,entered_uid_hash,player_name,success,reason,ip_hash,country,colo,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.uid, row.enteredHash, row.name, row.success, row.reason, row.ipHash, row.country, row.colo, row.agent, row.now).run();
  } catch (_) {}
}

async function hashPassword(password, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPassword(password, salt, expected, iterations) {
  const actual = await hashPassword(password, salt, iterations);
  return constantTimeEqual(actual, String(expected || ''));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToBase64(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function privacyHash(value, env) {
  return sha256(`${String(env.PRIVACY_HASH_SALT || env.SESSION_SECRET || 'alliance-tracker')}:${String(value || '')}`);
}

function clientIp(request) {
  return String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function randomToken(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const data = new Uint8Array(18);
  crypto.getRandomValues(data);
  return [...data].map(byte => alphabet[byte % alphabet.length]).join('');
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
