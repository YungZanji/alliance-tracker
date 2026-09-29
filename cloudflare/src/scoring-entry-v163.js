import portal from './scoring-entry-v162.js';

const DAY_COUNT = 6;
const DAY_MS = 86_400_000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const copy = request.clone();
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;

      let base = {};
      try { base = await response.clone().json(); } catch (_) { return response; }
      if (base?.ok === false) return response;

      try {
        const body = await copy.json();
        const rankSync = await persistExactRanks(body, base, env);
        return jsonLike(response, { ...base, rankSync });
      } catch (error) {
        console.error('Exact Duel rank sync failed', error);
        return json({
          ok: false,
          error: `Core Duel data was accepted, but exact rank persistence failed: ${String(error?.message || error)}. Retry is safe.`,
          code: 'DUEL_RANK_SYNC_FAILED'
        }, 500);
      }
    }

    if (url.pathname === '/api/duel' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const payload = await response.clone().json();
        if (!payload?.ok || !payload.cycleId || !payload.cycleWeek) return response;
        const enriched = await enrichExactRanks(payload, env);
        return jsonLike(response, enriched);
      } catch (error) {
        console.warn('Could not enrich Duel response with lossless rank positions', error);
        return response;
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function persistExactRanks(body, base, env) {
  const snapshots = (Array.isArray(body?.snapshots) ? body.snapshots : [])
    .filter(snapshot => String(snapshot?.dataset || '') === 'alliance_duel_rankings');
  if (!snapshots.length) return { ok: true, rows: 0 };

  const week = await resolveWeek(snapshots, base, env);
  if (!week) throw new Error('Could not resolve synchronized Duel week for rank persistence.');
  const primaryAlliance = String(base?.primaryAlliance || env.PRIMARY_ALLIANCE_ABBR || 'WDZ').trim();
  const statements = [];
  let rowsSaved = 0;

  for (const snapshot of snapshots) {
    const label = String(snapshot?.context?.rankTypeLabel || '');
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const capturedAt = captureTime(snapshot) || new Date().toISOString();
    const sourceHashValue = sourceHash(snapshot);
    const inferredDay = inferDayIndex(capturedAt, week.weekStartTime);
    const allianceOrdinal = new Map();

    for (const row of rows) {
      const abbr = String(row?.allianceAbbr || '');
      const rowDay = label === 'completed_days' ? Number(row?.dayIndex || 0) : 0;
      const ordinalKey = `${rowDay}|${abbr}`;
      const ordinal = (allianceOrdinal.get(ordinalKey) || 0) + 1;
      allianceOrdinal.set(ordinalKey, ordinal);
      if (abbr !== primaryAlliance) continue;

      const uid = String(row?.uid || '');
      if (!uid) continue;

      let metricScope = '';
      let dayIndex = 0;
      let overallPosition = null;
      let alliancePosition = positiveNumber(row?.alliancePosition) || ordinal || null;
      const genericPosition = positiveNumber(row?.position);
      const explicitOverall = positiveNumber(row?.overallPosition);

      if (label === 'weekly_combined') {
        metricScope = 'weekly';
        overallPosition = explicitOverall || genericPosition;
      } else if (label === 'weekly_own_alliance') {
        metricScope = 'weekly';
        alliancePosition = positiveNumber(row?.alliancePosition) || genericPosition || ordinal || null;
      } else if (label === 'current_day_combined') {
        metricScope = 'daily';
        dayIndex = inferredDay;
        overallPosition = explicitOverall || genericPosition;
      } else if (label === 'completed_days') {
        metricScope = 'daily';
        dayIndex = Number(row?.dayIndex || 0);
        overallPosition = explicitOverall || genericPosition;
      } else {
        continue;
      }

      if (metricScope === 'daily' && (dayIndex < 1 || dayIndex > DAY_COUNT)) continue;

      statements.push(env.DB.prepare(`
        INSERT INTO duel_rank_positions(
          cycle_id,cycle_week,week_id,week_start_time,metric_scope,day_index,uid,
          overall_position,alliance_position,captured_at,source_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(cycle_id,cycle_week,metric_scope,day_index,uid) DO UPDATE SET
          week_id=excluded.week_id,
          week_start_time=excluded.week_start_time,
          overall_position=COALESCE(excluded.overall_position,duel_rank_positions.overall_position),
          alliance_position=COALESCE(excluded.alliance_position,duel_rank_positions.alliance_position),
          captured_at=CASE WHEN excluded.captured_at>duel_rank_positions.captured_at THEN excluded.captured_at ELSE duel_rank_positions.captured_at END,
          source_hash=CASE WHEN excluded.captured_at>=duel_rank_positions.captured_at THEN excluded.source_hash ELSE duel_rank_positions.source_hash END
      `).bind(
        week.cycleId, week.cycleWeek, week.weekId, week.weekStartTime,
        metricScope, dayIndex, uid, overallPosition, alliancePosition, capturedAt, sourceHashValue
      ));

      if (metricScope === 'weekly') {
        statements.push(env.DB.prepare(`
          UPDATE duel_weekly
          SET overall_position=COALESCE(?,overall_position),
              alliance_position=COALESCE(?,alliance_position)
          WHERE cycle_id=? AND cycle_week=? AND uid=?
        `).bind(overallPosition, alliancePosition, week.cycleId, week.cycleWeek, uid));
      } else {
        statements.push(env.DB.prepare(`
          UPDATE duel_daily
          SET overall_position=COALESCE(?,overall_position),
              alliance_position=COALESCE(?,alliance_position)
          WHERE cycle_id=? AND cycle_week=? AND day_index=? AND uid=?
        `).bind(overallPosition, alliancePosition, week.cycleId, week.cycleWeek, dayIndex, uid));
      }
      rowsSaved += 1;
    }
  }

  await runBatches(env.DB, statements, 70);
  return { ok: true, rows: rowsSaved, cycleId: week.cycleId, cycleWeek: week.cycleWeek };
}

async function enrichExactRanks(payload, env) {
  const cycleId = String(payload.cycleId || '');
  const cycleWeek = Number(payload.cycleWeek || 0);
  const result = await env.DB.prepare(`
    SELECT p.public_id,r.metric_scope,r.day_index,r.overall_position,r.alliance_position
    FROM duel_rank_positions r
    JOIN players p ON p.uid=r.uid
    WHERE r.cycle_id=? AND r.cycle_week=?
  `).bind(cycleId, cycleWeek).all();

  const weekly = new Map();
  const daily = new Map();
  for (const row of result.results || []) {
    const publicId = String(row.public_id || '');
    if (String(row.metric_scope) === 'weekly') {
      weekly.set(publicId, row);
      continue;
    }
    if (!daily.has(publicId)) daily.set(publicId, []);
    daily.get(publicId).push(row);
  }

  payload.players = (payload.players || []).map(player => {
    const id = String(player.publicId || '');
    const weeklyRow = weekly.get(id) || {};
    const dayOverallPositions = Array.isArray(player.dayOverallPositions)
      ? [...player.dayOverallPositions]
      : Array(DAY_COUNT).fill(0);
    const dayAlliancePositions = Array.isArray(player.dayAlliancePositions)
      ? [...player.dayAlliancePositions]
      : Array(DAY_COUNT).fill(0);

    while (dayOverallPositions.length < DAY_COUNT) dayOverallPositions.push(0);
    while (dayAlliancePositions.length < DAY_COUNT) dayAlliancePositions.push(0);

    for (const row of daily.get(id) || []) {
      const index = Number(row.day_index || 0) - 1;
      if (index < 0 || index >= DAY_COUNT) continue;
      if (row.overall_position != null) dayOverallPositions[index] = Number(row.overall_position || 0);
      if (row.alliance_position != null) dayAlliancePositions[index] = Number(row.alliance_position || 0);
    }

    const weeklyOverallPosition = Number(weeklyRow.overall_position || player.weeklyOverallPosition || 0);
    const weeklyAlliancePosition = Number(weeklyRow.alliance_position || player.weeklyAlliancePosition || player.weeklyPosition || player.rank || 0);
    return {
      ...player,
      weeklyOverallPosition,
      weeklyAlliancePosition,
      weeklyPosition: weeklyAlliancePosition,
      dayOverallPositions,
      dayAlliancePositions
    };
  });

  payload.rankPositionDataVersion = 2;
  return payload;
}

async function resolveWeek(snapshots, base, env) {
  if (base?.cycleId && base?.cycleWeek) {
    const row = await env.DB.prepare(`
      SELECT week_id,week_start_time
      FROM duel_weekly
      WHERE cycle_id=? AND cycle_week=?
      ORDER BY captured_at DESC LIMIT 1
    `).bind(String(base.cycleId), Number(base.cycleWeek)).first();
    if (row) {
      return {
        cycleId: String(base.cycleId),
        cycleWeek: Number(base.cycleWeek),
        weekId: String(row.week_id || base.weekId || ''),
        weekStartTime: Number(row.week_start_time || 0)
      };
    }
  }

  for (const snapshot of snapshots) {
    const hash = sourceHash(snapshot);
    if (!hash) continue;
    const row = await env.DB.prepare(`
      SELECT cycle_id,cycle_week,week_id,week_start_time
      FROM captures WHERE source_hash=? ORDER BY id DESC LIMIT 1
    `).bind(hash).first();
    if (row) {
      return {
        cycleId: String(row.cycle_id || ''),
        cycleWeek: Number(row.cycle_week || 0),
        weekId: String(row.week_id || ''),
        weekStartTime: Number(row.week_start_time || 0)
      };
    }
  }
  return null;
}

function inferDayIndex(capturedAt, weekStartTime) {
  const captured = new Date(String(capturedAt || '')).getTime();
  const start = Number(weekStartTime || 0);
  if (!Number.isFinite(captured) || !start) return 1;
  return Math.max(1, Math.min(DAY_COUNT, Math.floor((captured - start) / DAY_MS) + 1));
}

function sourceHash(snapshot) {
  return String(snapshot?.source_hash || snapshot?.sourceHash || '');
}

function captureTime(snapshot) {
  return String(snapshot?.captured_at || snapshot?.capturedAt || '');
}

function positiveNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function runBatches(db, statements, size) {
  for (let i = 0; i < statements.length; i += size) {
    const chunk = statements.slice(i, i + size);
    if (chunk.length) await db.batch(chunk);
  }
}

function jsonLike(response, value) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { status: response.status, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
