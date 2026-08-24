import portal from './scoring-entry-v151.js';

const PRIMARY_ALLIANCE = 'WDZ';
const DAY_NAMES = ['Tank Day', 'Build Day', 'Science Day', 'Hero Day', 'Training Day', 'Enemy Buster'];
const HISTORY_LIMIT = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleSync(request, env, ctx);
    }

    if (url.pathname === '/api/duel' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return normalizeAuthoritativeDuel(response, env);
    }

    if (url.pathname === '/api/admin/duel-history-checkpoints' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return listHistoryCheckpoints(url, env);
    }

    if (url.pathname === '/api/admin/duel-history-checkpoints/preview' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return previewHistoryCheckpoint(request, env);
    }

    if (url.pathname === '/api/admin/duel-history-checkpoints/restore' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return restoreHistoryCheckpoint(request, env, ctx);
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handleSync(request, env, ctx) {
  let original;
  try {
    original = await request.clone().json();
  } catch (_) {
    return portal.fetch(request, env, ctx);
  }

  const snapshots = Array.isArray(original?.snapshots) ? original.snapshots : [];
  if (!snapshots.some(isDuelSnapshot)) return portal.fetch(request, env, ctx);

  // The game's alliance_duel_results payload is not tied reliably to the current
  // matchup. In live Week 2 / Week 3 captures it carried opponent scores for
  // unrelated alliances. Preserve it only as diagnostic capture evidence.
  const forwardedBody = {
    ...original,
    snapshots: snapshots.map(snapshot => {
      if (String(snapshot?.dataset || '') !== 'alliance_duel_results') return snapshot;
      return {
        ...snapshot,
        dataset: 'alliance_duel_results_diagnostic',
        context: {
          ...(snapshot.context || {}),
          originalDataset: 'alliance_duel_results',
          scoringEligible: false,
          diagnosticReason: 'Opponent result rows are not reliable for the selected weekly matchup; rankings are authoritative.'
        }
      };
    })
  };

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(forwardedBody)
  });

  const response = await portal.fetch(forwarded, env, ctx);
  if (!response.ok) return response;

  let result = null;
  try { result = await response.clone().json(); } catch (_) {}
  if (!result) return response;

  let reconciliation = null;
  try {
    reconciliation = await reconcileOutcomesFromRankings(snapshots, result, env);
    const cycleId = String(result?.cycleId || reconciliation?.cycleId || '');
    const cycleWeek = Number(result?.cycleWeek || reconciliation?.cycleWeek || 0);
    if (cycleId && cycleWeek >= 1 && cycleWeek <= 4) {
      await refreshWeekMembership(snapshots, cycleId, cycleWeek, env);
    }
  } catch (error) {
    console.error('Alliance Duel ranking reconciliation failed', error);
  }

  return json({
    ...result,
    duelOutcomeReconciliation: reconciliation || { correctedDays: [], source: 'none' }
  }, response.status);
}

function isDuelSnapshot(snapshot) {
  const dataset = String(snapshot?.dataset || '');
  return dataset === 'alliance_duel_rankings'
    || dataset === 'alliance_duel_results'
    || dataset === 'alliance_duel_season'
    || dataset === 'alliance_duel_league_totals';
}

async function reconcileOutcomesFromRankings(snapshots, syncResult, env) {
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const cycleId = String(syncResult?.cycleId || '').trim();
  const cycleWeek = Number(syncResult?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    return { cycleId, cycleWeek, correctedDays: [], source: 'rankings' };
  }

  const weekly = latestRanking(snapshots, 'weekly_combined', true);
  if (!weekly) return { cycleId, cycleWeek, correctedDays: [], source: 'rankings' };

  const weeklyGrouped = groupAllianceTotals(weekly);
  const opponent = chooseOpponent(weeklyGrouped, primary);
  if (!opponent) return { cycleId, cycleWeek, correctedDays: [], source: 'rankings' };

  const completed = latestRanking(snapshots, 'completed_days', false);
  const current = latestRanking(snapshots, 'current_day_combined', false);
  const corrected = [];
  const evidence = new Map();

  if (completed && !rankingAllZero(completed)) {
    const byDay = groupCompletedDayTotals(completed);
    for (const [dayIndex, totals] of byDay.entries()) {
      const allianceScore = Number(totals.get(primary) || 0);
      const opponentScore = Number(totals.get(opponent.abbr) || 0);
      if (!totals.has(primary) || !totals.has(opponent.abbr)) continue;
      evidence.set(dayIndex, {
        dayIndex,
        allianceScore,
        opponentScore,
        capturedAt: capturedAt(completed),
        sourceHash: `rankings-completed:${sourceHash(completed)}:d${dayIndex}`,
        source: 'completed_days_rankings'
      });
    }
  }

  if (current && !rankingAllZero(current)) {
    const totals = groupAllianceTotals(current);
    if (totals.has(primary) && totals.has(opponent.abbr)) {
      let dayIndex = 0;
      if (evidence.size) dayIndex = Math.min(6, Math.max(...evidence.keys()) + 1);
      if (!dayIndex) dayIndex = await inferCurrentDayIndex(cycleId, cycleWeek, capturedAt(current), env);
      if (dayIndex >= 1 && dayIndex <= 6) {
        evidence.set(dayIndex, {
          dayIndex,
          allianceScore: Number(totals.get(primary)?.score || 0),
          opponentScore: Number(totals.get(opponent.abbr)?.score || 0),
          capturedAt: capturedAt(current),
          sourceHash: `rankings-current:${sourceHash(current)}:d${dayIndex}`,
          source: 'current_day_rankings'
        });
      }
    }
  }

  // On Sunday the game resets completed/current-day rankings to zero, while the
  // current-week leaderboard remains correct. Days 1-5 are already preserved
  // from rankings; derive only the final Enemy Buster delta for both alliances.
  if ((!completed || rankingAllZero(completed)) && (!current || rankingAllZero(current))) {
    const firstFive = await env.DB.prepare(`
      SELECT day_index,alliance_score,opponent_score,outcome_source
      FROM duel_results
      WHERE cycle_id=? AND cycle_week=? AND day_index BETWEEN 1 AND 5
      ORDER BY day_index
    `).bind(cycleId, cycleWeek).all();

    const rows = firstFive.results || [];
    if (rows.length === 5 && rows.every(row => row.alliance_score != null && row.opponent_score != null)) {
      const ownFirstFive = rows.reduce((sum, row) => sum + Number(row.alliance_score || 0), 0);
      const oppFirstFive = rows.reduce((sum, row) => sum + Number(row.opponent_score || 0), 0);
      const ownWeekly = Number(weeklyGrouped.get(primary)?.score || 0);
      const oppWeekly = Number(weeklyGrouped.get(opponent.abbr)?.score || 0);
      if (ownWeekly >= ownFirstFive && oppWeekly >= oppFirstFive) {
        evidence.set(6, {
          dayIndex: 6,
          allianceScore: ownWeekly - ownFirstFive,
          opponentScore: oppWeekly - oppFirstFive,
          capturedAt: capturedAt(weekly),
          sourceHash: `rankings-weekly-delta:${sourceHash(weekly)}:d6`,
          source: 'weekly_final_delta_rankings'
        });
      }
    }
  }

  for (const row of [...evidence.values()].sort((a, b) => a.dayIndex - b.dayIndex)) {
    if (row.allianceScore === row.opponentScore) continue;
    const isWin = row.allianceScore > row.opponentScore ? 1 : 0;
    await upsertOutcome(env, {
      cycleId,
      cycleWeek,
      dayIndex: row.dayIndex,
      allianceScore: row.allianceScore,
      opponentScore: row.opponentScore,
      isWin,
      opponentAbbr: opponent.abbr,
      outcomeSource: row.source,
      capturedAt: row.capturedAt,
      sourceHash: row.sourceHash
    });
    corrected.push({
      dayIndex: row.dayIndex,
      isWin: isWin === 1,
      allianceScore: row.allianceScore,
      opponentScore: row.opponentScore
    });
  }

  return {
    cycleId,
    cycleWeek,
    opponentAbbr: opponent.abbr,
    correctedDays: corrected,
    source: 'alliance_duel_rankings'
  };
}

async function upsertOutcome(env, row) {
  const meta = await env.DB.prepare(`
    SELECT week_id,week_start_time
    FROM duel_weekly
    WHERE cycle_id=? AND cycle_week=?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(row.cycleId, row.cycleWeek).first();

  await env.DB.prepare(`
    INSERT INTO duel_results(
      cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,
      alliance_score,opponent_score,is_win,mvp_uid,mvp_name,mvp_score,captured_at,source_hash,
      opponent_abbr,outcome_source
    ) VALUES(?,?,?,?,?,?,?,?,?,'','',0,?,?,?,?)
    ON CONFLICT(cycle_id,cycle_week,day_index) DO UPDATE SET
      week_id=excluded.week_id,
      week_start_time=excluded.week_start_time,
      event_name=excluded.event_name,
      alliance_score=excluded.alliance_score,
      opponent_score=excluded.opponent_score,
      is_win=excluded.is_win,
      mvp_uid='',
      mvp_name='',
      mvp_score=0,
      captured_at=excluded.captured_at,
      source_hash=excluded.source_hash,
      opponent_abbr=excluded.opponent_abbr,
      outcome_source=excluded.outcome_source
  `).bind(
    row.cycleId,
    row.cycleWeek,
    String(meta?.week_id || ''),
    Number(meta?.week_start_time || 0),
    row.dayIndex,
    DAY_NAMES[row.dayIndex - 1] || `Day ${row.dayIndex}`,
    row.allianceScore,
    row.opponentScore,
    row.isWin,
    row.capturedAt,
    row.sourceHash,
    row.opponentAbbr,
    row.outcomeSource
  ).run();
}

async function refreshWeekMembership(snapshots, cycleId, cycleWeek, env) {
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const weekly = latestRanking(snapshots, 'weekly_combined', true);
  if (!weekly) return;
  const rows = (Array.isArray(weekly.rows) ? weekly.rows : [])
    .filter(row => String(row?.allianceAbbr || '') === primary && String(row?.uid || '').trim());
  if (!rows.length) return;

  const at = capturedAt(weekly);
  const statements = [
    env.DB.prepare('DELETE FROM duel_week_membership WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek)
  ];
  for (const row of rows) {
    statements.push(env.DB.prepare(`
      INSERT INTO duel_week_membership(cycle_id,cycle_week,uid,captured_at,source_hash)
      VALUES(?,?,?,?,?)
    `).bind(cycleId, cycleWeek, String(row.uid), at, sourceHash(weekly)));
  }
  await runBatches(env.DB, statements, 70);
}

async function normalizeAuthoritativeDuel(response, env) {
  try {
    const body = await response.json();
    const cycleId = String(body?.cycleId || '').trim();
    const cycleWeek = Number(body?.cycleWeek || 0);
    if (!cycleId || cycleWeek < 1 || cycleWeek > 4 || !Array.isArray(body?.players)) {
      return json(body, response.status);
    }

    const membership = await env.DB.prepare(`
      SELECT p.public_id,m.uid,m.captured_at
      FROM duel_week_membership m
      JOIN players p ON p.uid=m.uid
      WHERE m.cycle_id=? AND m.cycle_week=?
    `).bind(cycleId, cycleWeek).all();

    let allowed = new Set((membership.results || []).map(row => String(row.public_id || '')).filter(Boolean));

    // Backward-compatible fallback if the membership migration has not seen a
    // fresh sync for this week yet: the latest full weekly_combined capture is
    // authoritative, while older per-player rows are historical residue.
    if (!allowed.size) {
      const latest = await env.DB.prepare(`
        SELECT MAX(captured_at) AS captured_at
        FROM duel_weekly
        WHERE cycle_id=? AND cycle_week=? AND score_source='weekly_combined'
      `).bind(cycleId, cycleWeek).first();
      if (latest?.captured_at) {
        const rows = await env.DB.prepare(`
          SELECT p.public_id
          FROM duel_weekly w JOIN players p ON p.uid=w.uid
          WHERE w.cycle_id=? AND w.cycle_week=?
            AND w.score_source='weekly_combined'
            AND w.captured_at=?
        `).bind(cycleId, cycleWeek, String(latest.captured_at)).all();
        allowed = new Set((rows.results || []).map(row => String(row.public_id || '')).filter(Boolean));
      }
    }

    if (allowed.size) body.players = body.players.filter(row => allowed.has(String(row.publicId || '')));

    body.players.forEach(row => {
      row.dailySum = (Array.isArray(row.dayScores) ? row.dayScores : []).reduce((sum, value) => sum + Number(value || 0), 0);
      row.adjustment = Number(row.weeklyScore || 0) - row.dailySum;
    });
    body.players.sort((a, b) => Number(b.weeklyScore || 0) - Number(a.weeklyScore || 0) || String(a.name || '').localeCompare(String(b.name || '')));
    body.players.forEach((row, index) => { row.rank = index + 1; });

    const calculated = Array.from({ length: 6 }, (_, index) =>
      body.players.reduce((sum, row) => sum + Number(row.dayScores?.[index] || 0), 0)
    );
    body.days = (body.days || []).map((day, index) => ({
      ...day,
      calculatedTotal: calculated[index] || 0
    }));

    const weeklyTotal = body.players.reduce((sum, row) => sum + Number(row.weeklyScore || 0), 0);
    const dailyTotal = calculated.reduce((sum, value) => sum + value, 0);
    const duelLeagueTotal = body.players.reduce((sum, row) => sum + Number(row.duelLeagueTotal || 0), 0);
    const latestCapture = body.players.reduce((latest, row) => String(row.latestCapture || '') > latest ? String(row.latestCapture || '') : latest, '');

    body.summary = {
      ...(body.summary || {}),
      players: body.players.length,
      weeklyTotal,
      dailyTotal,
      duelLeagueTotal,
      latestCapture: latestCapture || body.summary?.latestCapture || ''
    };
    body.authoritativeRoster = {
      source: 'latest_weekly_combined',
      players: body.players.length
    };

    return json(body, response.status);
  } catch (error) {
    console.error('Could not normalize authoritative Duel response', error);
    return response;
  }
}

async function listHistoryCheckpoints(url, env) {
  let cycleId = String(url.searchParams.get('cycle') || '').trim();
  let cycleWeek = Number(url.searchParams.get('week') || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    const latest = await latestWeek(env);
    cycleId = cycleId || latest.cycleId;
    cycleWeek = cycleWeek >= 1 && cycleWeek <= 4 ? cycleWeek : latest.cycleWeek;
  }
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return json({ ok: true, cycleId: '', cycleWeek: 0, checkpoints: [] });

  const result = await env.DB.prepare(`
    SELECT
      COALESCE(NULLIF(session_id,''),source_hash) AS checkpoint_id,
      MIN(captured_at) AS first_capture,
      MAX(captured_at) AS captured_at,
      MAX(received_at) AS received_at,
      COUNT(*) AS snapshot_count,
      GROUP_CONCAT(DISTINCT dataset) AS datasets
    FROM captures
    WHERE cycle_id=? AND cycle_week=?
    GROUP BY COALESCE(NULLIF(session_id,''),source_hash)
    ORDER BY julianday(captured_at) DESC
    LIMIT ?
  `).bind(cycleId, cycleWeek, HISTORY_LIMIT).all();

  return json({
    ok: true,
    cycleId,
    cycleWeek,
    checkpoints: (result.results || []).map(row => ({
      checkpointId: String(row.checkpoint_id || ''),
      capturedAt: String(row.captured_at || ''),
      receivedAt: String(row.received_at || ''),
      snapshotCount: Number(row.snapshot_count || 0),
      datasets: String(row.datasets || '').split(',').filter(Boolean)
    }))
  });
}

async function previewHistoryCheckpoint(request, env) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim();
  const cycleWeek = Number(body?.cycleWeek || 0);
  const capturedAtValue = String(body?.capturedAt || '').trim();
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4 || !validDate(capturedAtValue)) {
    return json({ ok: false, error: 'Choose a valid historical Duel checkpoint.' }, 400);
  }
  const state = await buildScoreStateAt(env, cycleId, cycleWeek, capturedAtValue);
  return json({ ok: true, checkpoint: summarizeHistoricalState(state, capturedAtValue) });
}

async function restoreHistoryCheckpoint(request, env, ctx) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim();
  const cycleWeek = Number(body?.cycleWeek || 0);
  const capturedAtValue = String(body?.capturedAt || '').trim();
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4 || !validDate(capturedAtValue)) {
    return json({ ok: false, error: 'Choose a valid historical Duel checkpoint.' }, 400);
  }

  const before = await createSafetyRestorePoint(request, env, ctx, cycleId, cycleWeek);
  const state = await buildScoreStateAt(env, cycleId, cycleWeek, capturedAtValue);
  const current = await loadCurrentScores(env, cycleId, cycleWeek);
  const now = new Date().toISOString();
  const statements = [];
  let changedRows = 0;

  const dailyByKey = new Map(state.daily.map(row => [dailyKey(row), row]));
  for (const row of current.daily) {
    const target = dailyByKey.get(dailyKey(row));
    if (!target || Number(target.score || 0) === Number(row.score || 0)) continue;
    changedRows += 1;
    statements.push(env.DB.prepare(`
      INSERT INTO score_history(
        change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
        old_score,new_score,delta,captured_at,score_source,source_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      crypto.randomUUID(),'daily',dailyKey(row),cycleId,cycleWeek,String(row.week_id || ''),Number(row.day_index || 0),
      String(row.uid),String(row.name_at_capture || ''),Number(row.score || 0),Number(target.score || 0),
      Number(target.score || 0)-Number(row.score || 0),now,'history_checkpoint_restore',`checkpoint:${capturedAtValue}`
    ));
    statements.push(env.DB.prepare(`
      UPDATE duel_daily
      SET score=?,score_source='history_checkpoint_restore',source_priority=40,source_hash=?
      WHERE cycle_id=? AND cycle_week=? AND day_index=? AND uid=?
    `).bind(Number(target.score || 0),`checkpoint:${capturedAtValue}`,cycleId,cycleWeek,Number(row.day_index || 0),String(row.uid)));
  }

  const weeklyByKey = new Map(state.weekly.map(row => [String(row.uid), row]));
  for (const row of current.weekly) {
    const target = weeklyByKey.get(String(row.uid));
    if (!target || Number(target.score || 0) === Number(row.score || 0)) continue;
    changedRows += 1;
    statements.push(env.DB.prepare(`
      INSERT INTO score_history(
        change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
        old_score,new_score,delta,captured_at,score_source,source_hash
      ) VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)
    `).bind(
      crypto.randomUUID(),'weekly',weeklyKey(row),cycleId,cycleWeek,String(row.week_id || ''),
      String(row.uid),String(row.name_at_capture || ''),Number(row.score || 0),Number(target.score || 0),
      Number(target.score || 0)-Number(row.score || 0),now,'history_checkpoint_restore',`checkpoint:${capturedAtValue}`
    ));
    statements.push(env.DB.prepare(`
      UPDATE duel_weekly
      SET score=?,score_source='history_checkpoint_restore',source_priority=40,source_hash=?
      WHERE cycle_id=? AND cycle_week=? AND uid=?
    `).bind(Number(target.score || 0),`checkpoint:${capturedAtValue}`,cycleId,cycleWeek,String(row.uid)));
  }

  await runBatches(env.DB, statements, 60);

  await env.DB.prepare(`
    UPDATE duel_weekly AS w
    SET position=1+(
      SELECT COUNT(*) FROM duel_weekly other
      JOIN duel_week_membership m2
        ON m2.cycle_id=other.cycle_id AND m2.cycle_week=other.cycle_week AND m2.uid=other.uid
      WHERE other.cycle_id=w.cycle_id AND other.cycle_week=w.cycle_week AND other.score>w.score
    )
    WHERE w.cycle_id=? AND w.cycle_week=?
      AND EXISTS(
        SELECT 1 FROM duel_week_membership m
        WHERE m.cycle_id=w.cycle_id AND m.cycle_week=w.cycle_week AND m.uid=w.uid
      )
  `).bind(cycleId, cycleWeek).run();

  const after = await createSafetyRestorePoint(request, env, ctx, cycleId, cycleWeek);
  return json({
    ok: true,
    cycleId,
    cycleWeek,
    capturedAt: capturedAtValue,
    changedRows,
    safetyRestoreId: String(before?.restorePoint?.restoreId || ''),
    restoreId: String(after?.restorePoint?.restoreId || ''),
    summary: after?.restorePoint?.summary || summarizeHistoricalState(state, capturedAtValue).summary
  });
}

async function buildScoreStateAt(env, cycleId, cycleWeek, targetAt) {
  const current = await loadCurrentScores(env, cycleId, cycleWeek);
  const daily = current.daily.map(row => ({ ...row }));
  const weekly = current.weekly.map(row => ({ ...row }));
  const dailyMap = new Map(daily.map(row => [dailyKey(row), row]));
  const weeklyMap = new Map(weekly.map(row => [weeklyKey(row), row]));

  const history = await env.DB.prepare(`
    SELECT metric_type,day_index,uid,old_score,new_score,captured_at
    FROM score_history
    WHERE cycle_id=? AND cycle_week=? AND julianday(captured_at)>julianday(?)
    ORDER BY julianday(captured_at) DESC,rowid DESC
  `).bind(cycleId, cycleWeek, targetAt).all();

  for (const change of history.results || []) {
    if (String(change.metric_type) === 'daily') {
      const key = `${cycleId}|${cycleWeek}|${Number(change.day_index || 0)}|${String(change.uid)}`;
      const row = dailyMap.get(key);
      if (row) row.score = Number(change.old_score || 0);
    } else if (String(change.metric_type) === 'weekly') {
      const key = `${cycleId}|${cycleWeek}|${String(change.uid)}`;
      const row = weeklyMap.get(key);
      if (row) row.score = Number(change.old_score || 0);
    }
  }

  return { cycleId, cycleWeek, daily, weekly };
}

async function loadCurrentScores(env, cycleId, cycleWeek) {
  const [dailyResult, weeklyResult, membershipResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM duel_daily WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek).all(),
    env.DB.prepare('SELECT * FROM duel_weekly WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek).all(),
    env.DB.prepare('SELECT uid FROM duel_week_membership WHERE cycle_id=? AND cycle_week=?').bind(cycleId, cycleWeek).all()
  ]);
  const allowed = new Set((membershipResult.results || []).map(row => String(row.uid || '')));
  const filter = rows => allowed.size ? rows.filter(row => allowed.has(String(row.uid || ''))) : rows;
  return {
    daily: filter(dailyResult.results || []),
    weekly: filter(weeklyResult.results || [])
  };
}

function summarizeHistoricalState(state, targetAt) {
  const dailyTotals = Array.from({ length: 6 }, (_, index) =>
    state.daily.filter(row => Number(row.day_index || 0) === index + 1).reduce((sum, row) => sum + Number(row.score || 0), 0)
  );
  const weeklyTotal = state.weekly.reduce((sum, row) => sum + Number(row.score || 0), 0);
  const dailyTotal = dailyTotals.reduce((sum, value) => sum + value, 0);
  const leaders = [...state.weekly]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 8)
    .map((row, index) => ({
      rank: index + 1,
      uid: String(row.uid || ''),
      name: String(row.name_at_capture || ''),
      score: Number(row.score || 0)
    }));
  return {
    cycleId: state.cycleId,
    cycleWeek: state.cycleWeek,
    capturedAt: targetAt,
    summary: {
      weeklyTotal,
      dailyTotal,
      dailyTotals,
      players: state.weekly.length
    },
    leaders
  };
}

async function latestWeek(env) {
  const row = await env.DB.prepare(`
    SELECT cycle_id,cycle_week,MAX(captured_at) AS captured_at
    FROM duel_weekly
    GROUP BY cycle_id,cycle_week
    ORDER BY julianday(captured_at) DESC
    LIMIT 1
  `).first();
  return {
    cycleId: String(row?.cycle_id || ''),
    cycleWeek: Number(row?.cycle_week || 0)
  };
}

async function inferCurrentDayIndex(cycleId, cycleWeek, captureAt, env) {
  const row = await env.DB.prepare(`
    SELECT week_start_time FROM duel_weekly
    WHERE cycle_id=? AND cycle_week=?
    ORDER BY captured_at DESC LIMIT 1
  `).bind(cycleId, cycleWeek).first();
  const start = Number(row?.week_start_time || 0);
  const at = Date.parse(captureAt);
  if (!start || !Number.isFinite(at)) return 0;
  return Math.max(1, Math.min(6, Math.floor((at - start) / 86_400_000) + 1));
}

function latestRanking(snapshots, label, requireNonempty) {
  const matches = (Array.isArray(snapshots) ? snapshots : [])
    .filter(snapshot =>
      String(snapshot?.dataset || '') === 'alliance_duel_rankings'
      && String(snapshot?.context?.rankTypeLabel || '') === label
      && (!requireNonempty || (Array.isArray(snapshot?.rows) && snapshot.rows.length))
    )
    .sort((a, b) => capturedAt(b).localeCompare(capturedAt(a)));
  return matches[0] || null;
}

function groupAllianceTotals(snapshot) {
  const grouped = new Map();
  for (const row of Array.isArray(snapshot?.rows) ? snapshot.rows : []) {
    const abbr = String(row?.allianceAbbr || '').trim();
    if (!abbr) continue;
    const current = grouped.get(abbr) || { abbr, score: 0, rows: 0 };
    current.score += Number(row?.score || 0);
    current.rows += 1;
    grouped.set(abbr, current);
  }
  return grouped;
}

function groupCompletedDayTotals(snapshot) {
  const byDay = new Map();
  for (const row of Array.isArray(snapshot?.rows) ? snapshot.rows : []) {
    const dayIndex = Number(row?.dayIndex || 0);
    const abbr = String(row?.allianceAbbr || '').trim();
    if (dayIndex < 1 || dayIndex > 6 || !abbr) continue;
    if (!byDay.has(dayIndex)) byDay.set(dayIndex, new Map());
    const totals = byDay.get(dayIndex);
    totals.set(abbr, Number(totals.get(abbr) || 0) + Number(row?.score || 0));
  }
  return byDay;
}

function chooseOpponent(grouped, primary) {
  const candidates = [...grouped.values()].filter(row => row.abbr !== primary);
  candidates.sort((a, b) => b.rows - a.rows || b.score - a.score || a.abbr.localeCompare(b.abbr));
  return candidates[0] || null;
}

function rankingAllZero(snapshot) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  return rows.length > 0 && rows.every(row => Number(row?.score || 0) === 0);
}

function capturedAt(snapshot) {
  return String(snapshot?.captured_at || snapshot?.capturedAt || '');
}

function sourceHash(snapshot) {
  return String(snapshot?.source_hash || snapshot?.sourceHash || '');
}

async function createSafetyRestorePoint(request, env, ctx, cycleId, cycleWeek) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/duel-restore-points';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ cycleId, cycleWeek })
  }), env, ctx);
  if (!response.ok) return null;
  try { return await response.json(); } catch (_) { return null; }
}

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

function dailyKey(row) {
  return `${String(row.cycle_id || '')}|${Number(row.cycle_week || 0)}|${Number(row.day_index || 0)}|${String(row.uid || '')}`;
}

function weeklyKey(row) {
  return `${String(row.cycle_id || '')}|${Number(row.cycle_week || 0)}|${String(row.uid || '')}`;
}

function validDate(value) {
  return Number.isFinite(Date.parse(String(value || '')));
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
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
