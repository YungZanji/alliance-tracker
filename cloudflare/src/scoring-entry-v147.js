import guestPortal from './scoring-entry-v146.js';
import portal from './scoring-entry-v145.js';

const PASSWORD_ITERATIONS = 120000;
const MAX_GUEST_HOURS = 24 * 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/guests' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return createGuestSafely(request, env);
    }
    return guestPortal.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof guestPortal.scheduled === 'function') return guestPortal.scheduled(controller, env, ctx);
  }
};

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function createGuestSafely(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {}

  const usernameKey = normalizeUsername(body?.username);
  const username = String(body?.username || '').trim();
  const displayName = String(body?.displayName || body?.username || '').trim().slice(0, 60);
  let password = String(body?.password || '');
  const durationHours = clampNumber(body?.durationHours, 1, MAX_GUEST_HOURS, 24);

  if (!usernameKey || !/^[a-z0-9._-]{3,32}$/.test(usernameKey)) {
    return json({ ok: false, error: 'Guest username must be 3–32 characters using letters, numbers, dots, dashes, or underscores.' }, 400);
  }
  if (displayName.length < 2) return json({ ok: false, error: 'Give this guest login a display label.' }, 400);

  const generatedPassword = !password;
  if (!password) password = generatePassword();
  if (password.length < 8 || password.length > 128) {
    return json({ ok: false, error: 'Guest password must be at least 8 characters.' }, 400);
  }

  try {
    const existing = await env.DB.prepare('SELECT guest_id FROM guest_accounts WHERE username_key=?').bind(usernameKey).first();
    if (existing) return json({ ok: false, error: 'That guest username is already in use.' }, 409);
  } catch (error) {
    return guestFailure('checking the guest username', error);
  }

  const guestId = `g_${randomToken(10)}`;
  const guestUid = `guest:${guestId}`;
  const publicId = `guest-${randomToken(12)}`;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + durationHours * 3_600_000).toISOString();
  const salt = randomToken(18);

  let passwordHash;
  try {
    passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
  } catch (error) {
    return guestFailure('securing the guest password', error);
  }

  // Keep these writes separate. This makes the foreign-key dependency explicit in D1,
  // gives us a useful error stage, and lets us remove the shadow player if credential
  // creation fails for any reason.
  try {
    await env.DB.prepare(`
      INSERT INTO players(
        uid,public_id,current_name,alliance_id,alliance_abbr,alliance_name,server_id,country,
        first_seen_at,last_seen_at,login_enabled,is_admin,last_login_at,login_count
      ) VALUES(?,?,?,NULL,'GUEST','Guest Access',305,'',?,?,0,0,NULL,0)
    `).bind(guestUid, publicId, `Guest · ${displayName}`, nowIso, nowIso).run();
  } catch (error) {
    return guestFailure('creating the read-only guest identity', error);
  }

  try {
    const shadow = await env.DB.prepare('SELECT uid FROM players WHERE uid=?').bind(guestUid).first();
    if (!shadow) throw new Error('Guest identity was not persisted by D1.');
  } catch (error) {
    await cleanupShadow(env, guestUid);
    return guestFailure('verifying the read-only guest identity', error);
  }

  try {
    await env.DB.prepare(`
      INSERT INTO guest_accounts(
        guest_id,username,username_key,display_name,guest_uid,password_salt,password_hash,
        password_iterations,created_at,expires_at,last_login_at,login_count,active
      ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,0,1)
    `).bind(
      guestId, username, usernameKey, displayName, guestUid, salt, passwordHash,
      PASSWORD_ITERATIONS, nowIso, expiresAt
    ).run();
  } catch (error) {
    await cleanupShadow(env, guestUid);
    return guestFailure('saving the guest credentials', error);
  }

  return json({
    ok: true,
    guest: {
      guestId,
      username,
      displayName,
      createdAt: nowIso,
      expiresAt,
      durationHours,
      active: true
    },
    password: generatedPassword ? password : null,
    passwordGenerated: generatedPassword
  }, 201);
}

async function cleanupShadow(env, guestUid) {
  try { await env.DB.prepare('DELETE FROM players WHERE uid=?').bind(guestUid).run(); } catch (_) {}
}

function guestFailure(stage, error) {
  const detail = safeError(error);
  console.error(`Guest creation failed while ${stage}:`, error);
  return json({
    ok: false,
    error: `Could not create guest while ${stage}.${detail ? ` ${detail}` : ''}`,
    stage
  }, 500);
}

function safeError(error) {
  const raw = String(error?.message || error || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.slice(0, 260);
}

async function hashPassword(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(salt),
    iterations
  }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function bytesToBase64(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
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
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
