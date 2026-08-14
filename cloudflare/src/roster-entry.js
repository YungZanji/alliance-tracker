import portal from './entry.js';

const SESSION_COOKIE = 'at_session';
const PRIMARY_ALLIANCE = 'WDZ';
const WEEKS_PER_CYCLE = 4;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const mirror = request.clone();
      const response = await portal.fetch(request, env, ctx);
      if (response.ok) {
        try {
          const [body, syncResult] = await Promise.all([
            mirror.json(),
            response.clone().json().catch(() => ({})),
          ]);
          await Promise.all([
            refreshRosterAccess(body, env),
            refreshDuelWeekContext(body, syncResult, env),
          ]);
        } catch (error) {
          console.error('Post-sync Alliance Tracker metadata refresh failed', error);
        }
      }
      return response;
    }

    const isPublicApi = url.pathname === '/api/health' || url.pathname === '/api/auth/login' || url.pathname === '/api/auth/logout';
    if (url.pathname.startsWith('/api/') && !isPublicApi) {
      const gate = await requireCurrentRoster(request, env);
      if (gate) return gate;
    }

    if (url.pathname === '/api/duel-context' && request.method === 'GET') {
      return handleDuelContext(url, env);
    }
    if (url.pathname === '/api/admin/duel-context' && request.method === 'GET') {
      const admin = await requireAdminUser(request, env);
      return admin.response || handleAdminDuelContext(url, env);
    }
    if (url.pathname === '/api/admin/duel-context' && request.method === 'POST') {
      const admin = await requireAdminUser(request, env);
      return admin.response || handleAdminDuelContextUpdate(request, env, admin.user);
    }
    if (url.pathname === '/api/admin/player-leave' && request.method === 'POST') {
      const admin = await requireAdminUser(request, env);
      return admin.response || handlePlayerLeaveUpdate(request, env, admin.user);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function refreshRosterAccess(body, env) {
  const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  const authoritative = snapshots
    .filter(snapshot => snapshot?.dataset === 'alliance_duel_rankings' && snapshot?.context?.rankTypeLabel === 'weekly_own_alliance')
    .sort((a, b) => String(b.captured_at || b.capturedAt || '').localeCompare(String(a.captured_at || a.capturedAt || '')))[0];

  if (!authoritative) return;

  const alliance = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const uids = [...new Set((authoritative.rows || [])
    .filter(row => String(row?.allianceAbbr || '') === alliance)
    .map(row => String(row?.uid || '').trim())
    .filter(Boolean))];

  if (!uids.length) return;

  const placeholders = uids.map(() => '?').join(',');
  await env.DB.batch([
    env.DB.prepare('UPDATE players SET login_enabled=0 WHERE alliance_abbr=?').bind(alliance),
    env.DB.prepare(`UPDATE players SET login_enabled=1 WHERE uid IN (${placeholders})`).bind(...uids)
  ]);

  await env.DB.prepare(`
    DELETE FROM auth_sessions
    WHERE uid IN (
      SELECT uid FROM players WHERE alliance_abbr=? AND login_enabled=0
    )
  `).bind(alliance).run();
}

async function refreshDuelWeekContext(body, syncResult, env) {
  const cycleId = String(syncResult?.cycleId || '').trim();
  const cycleWeek = Number(syncResult?.cycleWeek || 0);
  if (!cycleId || !(cycleWeek >= 1 && cycleWeek <= WEEKS_PER_CYCLE)) return;

  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  const weekly = snapshots
    .filter(snapshot => snapshot?.dataset === 'alliance_duel_rankings' && snapshot?.context?.rankTypeLabel === 'weekly_combined')
    .sort((a, b) => String(b.captured_at || b.capturedAt || '').localeCompare(String(a.captured_at || a.capturedAt || '')))[0];
  if (!weekly || !Array.isArray(weekly.rows)) return;

  const candidates = new Map();
  for (const row of weekly.rows) {
    const abbr = String(row?.allianceAbbr || '').trim();
    if (!abbr || abbr.toLowerCase() === primary.toLowerCase()) continue;
    const current = candidates.get(abbr) || {
      abbr,
      name: String(row?.allianceName || '').trim(),
      serverId: Number(row?.serverId || 0) || null,
      rows: 0,
      score: 0,
    };
    current.rows += 1;
    current.score += Number(row?.score || 0);
    if (!current.name && row?.allianceName) current.name = String(row.allianceName);
    candidates.set(abbr, current);
  }
  const opponent = [...candidates.values()].sort((a, b) => b.rows - a.rows || b.score - a.score)[0];
  if (!opponent) return;

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO duel_week_context(cycle_id,cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at,updated_by_uid)
    VALUES(?,?,?,?,?,'capture',?,NULL)
    ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
      opponent_abbr=excluded.opponent_abbr,
      opponent_name=excluded.opponent_name,
      opponent_server_id=excluded.opponent_server_id,
      source='capture',
      updated_at=excluded.updated_at,
      updated_by_uid=NULL
    WHERE duel_week_context.source!='admin'
  `).bind(cycleId, cycleWeek, opponent.abbr, opponent.name, opponent.serverId, now).run();
}

async function handleDuelContext(url, env) {
  const resolved = await resolveCycleWeek(url, env);
  if (!resolved.cycleId) {
    return json({ ok: true, cycleId: '', cycleWeek: 1, currentOpponent: null, weeks: [], leave: [] });
  }
  const contexts = await env.DB.prepare(`
    SELECT cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at
    FROM duel_week_context WHERE cycle_id=? ORDER BY cycle_week
  `).bind(resolved.cycleId).all();
  const leaves = await env.DB.prepare(`
    SELECT p.public_id,p.current_name,l.cycle_week,l.status,l.note,l.updated_at
    FROM player_week_leave l JOIN players p ON p.uid=l.uid
    WHERE l.cycle_id=? AND l.cycle_week=?
    ORDER BY p.current_name
  `).bind(resolved.cycleId, resolved.cycleWeek).all();
  const weeks = Array.from({ length: WEEKS_PER_CYCLE }, (_, index) => {
    const cycleWeek = index + 1;
    const row = (contexts.results || []).find(item => Number(item.cycle_week) === cycleWeek);
    return weekContext(cycleWeek, row);
  });
  return json({
    ok: true,
    cycleId: resolved.cycleId,
    cycleWeek: resolved.cycleWeek,
    currentOpponent: weeks[resolved.cycleWeek - 1]?.opponent || null,
    weeks,
    leave: (leaves.results || []).map(row => ({
      publicId: String(row.public_id || ''),
      name: String(row.current_name || ''),
      cycleWeek: Number(row.cycle_week || 0),
      status: String(row.status || 'away'),
      label: 'On Leave',
      note: String(row.note || ''),
      updatedAt: String(row.updated_at || ''),
    })),
  });
}

async function handleAdminDuelContext(url, env) {
  const resolved = await resolveCycleWeek(url, env);
  const cyclesResult = await env.DB.prepare(`
    SELECT cycle_id,MAX(cycle_week) AS latest_week,MAX(captured_at) AS latest_capture
    FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC
  `).all();
  const playersResult = await env.DB.prepare(`
    SELECT public_id,current_name,alliance_abbr,server_id
    FROM players
    WHERE alliance_abbr=?
    ORDER BY current_name COLLATE NOCASE
  `).bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all();
  const contextsResult = resolved.cycleId
    ? await env.DB.prepare(`
        SELECT cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at
        FROM duel_week_context WHERE cycle_id=? ORDER BY cycle_week
      `).bind(resolved.cycleId).all()
    : { results: [] };
  const leavesResult = resolved.cycleId
    ? await env.DB.prepare(`
        SELECT p.public_id,p.current_name,l.cycle_week,l.status,l.note,l.updated_at
        FROM player_week_leave l JOIN players p ON p.uid=l.uid
        WHERE l.cycle_id=? ORDER BY p.current_name,l.cycle_week
      `).bind(resolved.cycleId).all()
    : { results: [] };

  return json({
    ok: true,
    cycleId: resolved.cycleId,
    cycleWeek: resolved.cycleWeek,
    cycles: (cyclesResult.results || []).map(row => ({
      id: String(row.cycle_id || ''),
      latestWeek: Number(row.latest_week || 1),
      latestCapture: String(row.latest_capture || ''),
    })),
    weeks: Array.from({ length: WEEKS_PER_CYCLE }, (_, index) => {
      const cycleWeek = index + 1;
      const row = (contextsResult.results || []).find(item => Number(item.cycle_week) === cycleWeek);
      return weekContext(cycleWeek, row);
    }),
    players: (playersResult.results || []).map(row => ({
      publicId: String(row.public_id || ''),
      name: String(row.current_name || ''),
      allianceAbbr: String(row.alliance_abbr || ''),
      serverId: Number(row.server_id || 0),
    })),
    leave: (leavesResult.results || []).map(row => ({
      publicId: String(row.public_id || ''),
      name: String(row.current_name || ''),
      cycleWeek: Number(row.cycle_week || 0),
      status: String(row.status || 'away'),
      note: String(row.note || ''),
      updatedAt: String(row.updated_at || ''),
    })),
  });
}

async function handleAdminDuelContextUpdate(request, env, user) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const opponentAbbr = String(body?.opponentAbbr || '').trim().slice(0, 24);
  const opponentName = String(body?.opponentName || '').trim().slice(0, 120);
  const serverId = body?.opponentServerId === '' || body?.opponentServerId == null ? null : Number(body.opponentServerId);
  if (!cycleId || !(cycleWeek >= 1 && cycleWeek <= WEEKS_PER_CYCLE)) {
    return json({ ok: false, error: 'Choose a valid Duel cycle and week.' }, 400);
  }
  const now = new Date().toISOString();
  if (!opponentAbbr && !opponentName) {
    await env.DB.prepare('DELETE FROM duel_week_context WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek).run();
    return json({ ok: true, cleared: true });
  }
  await env.DB.prepare(`
    INSERT INTO duel_week_context(cycle_id,cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at,updated_by_uid)
    VALUES(?,?,?,?,?,'admin',?,?)
    ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
      opponent_abbr=excluded.opponent_abbr,
      opponent_name=excluded.opponent_name,
      opponent_server_id=excluded.opponent_server_id,
      source='admin',
      updated_at=excluded.updated_at,
      updated_by_uid=excluded.updated_by_uid
  `).bind(cycleId, cycleWeek, opponentAbbr, opponentName, Number.isFinite(serverId) ? serverId : null, now, user.uid).run();
  return json({ ok: true });
}

async function handlePlayerLeaveUpdate(request, env, user) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const publicId = String(body?.publicId || '').trim();
  const weeks = [...new Set((Array.isArray(body?.cycleWeeks) ? body.cycleWeeks : [])
    .map(Number)
    .filter(value => value >= 1 && value <= WEEKS_PER_CYCLE))].sort();
  const note = String(body?.note || '').trim().slice(0, 240);
  if (!cycleId || !publicId) return json({ ok: false, error: 'Choose a player and Duel cycle.' }, 400);
  const player = await env.DB.prepare('SELECT uid,current_name FROM players WHERE public_id=?').bind(publicId).first();
  if (!player) return json({ ok: false, error: 'Player was not found.' }, 404);

  const now = new Date().toISOString();
  const statements = [env.DB.prepare('DELETE FROM player_week_leave WHERE cycle_id=? AND uid=?').bind(cycleId, player.uid)];
  for (const week of weeks) {
    statements.push(env.DB.prepare(`
      INSERT INTO player_week_leave(cycle_id,cycle_week,uid,status,note,created_at,updated_at,updated_by_uid)
      VALUES(?,?,?,'away',?,?,?,?)
    `).bind(cycleId, week, player.uid, note, now, now, user.uid));
  }
  await env.DB.batch(statements);
  return json({ ok: true, publicId, cycleId, cycleWeeks: weeks, label: 'On Leave' });
}

async function resolveCycleWeek(url, env) {
  let cycleId = String(url.searchParams.get('cycle') || '').trim();
  if (!cycleId) {
    const latest = await env.DB.prepare(`
      SELECT cycle_id,MAX(captured_at) AS latest_capture
      FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC LIMIT 1
    `).first();
    cycleId = String(latest?.cycle_id || '');
  }
  let cycleWeek = Number(url.searchParams.get('week') || 0);
  if (cycleId && !(cycleWeek >= 1 && cycleWeek <= WEEKS_PER_CYCLE)) {
    const current = await env.DB.prepare('SELECT MAX(cycle_week) AS w FROM duel_weekly WHERE cycle_id=?').bind(cycleId).first();
    cycleWeek = Math.max(1, Math.min(WEEKS_PER_CYCLE, Number(current?.w || 1)));
  }
  return { cycleId, cycleWeek: cycleWeek || 1 };
}

function weekContext(cycleWeek, row) {
  if (!row) return { cycleWeek, label: `Week ${cycleWeek}`, opponent: null };
  const abbr = String(row.opponent_abbr || '');
  const name = String(row.opponent_name || '');
  return {
    cycleWeek,
    label: abbr ? `Week ${cycleWeek} · WDZ vs ${abbr}` : `Week ${cycleWeek}`,
    opponent: {
      abbr,
      name,
      serverId: row.opponent_server_id == null ? null : Number(row.opponent_server_id),
      source: String(row.source || ''),
      updatedAt: String(row.updated_at || ''),
    },
  };
}

async function getSessionUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  return env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,p.is_admin,p.login_enabled,s.expires_at
    FROM auth_sessions s JOIN players p ON p.uid=s.uid
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(tokenHash, now).first();
}

async function requireCurrentRoster(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const user = await getSessionUser(request, env);
  if (!user || Number(user.login_enabled || 0) !== 1) {
    const tokenHash = await sha256(token);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ ok: false, error: 'WDZ roster access is no longer active for this player.' }, 401, true);
  }
  return null;
}

async function requireAdminUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user || Number(user.login_enabled || 0) !== 1) {
    return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  }
  if (Number(user.is_admin || 0) !== 1) {
    return { response: json({ ok: false, error: 'Administrator access is required.' }, 403) };
  }
  return { user };
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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(value, status = 200, clearCookie = false) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  if (clearCookie) headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify(value), { status, headers });
}
