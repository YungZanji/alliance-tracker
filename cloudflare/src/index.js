const TIME_ZONE = 'America/Vancouver';
const DAY_COUNT = 6;
const WEEKS_PER_CYCLE = 4;
const DAY_MS = 86_400_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'Alliance Tracker', now: new Date().toISOString() });
      }
      if (url.pathname === '/api/sync' && request.method === 'POST') return handleSync(request, env);
      if (url.pathname === '/api/dashboard' && request.method === 'GET') return handleDashboard(url, env);
      if (url.pathname.startsWith('/api/player/') && request.method === 'GET') {
        return handlePlayer(url.pathname.split('/').pop(), url, env);
      }
      if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
};

async function handleSync(request, env) {
  const body = await request.json();
  const supplied = String(body.uploadToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '');
  if (!env.UPLOAD_TOKEN || supplied !== String(env.UPLOAD_TOKEN)) {
    return json({ ok: false, error: 'Invalid upload token.' }, 401);
  }
  const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
  if (!snapshots.length) return json({ ok: true, accepted: 0, duplicates: 0, acceptedSnapshotIds: [] });

  const primaryAlliance = String(env.PRIMARY_ALLIANCE_ABBR || 'WDZ').trim();
  const batchWeek = resolveBatchWeek(snapshots, body.sentAt, env);
  const existingCaptures = await env.DB.prepare('SELECT dataset, source_hash FROM captures').all();
  const known = new Set((existingCaptures.results || []).map(row => `${row.dataset}|${row.source_hash}`));
  const acceptedIds = [];
  const uniqueSnapshots = [];
  let duplicates = 0;

  for (const snapshot of snapshots) {
    const key = `${String(snapshot.dataset || '')}|${String(snapshot.source_hash || snapshot.sourceHash || '')}`;
    if (known.has(key)) {
      duplicates += 1;
      if (snapshot.id !== undefined) acceptedIds.push(snapshot.id);
      continue;
    }
    known.add(key);
    uniqueSnapshots.push(snapshot);
    if (snapshot.id !== undefined) acceptedIds.push(snapshot.id);
  }

  if (!uniqueSnapshots.length) {
    return json({ ok: true, accepted: 0, duplicates, acceptedSnapshotIds: acceptedIds, primaryAlliance });
  }

  const collected = collectSnapshots(uniqueSnapshots, batchWeek, primaryAlliance, env);
  const incomingUids = [...collected.players.keys()];
  const existingPlayersResult = await env.DB.prepare('SELECT * FROM players').all();
  const existingPlayers = new Map((existingPlayersResult.results || []).map(row => [String(row.uid), row]));
  const existingWeeklyResult = await env.DB.prepare(
    'SELECT * FROM duel_weekly WHERE cycle_id = ? AND cycle_week = ?'
  ).bind(batchWeek.cycleId, batchWeek.cycleWeek).all();
  const existingDailyResult = await env.DB.prepare(
    'SELECT * FROM duel_daily WHERE cycle_id = ? AND cycle_week = ?'
  ).bind(batchWeek.cycleId, batchWeek.cycleWeek).all();
  const existingWeekly = new Map((existingWeeklyResult.results || []).map(row => [weeklyKey(row), row]));
  const existingDaily = new Map((existingDailyResult.results || []).map(row => [dailyKey(row), row]));

  const statements = [];
  const history = [];

  for (const player of collected.players.values()) {
    const existing = existingPlayers.get(player.uid);
    const publicId = existing?.public_id || randomPublicId();
    statements.push(env.DB.prepare(`
      INSERT INTO players(uid, public_id, current_name, alliance_id, alliance_abbr, alliance_name, server_id, country, first_seen_at, last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(uid) DO UPDATE SET
        current_name=excluded.current_name,
        alliance_id=excluded.alliance_id,
        alliance_abbr=excluded.alliance_abbr,
        alliance_name=excluded.alliance_name,
        server_id=excluded.server_id,
        country=excluded.country,
        first_seen_at=CASE WHEN players.first_seen_at < excluded.first_seen_at THEN players.first_seen_at ELSE excluded.first_seen_at END,
        last_seen_at=CASE WHEN players.last_seen_at > excluded.last_seen_at THEN players.last_seen_at ELSE excluded.last_seen_at END
    `).bind(player.uid, publicId, player.name, player.allianceId, player.allianceAbbr, player.allianceName,
      player.serverId, player.country, player.capturedAt, player.capturedAt));
  }

  for (const alias of collected.aliases.values()) {
    statements.push(env.DB.prepare(`
      INSERT INTO player_aliases(alias_key, uid, name, first_seen_at, last_seen_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(alias_key) DO UPDATE SET
        first_seen_at=CASE WHEN player_aliases.first_seen_at < excluded.first_seen_at THEN player_aliases.first_seen_at ELSE excluded.first_seen_at END,
        last_seen_at=CASE WHEN player_aliases.last_seen_at > excluded.last_seen_at THEN player_aliases.last_seen_at ELSE excluded.last_seen_at END
    `).bind(alias.key, alias.uid, alias.name, alias.capturedAt, alias.capturedAt));
  }

  for (const row of collected.weekly.values()) {
    const current = existingWeekly.get(weeklyKey(row));
    if (!shouldReplace(current, row)) continue;
    const oldScore = Number(current?.score || 0);
    if (!current || oldScore !== row.score) history.push(historyRow('weekly', row, oldScore));
    statements.push(env.DB.prepare(`
      INSERT INTO duel_weekly(cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week,uid) DO UPDATE SET
        week_id=excluded.week_id,week_start_time=excluded.week_start_time,name_at_capture=excluded.name_at_capture,
        score=excluded.score,position=excluded.position,score_source=excluded.score_source,source_priority=excluded.source_priority,
        captured_at=excluded.captured_at,alliance_id=excluded.alliance_id,alliance_abbr=excluded.alliance_abbr,
        alliance_name=excluded.alliance_name,server_id=excluded.server_id,country=excluded.country,source_hash=excluded.source_hash
    `).bind(row.cycleId,row.cycleWeek,row.weekId,row.weekStartTime,row.uid,row.name,row.score,row.position,row.source,row.priority,
      row.capturedAt,row.allianceId,row.allianceAbbr,row.allianceName,row.serverId,row.country,row.sourceHash));
  }

  for (const row of collected.daily.values()) {
    const current = existingDaily.get(dailyKey(row));
    if (!shouldReplace(current, row)) continue;
    const oldScore = Number(current?.score || 0);
    if (!current || oldScore !== row.score) history.push(historyRow('daily', row, oldScore));
    statements.push(env.DB.prepare(`
      INSERT INTO duel_daily(cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week,day_index,uid) DO UPDATE SET
        week_id=excluded.week_id,week_start_time=excluded.week_start_time,name_at_capture=excluded.name_at_capture,
        score=excluded.score,score_source=excluded.score_source,source_priority=excluded.source_priority,captured_at=excluded.captured_at,
        alliance_id=excluded.alliance_id,alliance_abbr=excluded.alliance_abbr,alliance_name=excluded.alliance_name,
        server_id=excluded.server_id,country=excluded.country,source_hash=excluded.source_hash
    `).bind(row.cycleId,row.cycleWeek,row.weekId,row.weekStartTime,row.dayIndex,row.uid,row.name,row.score,row.source,row.priority,
      row.capturedAt,row.allianceId,row.allianceAbbr,row.allianceName,row.serverId,row.country,row.sourceHash));
  }

  for (const change of history) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO score_history(change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,old_score,new_score,delta,captured_at,score_source,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(change.id,change.metricType,change.rowKey,change.cycleId,change.cycleWeek,change.weekId,change.dayIndex,
      change.uid,change.name,change.oldScore,change.newScore,change.delta,change.capturedAt,change.source,change.sourceHash));
  }

  for (const row of collected.results.values()) {
    statements.push(env.DB.prepare(`
      INSERT INTO duel_results(cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,alliance_score,opponent_score,is_win,mvp_uid,mvp_name,mvp_score,captured_at,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week,day_index) DO UPDATE SET
        week_id=excluded.week_id,week_start_time=excluded.week_start_time,event_name=excluded.event_name,
        alliance_score=excluded.alliance_score,opponent_score=excluded.opponent_score,is_win=excluded.is_win,
        mvp_uid=excluded.mvp_uid,mvp_name=excluded.mvp_name,mvp_score=excluded.mvp_score,captured_at=excluded.captured_at,source_hash=excluded.source_hash
      WHERE excluded.captured_at >= duel_results.captured_at
    `).bind(row.cycleId,row.cycleWeek,row.weekId,row.weekStartTime,row.dayIndex,row.eventName,row.allianceScore,row.opponentScore,
      row.isWin,row.mvpUid,row.mvpName,row.mvpScore,row.capturedAt,row.sourceHash));
  }

  for (const row of collected.seasons.values()) {
    statements.push(env.DB.prepare(`
      INSERT INTO duel_seasons(cycle_id,cycle_week,week_id,week_start_time,captured_at,current_position,current_group,current_round_result,current_rank_type,previous_position,previous_group,previous_round_result,previous_rank_type,message_id,source_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
        week_id=excluded.week_id,week_start_time=excluded.week_start_time,captured_at=excluded.captured_at,
        current_position=excluded.current_position,current_group=excluded.current_group,current_round_result=excluded.current_round_result,current_rank_type=excluded.current_rank_type,
        previous_position=excluded.previous_position,previous_group=excluded.previous_group,previous_round_result=excluded.previous_round_result,previous_rank_type=excluded.previous_rank_type,
        message_id=excluded.message_id,source_hash=excluded.source_hash
      WHERE excluded.captured_at >= duel_seasons.captured_at
    `).bind(row.cycleId,row.cycleWeek,row.weekId,row.weekStartTime,row.capturedAt,row.currentPosition,row.currentGroup,row.currentRoundResult,
      row.currentRankType,row.previousPosition,row.previousGroup,row.previousRoundResult,row.previousRankType,row.messageId,row.sourceHash));
  }

  for (const capture of collected.captures) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO captures(local_snapshot_id,session_id,dataset,command,captured_at,week_id,week_start_time,cycle_id,cycle_week,primary_alliance,rank_type,rank_type_label,source_hash,row_count,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(capture.localSnapshotId,capture.sessionId,capture.dataset,capture.command,capture.capturedAt,capture.weekId,capture.weekStartTime,
      capture.cycleId,capture.cycleWeek,primaryAlliance,capture.rankType,capture.rankTypeLabel,capture.sourceHash,capture.rowCount,new Date().toISOString()));
  }

  await runBatches(env.DB, statements, 80);
  return json({
    ok: true,
    accepted: uniqueSnapshots.length,
    duplicates,
    acceptedSnapshotIds: acceptedIds,
    primaryAlliance,
    weekId: batchWeek.weekId,
    cycleId: batchWeek.cycleId,
    cycleWeek: batchWeek.cycleWeek,
    weeklyChanges: [...collected.weekly.values()].filter(row => shouldReplace(existingWeekly.get(weeklyKey(row)), row)).length,
    dailyChanges: [...collected.daily.values()].filter(row => shouldReplace(existingDaily.get(dailyKey(row)), row)).length
  });
}

function collectSnapshots(snapshots, batchWeek, primaryAlliance, env) {
  const result = {
    players: new Map(), aliases: new Map(), weekly: new Map(), daily: new Map(),
    results: new Map(), seasons: new Map(), captures: []
  };
  for (const snapshot of snapshots) {
    const dataset = String(snapshot.dataset || '');
    const context = snapshot.context || {};
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const capturedAt = String(snapshot.captured_at || snapshot.capturedAt || new Date().toISOString());
    const sourceHash = String(snapshot.source_hash || snapshot.sourceHash || '');
    const week = resolveSnapshotWeek(snapshot, batchWeek, env);
    result.captures.push({
      localSnapshotId: snapshot.id ?? null,
      sessionId: String(snapshot.session_id || snapshot.sessionId || ''), dataset,
      command: String(snapshot.command || ''), capturedAt, weekId: week.weekId, weekStartTime: week.weekStartTime,
      cycleId: week.cycleId, cycleWeek: week.cycleWeek,
      rankType: context.rankType ?? null, rankTypeLabel: String(context.rankTypeLabel || ''), sourceHash, rowCount: rows.length
    });

    if (dataset === 'alliance_duel_rankings') {
      const label = String(context.rankTypeLabel || '');
      const inferredDay = inferDayIndex(capturedAt, week.weekStartTime);
      for (const raw of rows) {
        if (String(raw.allianceAbbr || '') !== primaryAlliance) continue;
        const uid = String(raw.uid || '');
        const name = String(raw.name || '');
        if (!uid) continue;
        const identity = {
          uid, name, allianceId: String(raw.allianceId || ''), allianceAbbr: String(raw.allianceAbbr || ''),
          allianceName: String(raw.allianceName || ''), serverId: Number(raw.serverId || 0), country: String(raw.country || ''), capturedAt
        };
        const currentIdentity = result.players.get(uid);
        if (!currentIdentity || capturedAt >= currentIdentity.capturedAt) result.players.set(uid, identity);
        const aliasKey = `${uid}|${name}`;
        const currentAlias = result.aliases.get(aliasKey);
        if (!currentAlias || capturedAt >= currentAlias.capturedAt) result.aliases.set(aliasKey, { key: aliasKey, uid, name, capturedAt });

        if (label === 'weekly_own_alliance' || label === 'weekly_combined') {
          const candidate = {
            ...identity, cycleId: week.cycleId, cycleWeek: week.cycleWeek, weekId: week.weekId,
            weekStartTime: week.weekStartTime, score: Number(raw.score || 0), position: Number(raw.position || 0),
            source: label, priority: label === 'weekly_own_alliance' ? 20 : 10, sourceHash
          };
          mergePreferred(result.weekly, weeklyKey(candidate), candidate);
        }

        if (label === 'completed_days' || label === 'current_day_combined') {
          const dayIndex = label === 'current_day_combined' ? inferredDay : Number(raw.dayIndex || 0);
          if (dayIndex < 1 || dayIndex > DAY_COUNT) continue;
          const candidate = {
            ...identity, cycleId: week.cycleId, cycleWeek: week.cycleWeek, weekId: week.weekId,
            weekStartTime: week.weekStartTime, dayIndex, score: Number(raw.score || 0),
            source: label, priority: label === 'completed_days' ? 20 : 10, sourceHash
          };
          mergePreferred(result.daily, dailyKey(candidate), candidate);
        }
      }
    }

    if (dataset === 'alliance_duel_results') {
      for (const raw of rows) {
        const dayIndex = Number(raw.dayIndex || raw.day || 0);
        if (dayIndex < 1 || dayIndex > DAY_COUNT) continue;
        const mvp = raw.mvp && typeof raw.mvp === 'object' ? raw.mvp : {};
        const row = {
          cycleId: week.cycleId, cycleWeek: week.cycleWeek, weekId: week.weekId, weekStartTime: week.weekStartTime,
          dayIndex, eventName: String(raw.name || ''), allianceScore: nullableNumber(raw.allianceScore),
          opponentScore: nullableNumber(raw.vsAllianceScore), isWin: raw.isWin === undefined ? null : Number(raw.isWin),
          mvpUid: String(mvp.uid || ''), mvpName: String(mvp.name || ''), mvpScore: nullableNumber(mvp.score), capturedAt, sourceHash
        };
        result.results.set(`${row.cycleId}|${row.cycleWeek}|${dayIndex}`, row);
      }
    }

    if (dataset === 'alliance_duel_season') {
      const payload = rows[0] || {};
      const current = payload.duelInfo || {};
      const previous = payload.lastDuelInfo || {};
      const row = {
        cycleId: week.cycleId, cycleWeek: week.cycleWeek, weekId: week.weekId, weekStartTime: week.weekStartTime, capturedAt,
        currentPosition: nullableNumber(current.position), currentGroup: String(current.group || ''), currentRoundResult: String(current.roundResult || ''), currentRankType: String(current.rankType || ''),
        previousPosition: nullableNumber(previous.position), previousGroup: String(previous.group || ''), previousRoundResult: String(previous.roundResult || ''), previousRankType: String(previous.rankType || ''),
        messageId: String(payload._id || ''), sourceHash
      };
      result.seasons.set(`${row.cycleId}|${row.cycleWeek}`, row);
    }
  }
  return result;
}

async function handleDashboard(url, env) {
  const cyclesResult = await env.DB.prepare('SELECT DISTINCT cycle_id FROM duel_weekly ORDER BY cycle_id DESC').all();
  const cycles = (cyclesResult.results || []).map(row => String(row.cycle_id));
  const requested = String(url.searchParams.get('cycle') || '');
  const selected = cycles.includes(requested) ? requested : (cycles[0] || '');
  if (!selected) return json({ ok: true, selectedCycleId: '', cycles: [], players: [], summary: emptySummary(env), dataQuality: { status: 'empty', missing: ['No synchronized Alliance Duel data yet.'] } });

  const aggregateResult = await env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,p.alliance_abbr,p.alliance_name,p.server_id,p.country,
      COALESCE(SUM(w.score),0) AS all_time_total,
      COALESCE(SUM(CASE WHEN w.cycle_id=? THEN w.score ELSE 0 END),0) AS cycle_total,
      COUNT(DISTINCT CASE WHEN w.score>0 THEN w.cycle_id END) AS cycles_participated,
      MAX(w.captured_at) AS latest_capture
    FROM players p LEFT JOIN duel_weekly w ON w.uid=p.uid
    GROUP BY p.uid
    HAVING all_time_total>0 OR cycle_total>0
    ORDER BY all_time_total DESC, p.current_name ASC
  `).bind(selected).all();
  const selectedWeeksResult = await env.DB.prepare(`
    SELECT p.public_id,w.cycle_week,w.score,w.captured_at
    FROM duel_weekly w JOIN players p ON p.uid=w.uid
    WHERE w.cycle_id=?
  `).bind(selected).all();
  const aliasesResult = await env.DB.prepare(`
    SELECT p.public_id,a.name FROM player_aliases a JOIN players p ON p.uid=a.uid
  `).all();
  const summaryResult = await env.DB.prepare(`
    SELECT COUNT(DISTINCT uid) AS participants, MAX(cycle_week) AS current_week, MAX(captured_at) AS latest_capture
    FROM duel_weekly WHERE cycle_id=?
  `).bind(selected).first();

  const weeksByPlayer = new Map();
  for (const row of selectedWeeksResult.results || []) {
    if (!weeksByPlayer.has(row.public_id)) weeksByPlayer.set(row.public_id, Array(WEEKS_PER_CYCLE).fill(0));
    const week = Number(row.cycle_week || 0);
    if (week >= 1 && week <= WEEKS_PER_CYCLE) weeksByPlayer.get(row.public_id)[week - 1] = Number(row.score || 0);
  }
  const aliasesByPlayer = new Map();
  for (const row of aliasesResult.results || []) {
    if (!aliasesByPlayer.has(row.public_id)) aliasesByPlayer.set(row.public_id, []);
    if (row.name && !aliasesByPlayer.get(row.public_id).includes(row.name)) aliasesByPlayer.get(row.public_id).push(row.name);
  }

  const players = (aggregateResult.results || []).map((row, index) => ({
    rank: index + 1,
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
  const allTimeScore = players.reduce((sum, row) => sum + row.allTimeTotal, 0);
  for (const row of players) row.contributionPercent = allTimeScore ? Number((row.allTimeTotal * 100 / allTimeScore).toFixed(2)) : 0;

  const cycleTotal = players.reduce((sum, row) => sum + row.cycleTotal, 0);
  const cycleStart = selected;
  return json({
    ok: true,
    selectedCycleId: selected,
    cycles: cycles.map(id => ({ id, label: cycleLabel(id) })),
    cycle: {
      id: selected,
      label: cycleLabel(selected),
      weeks: Array.from({ length: WEEKS_PER_CYCLE }, (_, i) => ({
        cycleWeek: i + 1,
        weekId: addDays(selected, i * 7),
        label: `Week ${i + 1}`,
        dateLabel: weekLabel(addDays(selected, i * 7)),
        captured: (selectedWeeksResult.results || []).some(row => Number(row.cycle_week) === i + 1)
      }))
    },
    primaryAlliance: String(env.PRIMARY_ALLIANCE_ABBR || 'WDZ'),
    summary: {
      alliance: String(env.PRIMARY_ALLIANCE_ABBR || 'WDZ'),
      allTimeScore,
      cycleScore: cycleTotal,
      participants: players.length,
      cycleParticipants: Number(summaryResult?.participants || 0),
      duelCycles: cycles.length,
      currentWeek: Number(summaryResult?.current_week || 0),
      latestCapture: summaryResult?.latest_capture || ''
    },
    players,
    dataQuality: { status: players.length ? 'complete' : 'empty', missing: players.length ? [] : ['No player weekly scores were captured.'] }
  }, 200, { 'Cache-Control': 'public, max-age=15' });
}

async function handlePlayer(publicId, url, env) {
  const player = await env.DB.prepare('SELECT * FROM players WHERE public_id=?').bind(publicId).first();
  if (!player) return json({ ok: false, error: 'Player was not found.' }, 404);
  const cycleId = String(url.searchParams.get('cycle') || '');
  const aliases = await env.DB.prepare('SELECT name,first_seen_at,last_seen_at FROM player_aliases WHERE uid=? ORDER BY last_seen_at DESC').bind(player.uid).all();
  const weekly = await env.DB.prepare('SELECT * FROM duel_weekly WHERE uid=? ORDER BY cycle_id DESC,cycle_week').bind(player.uid).all();
  const daily = cycleId ? await env.DB.prepare('SELECT * FROM duel_daily WHERE uid=? AND cycle_id=? ORDER BY cycle_week,day_index').bind(player.uid, cycleId).all() : { results: [] };
  const history = await env.DB.prepare('SELECT * FROM score_history WHERE uid=? ORDER BY captured_at DESC LIMIT 40').bind(player.uid).all();
  const allWeekly = weekly.results || [];
  const selectedWeekly = allWeekly.filter(row => String(row.cycle_id) === cycleId);
  const selectedDaily = daily.results || [];

  const weeks = Array.from({ length: WEEKS_PER_CYCLE }, (_, index) => {
    const cycleWeek = index + 1;
    const weeklyRow = selectedWeekly.find(row => Number(row.cycle_week) === cycleWeek);
    const dayRows = selectedDaily.filter(row => Number(row.cycle_week) === cycleWeek);
    const dayScores = Array(DAY_COUNT).fill(0);
    for (const row of dayRows) {
      const d = Number(row.day_index || 0);
      if (d >= 1 && d <= DAY_COUNT) dayScores[d - 1] = Number(row.score || 0);
    }
    const dailySum = dayScores.reduce((a, b) => a + b, 0);
    const weeklyScore = Number(weeklyRow?.score || 0);
    return { cycleWeek, label: `Week ${cycleWeek}`, dayScores, dailySum, weeklyScore, adjustment: weeklyScore - dailySum, capturedAt: weeklyRow?.captured_at || '' };
  });

  const cycleMap = new Map();
  for (const row of allWeekly) {
    const id = String(row.cycle_id || '');
    if (!cycleMap.has(id)) cycleMap.set(id, { cycleId: id, total: 0, weeks: 0, latestCapture: '' });
    const target = cycleMap.get(id);
    target.total += Number(row.score || 0);
    if (Number(row.score || 0) > 0) target.weeks += 1;
    if (String(row.captured_at || '') > target.latestCapture) target.latestCapture = String(row.captured_at || '');
  }
  const cycleHistory = [...cycleMap.values()].sort((a, b) => b.cycleId.localeCompare(a.cycleId)).map(row => ({ ...row, label: cycleLabel(row.cycleId) }));
  const cycleTotal = weeks.reduce((sum, row) => sum + row.weeklyScore, 0);
  const allTimeTotal = cycleHistory.reduce((sum, row) => sum + row.total, 0);

  return json({
    ok: true,
    cycleId,
    player: {
      publicId: player.public_id,
      name: player.current_name,
      allianceAbbr: player.alliance_abbr,
      allianceName: player.alliance_name,
      serverId: player.server_id,
      country: player.country,
      aliases: (aliases.results || []).map(row => ({ name: row.name, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at }))
    },
    weeks,
    cycleTotal,
    previousDuelTotal: allTimeTotal - cycleTotal,
    allTimeTotal,
    cyclesParticipated: cycleHistory.filter(row => row.total > 0).length,
    cycleHistory,
    recentChanges: (history.results || []).map(row => ({
      metricType: row.metric_type, cycleId: row.cycle_id, cycleWeek: row.cycle_week, dayIndex: row.day_index,
      oldScore: row.old_score, newScore: row.new_score, delta: row.delta, capturedAt: row.captured_at
    }))
  });
}

function resolveBatchWeek(snapshots, sentAt, env) {
  for (const snapshot of snapshots) {
    const epoch = normalizeEpoch(snapshot?.context?.weekStartTime);
    if (epoch > 0) return weekContext(epoch, env);
  }
  const first = snapshots.map(s => s.captured_at || s.capturedAt).find(Boolean) || sentAt || new Date().toISOString();
  return weekContext(derivePacificWeekStart(first), env);
}

function resolveSnapshotWeek(snapshot, fallback, env) {
  const epoch = normalizeEpoch(snapshot?.context?.weekStartTime);
  return epoch > 0 ? weekContext(epoch, env) : fallback;
}

function weekContext(weekStartTime, env) {
  const weekId = dateIdInZone(new Date(weekStartTime));
  const cycle = cycleForWeekId(weekId, String(env.DUEL_CYCLE_ANCHOR || '2026-08-02'));
  return { weekStartTime, weekId, cycleId: cycle.cycleId, cycleWeek: cycle.cycleWeek };
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
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(new Date(guess));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(year, month - 1, day, hour, minute, second) - represented;
  }
  return guess;
}

function zoneParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour) % 24, minute: Number(values.minute), second: Number(values.second) };
}

function dateIdInZone(date) {
  const p = zoneParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function cycleForWeekId(weekId, anchor) {
  const diffWeeks = Math.round((dateEpoch(weekId) - dateEpoch(anchor)) / (7 * DAY_MS));
  const cycleIndex = Math.floor(diffWeeks / WEEKS_PER_CYCLE);
  return { cycleId: addDays(anchor, cycleIndex * 28), cycleWeek: positiveMod(diffWeeks, WEEKS_PER_CYCLE) + 1 };
}

function inferDayIndex(capturedAt, weekStartTime) {
  return Math.max(1, Math.min(DAY_COUNT, Math.floor((new Date(capturedAt).getTime() - Number(weekStartTime || 0)) / DAY_MS) + 1));
}

function normalizeEpoch(value) {
  const n = Number(value || 0);
  if (!n) return 0;
  return n < 100_000_000_000 ? n * 1000 : n;
}

function mergePreferred(map, key, candidate) {
  const current = map.get(key);
  if (!current || candidate.capturedAt > current.capturedAt || (candidate.capturedAt === current.capturedAt && candidate.priority >= current.priority)) map.set(key, candidate);
}

function shouldReplace(current, incoming) {
  if (!current) return true;
  const currentTime = String(current.captured_at || current.capturedAt || '');
  const incomingTime = String(incoming.capturedAt || '');
  const currentPriority = Number(current.source_priority || current.priority || 0);
  return incomingTime > currentTime || (incomingTime === currentTime && Number(incoming.priority || 0) >= currentPriority);
}

function historyRow(metricType, row, oldScore) {
  return {
    id: crypto.randomUUID(), metricType,
    rowKey: metricType === 'weekly' ? weeklyKey(row) : dailyKey(row),
    cycleId: row.cycleId, cycleWeek: row.cycleWeek, weekId: row.weekId,
    dayIndex: metricType === 'daily' ? row.dayIndex : null, uid: row.uid, name: row.name,
    oldScore, newScore: row.score, delta: row.score - oldScore, capturedAt: row.capturedAt, source: row.source, sourceHash: row.sourceHash
  };
}

async function runBatches(db, statements, size) {
  for (let i = 0; i < statements.length; i += size) await db.batch(statements.slice(i, i + size));
}

function weeklyKey(row) { return `${row.cycle_id ?? row.cycleId}|${row.cycle_week ?? row.cycleWeek}|${row.uid}`; }
function dailyKey(row) { return `${row.cycle_id ?? row.cycleId}|${row.cycle_week ?? row.cycleWeek}|${row.day_index ?? row.dayIndex}|${row.uid}`; }
function nullableNumber(value) { return value === undefined || value === null || value === '' ? null : Number(value); }
function randomPublicId() { return crypto.randomUUID().replaceAll('-', '').slice(0, 20); }
function positiveMod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function pad(value) { return String(value).padStart(2, '0'); }
function dateEpoch(dateId) { return new Date(`${dateId}T00:00:00Z`).getTime(); }
function addDays(dateId, days) { return new Date(dateEpoch(dateId) + days * DAY_MS).toISOString().slice(0, 10); }
function dateLabel(dateId) { return new Date(`${dateId}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); }
function weekLabel(weekId) { return `${dateLabel(weekId)} – ${dateLabel(addDays(weekId, 6))}`; }
function cycleLabel(cycleId) { return `${dateLabel(cycleId)} – ${dateLabel(addDays(cycleId, 27))}`; }
function emptySummary(env) { return { alliance: String(env.PRIMARY_ALLIANCE_ABBR || 'WDZ'), allTimeScore: 0, cycleScore: 0, participants: 0, cycleParticipants: 0, duelCycles: 0, currentWeek: 0, latestCapture: '' }; }
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
