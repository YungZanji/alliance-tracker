import portal from './scoring-entry-v161.js';

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
        const supplemental = await persistDuelFidelity(body, base, env);
        return jsonLike(response, { ...base, ...supplemental });
      } catch (error) {
        console.error('Full-fidelity Duel supplemental sync failed', error);
        return json({
          ok: false,
          error: `Core Duel scores were accepted, but matchup/rank fidelity sync failed: ${String(error?.message || error)}. Retry is safe.`,
          code: 'DUEL_FIDELITY_SYNC_FAILED'
        }, 500);
      }
    }

    if (url.pathname === '/api/duel' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const payload = await response.clone().json();
        if (!payload?.ok || !payload.cycleId || !payload.cycleWeek) return response;
        const enriched = await enrichDuelPayload(payload, env);
        return jsonLike(response, enriched);
      } catch (error) {
        console.warn('Could not enrich Duel response with exact matchup/rank context', error);
        return response;
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function persistDuelFidelity(body, base, env) {
  const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  if (!snapshots.length) return { fidelitySync: { ok: true, skipped: true } };

  const week = await resolveSyncedWeek(snapshots, base, env);
  if (!week) throw new Error('Could not resolve the synchronized Duel week.');

  const primaryAlliance = String(base?.primaryAlliance || env.PRIMARY_ALLIANCE_ABBR || 'WDZ').trim();
  const groupSnapshots = snapshots.filter(snapshot => String(snapshot?.dataset || '') === 'alliance_duel_group');
  const rankingSnapshots = snapshots.filter(snapshot => String(snapshot?.dataset || '') === 'alliance_duel_rankings');

  let groupRows = [];
  let groupContext = {};
  let groupCapturedAt = '';
  let groupSourceHash = '';
  for (const snapshot of groupSnapshots) {
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    if (!rows.length) continue;
    groupRows = rows;
    groupContext = snapshot.context || {};
    groupCapturedAt = captureTime(snapshot);
    groupSourceHash = sourceHash(snapshot);
  }

  const statements = [];
  if (groupRows.length) {
    for (const row of groupRows) {
      const allianceId = String(row?.allianceId || '');
      if (!allianceId) continue;
      statements.push(env.DB.prepare(`
        INSERT INTO duel_group_members(
          cycle_id,cycle_week,week_id,week_start_time,duel_group,alliance_id,alliance_abbr,alliance_name,
          server_id,league_position,rank_type,round_result,captured_at,source_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(cycle_id,cycle_week,alliance_id) DO UPDATE SET
          week_id=excluded.week_id,week_start_time=excluded.week_start_time,duel_group=excluded.duel_group,
          alliance_abbr=excluded.alliance_abbr,alliance_name=excluded.alliance_name,server_id=excluded.server_id,
          league_position=excluded.league_position,rank_type=excluded.rank_type,round_result=excluded.round_result,
          captured_at=excluded.captured_at,source_hash=excluded.source_hash
        WHERE excluded.captured_at >= duel_group_members.captured_at
      `).bind(
        week.cycleId, week.cycleWeek, week.weekId, week.weekStartTime,
        String(row?.group || groupContext?.duelGroup || ''), allianceId,
        String(row?.allianceAbbr || ''), String(row?.allianceName || ''), nullableNumber(row?.serverId),
        nullableNumber(row?.position), nullableNumber(row?.rankType), String(row?.roundResult || ''),
        groupCapturedAt || newestCapture(snapshots), groupSourceHash
      ));
    }
  }

  const positionUpdates = positionStatements(rankingSnapshots, week, primaryAlliance, env);
  statements.push(...positionUpdates.statements);

  const matchup = deriveMatchup(groupRows, groupContext, rankingSnapshots, primaryAlliance, week);
  if (matchup) {
    statements.push(env.DB.prepare(`
      INSERT INTO duel_matchups(
        cycle_id,cycle_week,week_id,week_start_time,duel_group,
        primary_alliance_id,primary_alliance_abbr,primary_alliance_name,primary_state,
        opponent_alliance_id,opponent_abbr,opponent_name,opponent_state,captured_at,source_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
        week_id=excluded.week_id,week_start_time=excluded.week_start_time,duel_group=excluded.duel_group,
        primary_alliance_id=excluded.primary_alliance_id,primary_alliance_abbr=excluded.primary_alliance_abbr,
        primary_alliance_name=excluded.primary_alliance_name,primary_state=excluded.primary_state,
        opponent_alliance_id=excluded.opponent_alliance_id,opponent_abbr=excluded.opponent_abbr,
        opponent_name=excluded.opponent_name,opponent_state=excluded.opponent_state,
        captured_at=excluded.captured_at,source_hash=excluded.source_hash
      WHERE excluded.captured_at >= duel_matchups.captured_at
    `).bind(
      week.cycleId, week.cycleWeek, week.weekId, week.weekStartTime, matchup.duelGroup,
      matchup.primaryAllianceId, matchup.primaryAllianceAbbr, matchup.primaryAllianceName, matchup.primaryState,
      matchup.opponentAllianceId, matchup.opponentAbbr, matchup.opponentName, matchup.opponentState,
      matchup.capturedAt, matchup.sourceHash
    ));

    // Keep the existing generic matchup context authoritative as well so older
    // portal views can benefit without knowing about the new Duel-specific table.
    statements.push(env.DB.prepare(`
      INSERT INTO event_week_context(event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at,updated_by_uid)
      VALUES('alliance_duel',?,?,?,?,?,?,NULL)
      ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
        opponent_state=excluded.opponent_state,opponent_label=excluded.opponent_label,
        source=excluded.source,updated_at=excluded.updated_at
    `).bind(
      week.cycleId, week.cycleWeek, matchup.opponentState,
      [matchup.opponentAbbr, matchup.opponentName].filter(Boolean).join(' · '),
      'direct_duel', matchup.capturedAt
    ));
  }

  await runBatches(env.DB, statements, 70);

  return {
    fidelitySync: {
      ok: true,
      groupMembers: groupRows.length,
      weeklyRanksUpdated: positionUpdates.weekly,
      dailyRanksUpdated: positionUpdates.daily,
      matchupCaptured: Boolean(matchup)
    },
    matchup: matchup ? publicMatchup(matchup) : null
  };
}

function positionStatements(snapshots, week, primaryAlliance, env) {
  const statements = [];
  let weekly = 0;
  let daily = 0;

  for (const snapshot of snapshots) {
    const label = String(snapshot?.context?.rankTypeLabel || '');
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    if (!rows.length) continue;
    const capturedAt = captureTime(snapshot);
    const source = sourceHash(snapshot);
    const inferredDay = inferDayIndex(capturedAt, week.weekStartTime);
    const allianceOrdinal = new Map();

    for (const row of rows) {
      const abbr = String(row?.allianceAbbr || '');
      const day = label === 'completed_days' ? Number(row?.dayIndex || 0) : 0;
      const ordinalKey = `${day}|${abbr}`;
      const ordinal = (allianceOrdinal.get(ordinalKey) || 0) + 1;
      allianceOrdinal.set(ordinalKey, ordinal);
      if (abbr !== primaryAlliance) continue;

      const uid = String(row?.uid || '');
      if (!uid) continue;
      const rawPosition = positiveNumber(row?.position);
      const explicitOverall = positiveNumber(row?.overallPosition);
      const explicitAlliance = positiveNumber(row?.alliancePosition);
      const alliancePosition = explicitAlliance || ordinal || null;

      if (label === 'weekly_combined' || label === 'weekly_own_alliance') {
        const overallPosition = label === 'weekly_combined' ? (explicitOverall || rawPosition) : null;
        const ownPosition = label === 'weekly_own_alliance' ? (explicitAlliance || rawPosition || alliancePosition) : alliancePosition;
        statements.push(env.DB.prepare(`
          UPDATE duel_weekly
          SET overall_position=COALESCE(?,overall_position),
              alliance_position=COALESCE(?,alliance_position)
          WHERE cycle_id=? AND cycle_week=? AND uid=? AND captured_at<=?
        `).bind(overallPosition, ownPosition, week.cycleId, week.cycleWeek, uid, capturedAt));
        weekly += 1;
      }

      if (label === 'current_day_combined' || label === 'completed_days') {
        const dayIndex = label === 'current_day_combined' ? inferredDay : Number(row?.dayIndex || 0);
        if (dayIndex < 1 || dayIndex > DAY_COUNT) continue;
        const overallPosition = explicitOverall || rawPosition;
        statements.push(env.DB.prepare(`
          UPDATE duel_daily
          SET overall_position=COALESCE(?,overall_position),
              alliance_position=COALESCE(?,alliance_position)
          WHERE cycle_id=? AND cycle_week=? AND day_index=? AND uid=? AND captured_at<=?
        `).bind(overallPosition, alliancePosition, week.cycleId, week.cycleWeek, dayIndex, uid, capturedAt));
        daily += 1;
      }
    }
  }
  return { statements, weekly, daily };
}

function deriveMatchup(groupRows, groupContext, rankingSnapshots, primaryAlliance, week) {
  const combined = rankingSnapshots
    .filter(snapshot => ['current_day_combined', 'weekly_combined'].includes(String(snapshot?.context?.rankTypeLabel || '')))
    .sort((a, b) => String(captureTime(b)).localeCompare(String(captureTime(a))));

  const candidateCounts = new Map();
  const candidateRows = new Map();
  for (const snapshot of combined) {
    for (const row of Array.isArray(snapshot?.rows) ? snapshot.rows : []) {
      const abbr = String(row?.allianceAbbr || '');
      if (!abbr || abbr === primaryAlliance) continue;
      candidateCounts.set(abbr, (candidateCounts.get(abbr) || 0) + 1);
      if (!candidateRows.has(abbr)) candidateRows.set(abbr, row);
    }
  }
  const opponentAbbr = [...candidateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  if (!opponentAbbr) return null;

  const primaryGroup = groupRows.find(row => String(row?.allianceAbbr || '') === primaryAlliance) || {};
  const opponentGroup = groupRows.find(row => String(row?.allianceAbbr || '') === opponentAbbr) || {};
  const opponentRank = candidateRows.get(opponentAbbr) || {};
  const primaryRank = firstRankingRow(combined, primaryAlliance);
  const group = String(primaryGroup?.group || opponentGroup?.group || groupContext?.duelGroup || '');
  const capturedAt = newestCapture([
    ...combined,
    ...(groupRows.length ? [{ capturedAt: String(groupContext?.capturedAt || '') }] : [])
  ]) || new Date().toISOString();
  const source = combined[0] ? sourceHash(combined[0]) : '';

  return {
    cycleId: week.cycleId,
    cycleWeek: week.cycleWeek,
    duelGroup: group,
    primaryAllianceId: String(primaryGroup?.allianceId || primaryRank?.allianceId || ''),
    primaryAllianceAbbr: primaryAlliance,
    primaryAllianceName: String(primaryGroup?.allianceName || primaryRank?.allianceName || ''),
    primaryState: nullableNumber(primaryGroup?.serverId ?? primaryRank?.serverId),
    opponentAllianceId: String(opponentGroup?.allianceId || opponentRank?.allianceId || ''),
    opponentAbbr,
    opponentName: String(opponentGroup?.allianceName || opponentRank?.allianceName || ''),
    opponentState: nullableNumber(opponentGroup?.serverId ?? opponentRank?.serverId),
    capturedAt: newestCapture(combined) || new Date().toISOString(),
    sourceHash: source
  };
}

function firstRankingRow(snapshots, abbr) {
  for (const snapshot of snapshots) {
    const row = (snapshot?.rows || []).find(item => String(item?.allianceAbbr || '') === abbr);
    if (row) return row;
  }
  return {};
}

async function resolveSyncedWeek(snapshots, base, env) {
  if (base?.cycleId && base?.cycleWeek) {
    const row = await env.DB.prepare(`
      SELECT week_id,week_start_time FROM duel_weekly
      WHERE cycle_id=? AND cycle_week=? ORDER BY captured_at DESC LIMIT 1
    `).bind(String(base.cycleId), Number(base.cycleWeek)).first();
    if (row) return {
      cycleId: String(base.cycleId), cycleWeek: Number(base.cycleWeek),
      weekId: String(row.week_id || base.weekId || ''), weekStartTime: Number(row.week_start_time || 0)
    };
  }

  for (const snapshot of snapshots) {
    const hash = sourceHash(snapshot);
    if (!hash) continue;
    const row = await env.DB.prepare(`
      SELECT cycle_id,cycle_week,week_id,week_start_time FROM captures
      WHERE source_hash=? ORDER BY id DESC LIMIT 1
    `).bind(hash).first();
    if (row) return {
      cycleId: String(row.cycle_id || ''), cycleWeek: Number(row.cycle_week || 0),
      weekId: String(row.week_id || ''), weekStartTime: Number(row.week_start_time || 0)
    };
  }
  return null;
}

async function enrichDuelPayload(payload, env) {
  const cycleId = String(payload.cycleId || '');
  const cycleWeek = Number(payload.cycleWeek || 0);
  const [matchup, groups, weekly, daily] = await Promise.all([
    env.DB.prepare(`SELECT * FROM duel_matchups WHERE cycle_id=? AND cycle_week=? LIMIT 1`).bind(cycleId, cycleWeek).first(),
    env.DB.prepare(`SELECT * FROM duel_group_members WHERE cycle_id=? AND cycle_week=? ORDER BY league_position,alliance_name`).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT p.public_id,w.overall_position,w.alliance_position
      FROM duel_weekly w JOIN players p ON p.uid=w.uid
      WHERE w.cycle_id=? AND w.cycle_week=?
    `).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT p.public_id,d.day_index,d.overall_position,d.alliance_position
      FROM duel_daily d JOIN players p ON p.uid=d.uid
      WHERE d.cycle_id=? AND d.cycle_week=?
    `).bind(cycleId, cycleWeek).all()
  ]);

  const weeklyByPlayer = new Map((weekly.results || []).map(row => [String(row.public_id), row]));
  const dailyByPlayer = new Map();
  for (const row of daily.results || []) {
    const id = String(row.public_id || '');
    if (!dailyByPlayer.has(id)) dailyByPlayer.set(id, []);
    dailyByPlayer.get(id).push(row);
  }

  payload.players = (payload.players || []).map(player => {
    const id = String(player.publicId || '');
    const weekRank = weeklyByPlayer.get(id) || {};
    const dayOverallPositions = Array(DAY_COUNT).fill(0);
    const dayAlliancePositions = Array(DAY_COUNT).fill(0);
    for (const row of dailyByPlayer.get(id) || []) {
      const index = Number(row.day_index || 0) - 1;
      if (index < 0 || index >= DAY_COUNT) continue;
      dayOverallPositions[index] = Number(row.overall_position || 0);
      dayAlliancePositions[index] = Number(row.alliance_position || 0);
    }
    const weeklyOverallPosition = Number(weekRank.overall_position || 0);
    const weeklyAlliancePosition = Number(weekRank.alliance_position || player.weeklyPosition || player.rank || 0);
    return {
      ...player,
      weeklyOverallPosition,
      weeklyAlliancePosition,
      weeklyPosition: weeklyAlliancePosition,
      dayOverallPositions,
      dayAlliancePositions
    };
  });

  payload.matchup = matchup ? publicMatchup(matchup) : null;
  payload.duelGroupMembers = (groups.results || []).map(row => ({
    allianceId: String(row.alliance_id || ''),
    allianceAbbr: String(row.alliance_abbr || ''),
    allianceName: String(row.alliance_name || ''),
    serverId: nullableNumber(row.server_id),
    position: nullableNumber(row.league_position),
    rankType: nullableNumber(row.rank_type),
    roundResult: String(row.round_result || ''),
    group: String(row.duel_group || '')
  }));
  payload.rankPositionDataVersion = 1;
  return payload;
}

function publicMatchup(row) {
  return {
    duelGroup: String(row.duel_group || row.duelGroup || ''),
    primary: {
      allianceId: String(row.primary_alliance_id || row.primaryAllianceId || ''),
      abbr: String(row.primary_alliance_abbr || row.primaryAllianceAbbr || ''),
      name: String(row.primary_alliance_name || row.primaryAllianceName || ''),
      serverId: nullableNumber(row.primary_state ?? row.primaryState)
    },
    opponent: {
      allianceId: String(row.opponent_alliance_id || row.opponentAllianceId || ''),
      abbr: String(row.opponent_abbr || row.opponentAbbr || ''),
      name: String(row.opponent_name || row.opponentName || ''),
      serverId: nullableNumber(row.opponent_state ?? row.opponentState)
    },
    capturedAt: String(row.captured_at || row.capturedAt || '')
  };
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

function newestCapture(snapshots) {
  return (snapshots || []).map(captureTime).filter(Boolean).sort().at(-1) || '';
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
