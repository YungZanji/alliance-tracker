import core from './index.js';

const WEEKS_PER_CYCLE = 4;
const DAY_COUNT = 6;
const SESSION_DAYS = 14;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_ATTEMPT_LIMIT = 12;
const DAY_META = [
  { dayIndex: 1, name: 'Tank Day', short: 'Tank' },
  { dayIndex: 2, name: 'Build Day', short: 'Build' },
  { dayIndex: 3, name: 'Science Day', short: 'Science' },
  { dayIndex: 4, name: 'Hero Day', short: 'Hero' },
  { dayIndex: 5, name: 'Training Day', short: 'Training' },
  { dayIndex: 6, name: 'Enemy Buster', short: 'Enemy Buster' }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (url.pathname === '/api/health') return core.fetch(request, env, ctx);

      if (url.pathname === '/api/sync' && request.method === 'POST') {
        const response = await core.fetch(request, env, ctx);
        if (response.ok) await bootstrapAdmin(env);
        return response;
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return handleLogout(request, env);
      }
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const session = await requireSession(request, env, false);
        return session.response || json({ ok: true, user: publicUser(session.user) });
      }

      if (url.pathname.startsWith('/api/')) {
        const session = await requireSession(request, env, true);
        if (session.response) return session.response;

        if (url.pathname === '/api/dashboard' && request.method === 'GET') {
          return handleDashboard(request, env, ctx);
        }
        if (url.pathname.startsWith('/api/player/') && request.method === 'GET') {
          return core.fetch(request, env, ctx);
        }
        if (url.pathname === '/api/duel' && request.method === 'GET') {
          return handleDuel(url, env);
        }
        if (url.pathname === '/api/participation' && request.method === 'GET') {
          return handleParticipation(env);
        }
        if (url.pathname === '/api/admin/summary' && request.method === 'GET') {
          return requireAdmin(session.user, () => handleAdminSummary(env));
        }
        if (url.pathname === '/api/admin/logins' && request.method === 'GET') {
          return requireAdmin(session.user, () => handleAdminLogins(url, env));
        }
        if (url.pathname === '/api/admin/weights' && request.method === 'POST') {
          return requireAdmin(session.user, () => handleWeightsUpdate(request, env));
        }
        return json({ ok: false, error: 'Not found.' }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
};

async function handleLogin(request, env) {
  await cleanupExpiredSessions(env);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'Enter your player UID.' }, 400);
  }
  const uid = String(body?.uid || '').trim();
  const now = new Date();
  const nowIso = now.toISOString();
  const ipHash = await privacyHash(clientIp(request), env);
  const enteredUidHash = await privacyHash(uid, env);
  const agent = String(request.headers.get('user-agent') || '').slice(0, 300);
  const country = String(request.cf?.country || '');
  const colo = String(request.cf?.colo || '');

  if (!/^\d{6,24}$/.test(uid)) {
    await recordLogin(env, { uid: null, enteredUidHash, playerName: '', success: 0, reason: 'invalid_format', ipHash, country, colo, agent, nowIso });
    return json({ ok: false, error: 'That does not look like a Last Z player UID.' }, 401);
  }

  const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const recentFails = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_audit WHERE ip_hash=? AND success=0 AND created_at>=?'
  ).bind(ipHash, cutoff).first();
  if (Number(recentFails?.n || 0) >= LOGIN_ATTEMPT_LIMIT) {
    await recordLogin(env, { uid: null, enteredUidHash, playerName: '', success: 0, reason: 'rate_limited', ipHash, country, colo, agent, nowIso });
    return json({ ok: false, error: 'Too many login attempts. Try again in a few minutes.' }, 429);
  }

  const player = await env.DB.prepare(
    'SELECT uid,public_id,current_name,alliance_abbr,alliance_name,server_id,country,is_admin,login_enabled FROM players WHERE uid=?'
  ).bind(uid).first();

  if (!player || Number(player.login_enabled || 0) !== 1) {
    await recordLogin(env, { uid: null, enteredUidHash, playerName: '', success: 0, reason: 'unknown_uid', ipHash, country, colo, agent, nowIso });
    return json({ ok: false, error: 'Player UID was not found in the Alliance Tracker roster.' }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO auth_sessions(token_hash,uid,created_at,expires_at,last_seen_at,ip_hash,user_agent) VALUES(?,?,?,?,?,?,?)'
    ).bind(tokenHash, uid, nowIso, expires, nowIso, ipHash, agent),
    env.DB.prepare(
      'UPDATE players SET last_login_at=?, login_count=login_count+1 WHERE uid=?'
    ).bind(nowIso, uid),
    env.DB.prepare(
      'INSERT INTO login_audit(uid,entered_uid_hash,player_name,success,reason,ip_hash,country,colo,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(uid, enteredUidHash, String(player.current_name || ''), 1, 'login', ipHash, country, colo, agent, nowIso)
  ]);

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', sessionCookie(token, SESSION_DAYS * 86_400));
  return new Response(JSON.stringify({ ok: true, user: publicUser(player) }), { status: 200, headers });
}

async function handleLogout(request, env) {
  const token = cookieValue(request, 'at_session');
  if (token) {
    const hash = await sha256(token);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(hash).run();
  }
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', 'at_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function requireSession(request, env, touch) {
  const token = cookieValue(request, 'at_session');
  if (!token) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const user = await env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,p.alliance_abbr,p.alliance_name,p.server_id,p.country,p.is_admin,
           s.created_at AS session_created,s.expires_at,s.last_seen_at
    FROM auth_sessions s JOIN players p ON p.uid=s.uid
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(tokenHash, now).first();
  if (!user) return { response: json({ ok: false, error: 'Session expired. Log in again.' }, 401) };
  if (touch) {
    const lastSeen = Date.parse(String(user.last_seen_at || '')) || 0;
    if (Date.now() - lastSeen > 10 * 60_000) {
      env.DB.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').bind(now, tokenHash).run().catch(() => {});
    }
  }
  return { user };
}

function publicUser(user) {
  return {
    publicId: String(user.public_id || ''),
    name: String(user.current_name || ''),
    allianceAbbr: String(user.alliance_abbr || ''),
    allianceName: String(user.alliance_name || ''),
    serverId: Number(user.server_id || 0),
    country: String(user.country || ''),
    isAdmin: Number(user.is_admin || 0) === 1
  };
}

async function bootstrapAdmin(env) {
  const existing = await env.DB.prepare('SELECT uid FROM players WHERE is_admin=1 LIMIT 1').first();
  if (existing) return;
  await env.DB.prepare(`
    UPDATE players SET is_admin=1
    WHERE uid=(
      SELECT uid FROM players
      WHERE current_name='Mr Zanji' AND alliance_abbr='WDZ' AND server_id=305
      ORDER BY last_seen_at DESC LIMIT 1
    )
  `).run();
}

async function handleDashboard(request, env, ctx) {
  const response = await core.fetch(request, env, ctx);
  if (!response.ok) return response;
  const payload = await response.json();
  const selected = String(payload.selectedCycleId || '');
  if (!selected) return json(payload, response.status, response.headers);

  const aggregateResult = await env.DB.prepare(`
    SELECT p.public_id,p.current_name,p.alliance_abbr,p.alliance_name,p.server_id,p.country,
      COALESCE(SUM(w.score),0) AS all_time_total,
      COALESCE(SUM(CASE WHEN w.cycle_id=? THEN w.score ELSE 0 END),0) AS cycle_total,
      COUNT(DISTINCT w.cycle_id) AS cycles_participated,
      MAX(w.captured_at) AS latest_capture
    FROM players p JOIN duel_weekly w ON w.uid=p.uid
    GROUP BY p.uid
    ORDER BY all_time_total DESC,p.current_name ASC
  `).bind(selected).all();
  const selectedWeeksResult = await env.DB.prepare(`
    SELECT p.public_id,w.cycle_week,w.score FROM duel_weekly w JOIN players p ON p.uid=w.uid WHERE w.cycle_id=?
  `).bind(selected).all();
  const aliasesResult = await env.DB.prepare(`
    SELECT p.public_id,a.name FROM player_aliases a JOIN players p ON p.uid=a.uid
  `).all();

  const weeksByPlayer = new Map();
  for (const row of selectedWeeksResult.results || []) {
    if (!weeksByPlayer.has(row.public_id)) weeksByPlayer.set(row.public_id, Array(WEEKS_PER_CYCLE).fill(0));
    const week = Number(row.cycle_week || 0);
    if (week >= 1 && week <= WEEKS_PER_CYCLE) weeksByPlayer.get(row.public_id)[week - 1] = Number(row.score || 0);
  }
  const aliasesByPlayer = new Map();
  for (const row of aliasesResult.results || []) {
    if (!aliasesByPlayer.has(row.public_id)) aliasesByPlayer.set(row.public_id, []);
    const aliases = aliasesByPlayer.get(row.public_id);
    if (row.name && !aliases.includes(row.name)) aliases.push(row.name);
  }

  const players = (aggregateResult.results || []).map(row => ({
    publicId: row.public_id,
    name: row.current_name,
    aliases: aliasesByPlayer.get(row.public_id) || [],
    allianceAbbr: row.alliance_abbr,
    allianceName: row.alliance_name,
    serverId: row.server_id,
    country: row.country,
    weekScores: weeksByPlayer.get(row.public_id) || Array(WEEKS_PER_CYCLE).fill(0),
    cycleTotal: Number(row.cycle_total || 0),
    previousDuelTotal: Number(row.all_time_total || 0) - Number(row.cycle_total || 0),
    allTimeTotal: Number(row.all_time_total || 0),
    cyclesParticipated: Number(row.cycles_participated || 0),
    latestCapture: row.latest_capture || ''
  }));
  players.sort((a, b) => b.allTimeTotal - a.allTimeTotal || a.name.localeCompare(b.name));
  const allTimeScore = players.reduce((sum, row) => sum + row.allTimeTotal, 0);
  const cycleScore = players.reduce((sum, row) => sum + row.cycleTotal, 0);
  players.forEach((row, index) => {
    row.rank = index + 1;
    row.contributionPercent = allTimeScore ? Number((row.allTimeTotal * 100 / allTimeScore).toFixed(2)) : 0;
  });
  payload.players = players;
  payload.summary = { ...(payload.summary || {}), participants: players.length, allTimeScore, cycleScore };
  payload.dataQuality = { status: players.length ? 'complete' : 'empty', missing: players.length ? [] : ['No player weekly scores were captured.'] };
  return json(payload, response.status, response.headers);
}

async function handleDuel(url, env) {
  let cycleId = String(url.searchParams.get('cycle') || '');
  if (!cycleId) {
    const latest = await env.DB.prepare('SELECT cycle_id FROM duel_weekly ORDER BY cycle_id DESC LIMIT 1').first();
    cycleId = String(latest?.cycle_id || '');
  }
  if (!cycleId) return json({ ok: true, cycleId: '', cycleWeek: 1, days: DAY_META, players: [], summary: {} });

  let cycleWeek = Number(url.searchParams.get('week') || 0);
  if (!(cycleWeek >= 1 && cycleWeek <= WEEKS_PER_CYCLE)) {
    const current = await env.DB.prepare('SELECT MAX(cycle_week) AS w FROM duel_weekly WHERE cycle_id=?').bind(cycleId).first();
    cycleWeek = Math.max(1, Math.min(WEEKS_PER_CYCLE, Number(current?.w || 1)));
  }

  const weeklyResult = await env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,p.alliance_abbr,p.server_id,w.score AS weekly_score,w.position,w.captured_at
    FROM duel_weekly w JOIN players p ON p.uid=w.uid
    WHERE w.cycle_id=? AND w.cycle_week=?
  `).bind(cycleId, cycleWeek).all();
  const dailyResult = await env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,d.day_index,d.score,d.captured_at
    FROM duel_daily d JOIN players p ON p.uid=d.uid
    WHERE d.cycle_id=? AND d.cycle_week=?
  `).bind(cycleId, cycleWeek).all();
  const officialResult = await env.DB.prepare(`
    SELECT day_index,event_name,alliance_score,opponent_score,is_win,mvp_name,mvp_score,captured_at
    FROM duel_results WHERE cycle_id=? AND cycle_week=? ORDER BY day_index
  `).bind(cycleId, cycleWeek).all();

  const map = new Map();
  for (const row of weeklyResult.results || []) {
    map.set(String(row.uid), {
      publicId: row.public_id,
      name: row.current_name,
      allianceAbbr: row.alliance_abbr,
      serverId: Number(row.server_id || 0),
      weeklyScore: Number(row.weekly_score || 0),
      weeklyPosition: Number(row.position || 0),
      dayScores: Array(DAY_COUNT).fill(0),
      latestCapture: row.captured_at || ''
    });
  }
  for (const row of dailyResult.results || []) {
    const uid = String(row.uid);
    if (!map.has(uid)) {
      map.set(uid, { publicId: row.public_id, name: row.current_name, allianceAbbr: '', serverId: 0, weeklyScore: 0, weeklyPosition: 0, dayScores: Array(DAY_COUNT).fill(0), latestCapture: '' });
    }
    const target = map.get(uid);
    const day = Number(row.day_index || 0);
    if (day >= 1 && day <= DAY_COUNT) target.dayScores[day - 1] = Number(row.score || 0);
    if (String(row.captured_at || '') > target.latestCapture) target.latestCapture = row.captured_at;
  }
  const players = [...map.values()].map(row => ({ ...row, dailySum: row.dayScores.reduce((a, b) => a + b, 0), adjustment: row.weeklyScore - row.dayScores.reduce((a, b) => a + b, 0) }));
  players.sort((a, b) => b.weeklyScore - a.weeklyScore || a.name.localeCompare(b.name));
  players.forEach((row, index) => row.rank = index + 1);
  const calculatedDayTotals = DAY_META.map(day => players.reduce((sum, row) => sum + Number(row.dayScores[day.dayIndex - 1] || 0), 0));
  const officials = new Map((officialResult.results || []).map(row => [Number(row.day_index), row]));
  const days = DAY_META.map((day, index) => {
    const official = officials.get(day.dayIndex);
    return {
      ...day,
      calculatedTotal: calculatedDayTotals[index],
      officialAllianceScore: official?.alliance_score == null ? null : Number(official.alliance_score),
      opponentScore: official?.opponent_score == null ? null : Number(official.opponent_score),
      isWin: official?.is_win == null ? null : Number(official.is_win),
      mvpName: String(official?.mvp_name || ''),
      mvpScore: official?.mvp_score == null ? null : Number(official.mvp_score),
      captured: players.some(row => Number(row.dayScores[index] || 0) > 0) || Boolean(official)
    };
  });
  const weeklyTotal = players.reduce((sum, row) => sum + row.weeklyScore, 0);
  return json({
    ok: true,
    cycleId,
    cycleWeek,
    weekLabel: `Week ${cycleWeek}`,
    days,
    players,
    summary: {
      players: players.length,
      weeklyTotal,
      dailyTotal: calculatedDayTotals.reduce((a, b) => a + b, 0),
      latestCapture: players.map(row => row.latestCapture).sort().at(-1) || ''
    }
  });
}

async function handleParticipation(env) {
  const weightsResult = await env.DB.prepare('SELECT event_type,label,weight,enabled FROM participation_weights ORDER BY event_type').all();
  const weights = (weightsResult.results || []).map(row => ({ eventType: row.event_type, label: row.label, weight: Number(row.weight || 0), enabled: Number(row.enabled || 0) === 1 }));
  const playersResult = await env.DB.prepare(`
    SELECT uid,public_id,current_name,alliance_abbr,server_id FROM players
    WHERE EXISTS(SELECT 1 FROM duel_weekly w WHERE w.uid=players.uid)
       OR EXISTS(SELECT 1 FROM event_scores e WHERE e.uid=players.uid)
  `).all();
  const duelResult = await env.DB.prepare('SELECT uid,SUM(score) AS total FROM duel_weekly GROUP BY uid').all();
  const eventResult = await env.DB.prepare('SELECT event_type,uid,SUM(score) AS total FROM event_scores GROUP BY event_type,uid').all();
  const duel = new Map((duelResult.results || []).map(row => [String(row.uid), Number(row.total || 0)]));
  const byType = new Map();
  for (const row of eventResult.results || []) {
    const type = String(row.event_type || '');
    if (!byType.has(type)) byType.set(type, new Map());
    byType.get(type).set(String(row.uid), Number(row.total || 0));
  }
  byType.set('alliance_duel', duel);

  const available = {};
  const tops = {};
  for (const weight of weights) {
    const values = byType.get(weight.eventType) || new Map();
    available[weight.eventType] = values.size > 0;
    tops[weight.eventType] = values.size ? Math.max(...values.values(), 0) : 0;
  }

  const players = (playersResult.results || []).map(row => {
    const components = {};
    let weighted = 0;
    let weightTotal = 0;
    for (const weight of weights) {
      const raw = Number((byType.get(weight.eventType) || new Map()).get(String(row.uid)) || 0);
      const top = Number(tops[weight.eventType] || 0);
      const index = top > 0 ? Math.min(100, raw * 100 / top) : 0;
      components[weight.eventType] = { raw, index: Number(index.toFixed(2)), available: Boolean(available[weight.eventType]), weight: weight.weight };
      if (weight.enabled && available[weight.eventType] && weight.weight > 0) {
        weighted += index * weight.weight;
        weightTotal += weight.weight;
      }
    }
    return {
      publicId: row.public_id,
      name: row.current_name,
      allianceAbbr: row.alliance_abbr,
      serverId: Number(row.server_id || 0),
      score: weightTotal ? Number((weighted / weightTotal).toFixed(2)) : 0,
      components
    };
  });
  players.sort((a, b) => b.score - a.score || Number(b.components.alliance_duel?.raw || 0) - Number(a.components.alliance_duel?.raw || 0) || a.name.localeCompare(b.name));
  players.forEach((row, index) => row.rank = index + 1);
  return json({ ok: true, players, weights, availability: available, method: 'Each available event is normalized against that event’s top score (0–100), then combined using the configured weights. Events with no captured data are excluded until they become available.' });
}

async function handleAdminSummary(env) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [players, sessions, logins, captures, admins, weights] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM players').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at>?').bind(now.toISOString()).first(),
    env.DB.prepare('SELECT SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS success,SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) AS failed FROM login_audit WHERE created_at>=?').bind(weekAgo).first(),
    env.DB.prepare('SELECT COUNT(*) AS n,MAX(received_at) AS latest FROM captures').first(),
    env.DB.prepare('SELECT public_id,current_name,last_login_at,login_count FROM players WHERE is_admin=1').all(),
    env.DB.prepare('SELECT event_type,label,weight,enabled FROM participation_weights ORDER BY event_type').all()
  ]);
  return json({
    ok: true,
    summary: {
      players: Number(players?.n || 0),
      activeSessions: Number(sessions?.n || 0),
      successfulLogins7d: Number(logins?.success || 0),
      failedLogins7d: Number(logins?.failed || 0),
      captures: Number(captures?.n || 0),
      latestCapture: captures?.latest || ''
    },
    admins: (admins.results || []).map(row => ({ publicId: row.public_id, name: row.current_name, lastLoginAt: row.last_login_at || '', loginCount: Number(row.login_count || 0) })),
    weights: (weights.results || []).map(row => ({ eventType: row.event_type, label: row.label, weight: Number(row.weight || 0), enabled: Number(row.enabled || 0) === 1 }))
  });
}

async function handleAdminLogins(url, env) {
  const limit = Math.max(10, Math.min(250, Number(url.searchParams.get('limit') || 100)));
  const rows = await env.DB.prepare(`
    SELECT id,player_name,success,reason,ip_hash,country,colo,user_agent,created_at
    FROM login_audit ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all();
  return json({
    ok: true,
    logins: (rows.results || []).map(row => ({
      id: row.id,
      playerName: row.player_name || 'Unknown UID',
      success: Number(row.success || 0) === 1,
      reason: row.reason,
      ipFingerprint: String(row.ip_hash || '').slice(0, 12),
      country: row.country || '',
      colo: row.colo || '',
      userAgent: row.user_agent || '',
      createdAt: row.created_at
    }))
  });
}

async function handleWeightsUpdate(request, env) {
  const body = await request.json();
  const submitted = body?.weights && typeof body.weights === 'object' ? body.weights : {};
  const allowed = ['alliance_duel', 'state_ruler', 'glory_war'];
  const statements = [];
  for (const type of allowed) {
    if (!(type in submitted)) continue;
    const value = Number(submitted[type]);
    if (!Number.isFinite(value) || value < 0 || value > 10) return json({ ok: false, error: 'Weights must be between 0 and 10.' }, 400);
    statements.push(env.DB.prepare('UPDATE participation_weights SET weight=? WHERE event_type=?').bind(value, type));
  }
  if (statements.length) await env.DB.batch(statements);
  return handleAdminSummary(env);
}

function requireAdmin(user, callback) {
  if (Number(user?.is_admin || 0) !== 1) return json({ ok: false, error: 'Administrator access required.' }, 403);
  return callback();
}

async function recordLogin(env, event) {
  await env.DB.prepare(
    'INSERT INTO login_audit(uid,entered_uid_hash,player_name,success,reason,ip_hash,country,colo,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).bind(event.uid, event.enteredUidHash, event.playerName, event.success, event.reason, event.ipHash, event.country, event.colo, event.agent, event.nowIso).run();
}

async function cleanupExpiredSessions(env) {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(new Date().toISOString()).run();
}

function clientIp(request) {
  return String(request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

async function privacyHash(value, env) {
  return sha256(`${String(env.UPLOAD_TOKEN || 'alliance-tracker')}|${String(value || '')}`);
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function sessionCookie(token, maxAge) {
  return `at_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function json(value, status = 200, sourceHeaders = undefined) {
  const headers = new Headers(sourceHeaders || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers });
}
