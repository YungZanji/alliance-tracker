import portal from './scoring-entry-v150.js';

const TIME_ZONE = 'America/Vancouver';
const DAY_MS = 86_400_000;
const WEEKS_PER_CYCLE = 4;
const RESTORE_LIMIT = 80;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleProtectedSync(request, env, ctx);
    }

    if (url.pathname === '/api/admin/duel-restore-points' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return listRestorePoints(url, env);
    }

    if (url.pathname === '/api/admin/duel-restore-points' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return createManualRestorePoint(request, env);
    }

    const detailMatch = url.pathname.match(/^\/api\/admin\/duel-restore-points\/([^/]+)$/);
    if (detailMatch && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return restorePointDetail(decodeURIComponent(detailMatch[1]), env);
    }

    const restoreMatch = url.pathname.match(/^\/api\/admin\/duel-restore-points\/([^/]+)\/restore$/);
    if (restoreMatch && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return restoreDuelState(decodeURIComponent(restoreMatch[1]), env);
    }

    if (url.pathname === '/api/admin/activity' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return attachRestoreActivity(response, env);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handleProtectedSync(request, env, ctx) {
  let body;
  try {
    body = await request.clone().json();
  } catch (_) {
    return portal.fetch(request, env, ctx);
  }

  const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  const duelSnapshots = snapshots.filter(isDuelSnapshot);
  if (!duelSnapshots.length) return portal.fetch(request, env, ctx);

  const target = resolveIncomingDuelWeek(duelSnapshots, env);
  const sessionId = firstSessionId(duelSnapshots);
  if (target) {
    try {
      await saveRestorePoint(env, target.cycleId, target.cycleWeek, 'before_sync', sessionId);
    } catch (error) {
      console.warn('Could not save pre-sync Duel restore point:', error);
    }
  }

  const protectedBatch = protectSundayResetSnapshots(snapshots, String(env.PRIMARY_ALLIANCE_ABBR || 'WDZ').trim());
  if (protectedBatch.protected) body.snapshots = protectedBatch.snapshots;

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const response = await portal.fetch(forwarded, env, ctx);
  if (!response.ok) return response;

  let result = null;
  try {
    result = await response.clone().json();
  } catch (_) {}

  const finalTarget = {
    cycleId: String(result?.cycleId || target?.cycleId || ''),
    cycleWeek: Number(result?.cycleWeek || target?.cycleWeek || 0),
  };
  if (finalTarget.cycleId && finalTarget.cycleWeek >= 1 && finalTarget.cycleWeek <= 4) {
    try {
      await saveRestorePoint(env, finalTarget.cycleId, finalTarget.cycleWeek, 'after_sync', sessionId);
    } catch (error) {
      console.warn('Could not save post-sync Duel restore point:', error);
    }
  }

  if (!result) return response;
  return json({
    ...result,
    duelSundayProtection: {
      protected: protectedBatch.protected,
      ignoredSnapshots: protectedBatch.ignored,
      reason: protectedBatch.protected
        ? 'Game reset returned zeroed daily rankings while the current-week leaderboard still had scores.'
        : '',
    },
  }, response.status);
}

export function protectSundayResetSnapshots(snapshots, primaryAlliance = 'WDZ') {
  const source = Array.isArray(snapshots) ? snapshots : [];
  const weeklyHasScore = source.some(snapshot => {
    if (!isDuelRanking(snapshot, 'weekly_combined')) return false;
    return allianceScore(snapshot, primaryAlliance) > 0;
  });

  if (!weeklyHasScore) return { protected: false, ignored: 0, snapshots: source };

  let ignored = 0;
  const kept = source.filter(snapshot => {
    const label = String(snapshot?.context?.rankTypeLabel || '');
    if (String(snapshot?.dataset || '') !== 'alliance_duel_rankings') return true;
    if (label !== 'completed_days' && label !== 'current_day_combined') return true;
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    if (!rows.length) return true;

    const allianceRows = rows.filter(row => String(row?.allianceAbbr || '') === primaryAlliance);
    const allRowsZero = rows.every(row => Number(row?.score || 0) === 0);
    const primaryRowsZero = allianceRows.length > 0 && allianceRows.every(row => Number(row?.score || 0) === 0);
    if (!(allRowsZero && primaryRowsZero)) return true;

    ignored += 1;
    return false;
  });

  return { protected: ignored > 0, ignored, snapshots: kept };
}

function isDuelSnapshot(snapshot) {
  const dataset = String(snapshot?.dataset || '');
  return dataset === 'alliance_duel_rankings'
    || dataset === 'alliance_duel_results'
    || dataset === 'alliance_duel_season'
    || dataset === 'alliance_duel_league_totals';
}

function isDuelRanking(snapshot, label) {
  return String(snapshot?.dataset || '') === 'alliance_duel_rankings'
    && String(snapshot?.context?.rankTypeLabel || '') === label;
}

function allianceScore(snapshot, alliance) {
  return (Array.isArray(snapshot?.rows) ? snapshot.rows : [])
    .filter(row => String(row?.allianceAbbr || '') === alliance)
    .reduce((sum, row) => sum + Number(row?.score || 0), 0);
}

function firstSessionId(snapshots) {
  for (const snapshot of snapshots) {
    const value = String(snapshot?.session_id || snapshot?.sessionId || '').trim();
    if (value) return value;
  }
  return '';
}

export function resolveIncomingDuelWeek(snapshots, env = {}) {
  const source = Array.isArray(snapshots) ? snapshots : [];
  for (const snapshot of source) {
    const epoch = normalizeEpoch(snapshot?.context?.weekStartTime);
    if (epoch > 0) return weekContext(epoch, env);
  }
  const capturedAt = source
    .map(snapshot => snapshot?.captured_at || snapshot?.capturedAt)
    .find(Boolean);
  if (!capturedAt) return null;
  return weekContext(derivePacificWeekStart(capturedAt), env);
}

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  }), env, ctx);
  return response.ok ? null : response;
}

async function listRestorePoints(url, env) {
  const limit = Math.max(10, Math.min(RESTORE_LIMIT, Number(url.searchParams.get('limit') || 40)));
  const cycle = String(url.searchParams.get('cycle') || '').trim();
  const week = Number(url.searchParams.get('week') || 0);

  let query = `
    SELECT restore_id,cycle_id,cycle_week,created_at,reason,source_session_id,state_hash,summary_json
    FROM duel_restore_points
  `;
  const bindings = [];
  const where = [];
  if (cycle) {
    where.push('cycle_id=?');
    bindings.push(cycle);
  }
  if (week >= 1 && week <= 4) {
    where.push('cycle_week=?');
    bindings.push(week);
  }
  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY created_at DESC LIMIT ?';
  bindings.push(limit);

  const [points, weeks] = await Promise.all([
    bindAll(env.DB.prepare(query), bindings),
    env.DB.prepare(`
      SELECT cycle_id,cycle_week,MAX(captured_at) AS latest_capture
      FROM duel_weekly
      GROUP BY cycle_id,cycle_week
      ORDER BY cycle_id DESC,cycle_week DESC
    `).all(),
  ]);

  return json({
    ok: true,
    restorePoints: (points.results || []).map(restorePointJson),
    weeks: (weeks.results || []).map(row => ({
      cycleId: String(row.cycle_id || ''),
      cycleWeek: Number(row.cycle_week || 0),
      latestCapture: String(row.latest_capture || ''),
    })),
  });
}

async function createManualRestorePoint(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {}
  const cycleId = String(body?.cycleId || '').trim();
  const cycleWeek = Number(body?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    return json({ ok: false, error: 'Choose a Duel League and week first.' }, 400);
  }

  const point = await saveRestorePoint(env, cycleId, cycleWeek, 'manual', '');
  if (!point) return json({ ok: false, error: 'No Alliance Duel data exists for that week.' }, 404);
  return json({ ok: true, restorePoint: restorePointJson(point), created: Boolean(point.created) });
}

async function restorePointDetail(restoreId, env) {
  const row = await env.DB.prepare(`
    SELECT * FROM duel_restore_points WHERE restore_id=?
  `).bind(restoreId).first();
  if (!row) return json({ ok: false, error: 'Restore point was not found.' }, 404);

  return json({
    ok: true,
    restorePoint: {
      ...restorePointJson(row),
      daily: parseArray(row.daily_json),
      weekly: parseArray(row.weekly_json),
      league: parseArray(row.league_json),
      results: parseArray(row.results_json),
    },
  });
}

async function restoreDuelState(restoreId, env) {
  const row = await env.DB.prepare('SELECT * FROM duel_restore_points WHERE restore_id=?').bind(restoreId).first();
  if (!row) return json({ ok: false, error: 'Restore point was not found.' }, 404);

  const cycleId = String(row.cycle_id || '');
  const cycleWeek = Number(row.cycle_week || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    return json({ ok: false, error: 'Restore point has invalid Duel week metadata.' }, 409);
  }

  const safety = await saveRestorePoint(env, cycleId, cycleWeek, 'before_restore', '');
  const dailyJson = validJsonArray(row.daily_json);
  const weeklyJson = validJsonArray(row.weekly_json);
  const leagueJson = validJsonArray(row.league_json);
  const resultsJson = validJsonArray(row.results_json);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM duel_daily WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek),
    env.DB.prepare(`
      INSERT INTO duel_daily(
        cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,
        score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
      )
      SELECT
        json_extract(value,'$.cycle_id'),json_extract(value,'$.cycle_week'),json_extract(value,'$.week_id'),
        json_extract(value,'$.week_start_time'),json_extract(value,'$.day_index'),json_extract(value,'$.uid'),
        json_extract(value,'$.name_at_capture'),json_extract(value,'$.score'),json_extract(value,'$.score_source'),
        json_extract(value,'$.source_priority'),json_extract(value,'$.captured_at'),json_extract(value,'$.alliance_id'),
        json_extract(value,'$.alliance_abbr'),json_extract(value,'$.alliance_name'),json_extract(value,'$.server_id'),
        json_extract(value,'$.country'),json_extract(value,'$.source_hash')
      FROM json_each(?)
    `).bind(dailyJson),

    env.DB.prepare('DELETE FROM duel_weekly WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek),
    env.DB.prepare(`
      INSERT INTO duel_weekly(
        cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,score_source,
        source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
      )
      SELECT
        json_extract(value,'$.cycle_id'),json_extract(value,'$.cycle_week'),json_extract(value,'$.week_id'),
        json_extract(value,'$.week_start_time'),json_extract(value,'$.uid'),json_extract(value,'$.name_at_capture'),
        json_extract(value,'$.score'),json_extract(value,'$.position'),json_extract(value,'$.score_source'),
        json_extract(value,'$.source_priority'),json_extract(value,'$.captured_at'),json_extract(value,'$.alliance_id'),
        json_extract(value,'$.alliance_abbr'),json_extract(value,'$.alliance_name'),json_extract(value,'$.server_id'),
        json_extract(value,'$.country'),json_extract(value,'$.source_hash')
      FROM json_each(?)
    `).bind(weeklyJson),

    env.DB.prepare('DELETE FROM duel_league_total WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek),
    env.DB.prepare(`
      INSERT INTO duel_league_total(
        cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,score_source,
        captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
      )
      SELECT
        json_extract(value,'$.cycle_id'),json_extract(value,'$.cycle_week'),json_extract(value,'$.week_id'),
        json_extract(value,'$.week_start_time'),json_extract(value,'$.uid'),json_extract(value,'$.name_at_capture'),
        json_extract(value,'$.score'),json_extract(value,'$.position'),json_extract(value,'$.score_source'),
        json_extract(value,'$.captured_at'),json_extract(value,'$.alliance_id'),json_extract(value,'$.alliance_abbr'),
        json_extract(value,'$.alliance_name'),json_extract(value,'$.server_id'),json_extract(value,'$.country'),
        json_extract(value,'$.source_hash')
      FROM json_each(?)
    `).bind(leagueJson),

    env.DB.prepare('DELETE FROM duel_results WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek),
    env.DB.prepare(`
      INSERT INTO duel_results(
        cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,alliance_score,opponent_score,
        is_win,mvp_uid,mvp_name,mvp_score,captured_at,source_hash
      )
      SELECT
        json_extract(value,'$.cycle_id'),json_extract(value,'$.cycle_week'),json_extract(value,'$.week_id'),
        json_extract(value,'$.week_start_time'),json_extract(value,'$.day_index'),json_extract(value,'$.event_name'),
        json_extract(value,'$.alliance_score'),json_extract(value,'$.opponent_score'),json_extract(value,'$.is_win'),
        json_extract(value,'$.mvp_uid'),json_extract(value,'$.mvp_name'),json_extract(value,'$.mvp_score'),
        json_extract(value,'$.captured_at'),json_extract(value,'$.source_hash')
      FROM json_each(?)
    `).bind(resultsJson),
  ]);

  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO duel_restore_log(
      action_id,restore_id,cycle_id,cycle_week,restored_at,safety_restore_id,restored_state_hash
    ) VALUES(?,?,?,?,?,?,?)
  `).bind(
    crypto.randomUUID(),
    restoreId,
    cycleId,
    cycleWeek,
    now,
    String(safety?.restore_id || ''),
    String(row.state_hash || ''),
  ).run();

  const after = await saveRestorePoint(env, cycleId, cycleWeek, 'after_restore', restoreId);
  return json({
    ok: true,
    restoredFrom: restoreId,
    safetyRestorePoint: String(safety?.restore_id || ''),
    currentRestorePoint: String(after?.restore_id || restoreId),
    cycleId,
    cycleWeek,
    summary: after?.summary || parseObject(row.summary_json),
  });
}

async function saveRestorePoint(env, cycleId, cycleWeek, reason, sourceSessionId) {
  const state = await loadDuelState(env, cycleId, cycleWeek);
  if (!state.daily.length && !state.weekly.length && !state.league.length && !state.results.length) return null;

  const stateText = JSON.stringify({
    daily: state.daily,
    weekly: state.weekly,
    league: state.league,
    results: state.results,
  });
  const stateHash = await sha256(stateText);
  const latest = await env.DB.prepare(`
    SELECT restore_id,state_hash,summary_json,created_at,reason,source_session_id,cycle_id,cycle_week
    FROM duel_restore_points
    WHERE cycle_id=? AND cycle_week=?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(cycleId, cycleWeek).first();

  if (latest && String(latest.state_hash || '') === stateHash) {
    return {
      ...latest,
      summary: parseObject(latest.summary_json),
      created: false,
    };
  }

  const summary = summarizeDuelState(state);
  const restoreId = `duel-${cycleId}-w${cycleWeek}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO duel_restore_points(
      restore_id,cycle_id,cycle_week,created_at,reason,source_session_id,state_hash,
      daily_json,weekly_json,league_json,results_json,summary_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    restoreId,
    cycleId,
    cycleWeek,
    createdAt,
    reason,
    String(sourceSessionId || ''),
    stateHash,
    JSON.stringify(state.daily),
    JSON.stringify(state.weekly),
    JSON.stringify(state.league),
    JSON.stringify(state.results),
    JSON.stringify(summary),
  ).run();

  return {
    restore_id: restoreId,
    cycle_id: cycleId,
    cycle_week: cycleWeek,
    created_at: createdAt,
    reason,
    source_session_id: String(sourceSessionId || ''),
    state_hash: stateHash,
    summary_json: JSON.stringify(summary),
    summary,
    created: true,
  };
}

async function loadDuelState(env, cycleId, cycleWeek) {
  const [daily, weekly, league, results] = await Promise.all([
    env.DB.prepare(`
      SELECT * FROM duel_daily WHERE cycle_id=? AND cycle_week=? ORDER BY day_index,uid
    `).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT * FROM duel_weekly WHERE cycle_id=? AND cycle_week=? ORDER BY uid
    `).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT * FROM duel_league_total WHERE cycle_id=? AND cycle_week=? ORDER BY uid
    `).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT * FROM duel_results WHERE cycle_id=? AND cycle_week=? ORDER BY day_index
    `).bind(cycleId, cycleWeek).all(),
  ]);
  return {
    daily: daily.results || [],
    weekly: weekly.results || [],
    league: league.results || [],
    results: results.results || [],
  };
}

function summarizeDuelState(state) {
  const dayTotals = Array(6).fill(0);
  const dayPlayers = Array(6).fill(0);
  for (const row of state.daily) {
    const day = Number(row.day_index || 0);
    if (day < 1 || day > 6) continue;
    dayTotals[day - 1] += Number(row.score || 0);
    dayPlayers[day - 1] += 1;
  }
  return {
    dailyTotals: dayTotals,
    dailyPlayerRows: dayPlayers,
    weeklyTotal: state.weekly.reduce((sum, row) => sum + Number(row.score || 0), 0),
    weeklyPlayers: state.weekly.length,
    duelLeagueTotal: state.league.reduce((sum, row) => sum + Number(row.score || 0), 0),
    leaguePlayers: state.league.length,
    resultDays: state.results.length,
    latestCapture: latestCapture(state),
  };
}

function latestCapture(state) {
  let latest = '';
  for (const group of [state.daily, state.weekly, state.league, state.results]) {
    for (const row of group) {
      const value = String(row.captured_at || '');
      if (value > latest) latest = value;
    }
  }
  return latest;
}

function restorePointJson(row) {
  return {
    restoreId: String(row.restore_id || ''),
    cycleId: String(row.cycle_id || ''),
    cycleWeek: Number(row.cycle_week || 0),
    createdAt: String(row.created_at || ''),
    reason: String(row.reason || ''),
    sourceSessionId: String(row.source_session_id || ''),
    stateHash: String(row.state_hash || ''),
    summary: row.summary || parseObject(row.summary_json),
  };
}

async function attachRestoreActivity(response, env) {
  try {
    const body = await response.json();
    const restores = await env.DB.prepare(`
      SELECT l.action_id,l.restore_id,l.cycle_id,l.cycle_week,l.restored_at,p.created_at AS restore_point_created_at
      FROM duel_restore_log l
      LEFT JOIN duel_restore_points p ON p.restore_id=l.restore_id
      ORDER BY l.restored_at DESC
      LIMIT 30
    `).all();

    const extra = (restores.results || []).map(row => ({
      id: `duel-restore:${String(row.action_id || '')}`,
      type: 'duel_restore',
      label: 'Alliance Duel Restore',
      occurredAt: String(row.restored_at || ''),
      title: `${String(row.cycle_id || 'Duel League')} · Week ${Number(row.cycle_week || 0) || '—'}`,
      detail: 'Restored a saved Alliance Duel data state',
      meta: row.restore_point_created_at
        ? `Restore point from ${String(row.restore_point_created_at)}`
        : String(row.restore_id || ''),
    }));

    body.activity = [...(body.activity || []), ...extra]
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
      .slice(0, Math.max(200, Number(body.activity?.length || 0)));
    return json(body, response.status);
  } catch (_) {
    return response;
  }
}

async function bindAll(statement, bindings) {
  const bound = bindings.length ? statement.bind(...bindings) : statement;
  return bound.all();
}

function parseArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function validJsonArray(value) {
  return JSON.stringify(parseArray(value));
}

function weekContext(weekStartTime, env) {
  const weekId = dateIdInZone(new Date(weekStartTime));
  const cycle = cycleForWeekId(weekId, String(env.DUEL_CYCLE_ANCHOR || '2026-08-02'));
  return {
    weekStartTime,
    weekId,
    cycleId: cycle.cycleId,
    cycleWeek: cycle.cycleWeek,
  };
}

function derivePacificWeekStart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid capture time: ${value}`);
  const parts = zoneParts(date);
  const localDateId = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const localDay = new Date(`${localDateId}T00:00:00Z`).getUTCDay();
  let sunday = addDays(localDateId, -localDay);
  let candidate = zonedEpoch(sunday, 19, 0, 0);
  if (date.getTime() < candidate) {
    sunday = addDays(sunday, -7);
    candidate = zonedEpoch(sunday, 19, 0, 0);
  }
  return candidate;
}

function zonedEpoch(dateId, hour, minute, second) {
  const [year, month, day] = dateId.split('-').map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let index = 0; index < 2; index += 1) {
    const parts = zoneParts(new Date(guess));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += Date.UTC(year, month - 1, day, hour, minute, second) - represented;
  }
  return guess;
}

function zoneParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function dateIdInZone(date) {
  const parts = zoneParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function cycleForWeekId(weekId, anchor) {
  const diffWeeks = Math.round((dateEpoch(weekId) - dateEpoch(anchor)) / (7 * DAY_MS));
  const cycleIndex = Math.floor(diffWeeks / WEEKS_PER_CYCLE);
  return {
    cycleId: addDays(anchor, cycleIndex * 28),
    cycleWeek: positiveMod(diffWeeks, WEEKS_PER_CYCLE) + 1,
  };
}

function normalizeEpoch(value) {
  const number = Number(value || 0);
  if (!number) return 0;
  return number < 100_000_000_000 ? number * 1000 : number;
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function dateEpoch(dateId) {
  return new Date(`${dateId}T00:00:00Z`).getTime();
}

function addDays(dateId, days) {
  return new Date(dateEpoch(dateId) + days * DAY_MS).toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
