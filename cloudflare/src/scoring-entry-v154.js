import portal from './scoring-entry-v153.js';

const PRIMARY_ALLIANCE = 'WDZ';
const DAY_MS = 86_400_000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleSync(request, env, ctx);
    }
    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handleSync(request, env, ctx) {
  let incoming = null;
  try { incoming = await request.clone().json(); } catch (_) {}

  const response = await portal.fetch(request, env, ctx);
  if (!response.ok || !incoming) return response;

  let body = null;
  try { body = await response.clone().json(); } catch (_) {}
  const cycleId = String(body?.cycleId || '').trim();
  const cycleWeek = Number(body?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return response;

  let rollover = null;
  try {
    rollover = await recoverMissedSunday(incoming.snapshots || [], cycleId, cycleWeek, env);
  } catch (error) {
    console.error('Missed Sunday Duel recovery failed', error);
    rollover = { eligible: false, recovered: false, reason: String(error?.message || error) };
  }

  return json({
    ...body,
    duelRolloverRecovery: rollover
  }, response.status);
}

async function recoverMissedSunday(snapshots, cycleId, cycleWeek, env) {
  if (cycleWeek <= 1) {
    return { eligible: false, recovered: false, reason: 'No previous week exists inside this Duel League.' };
  }

  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const league = latestRanking(snapshots, 'weekly_own_alliance');
  const weekly = latestRanking(snapshots, 'weekly_combined');
  const currentDay = latestRanking(snapshots, 'current_day_combined');
  if (!league || !weekly || !currentDay) {
    return {
      eligible: false,
      recovered: false,
      reason: 'Rollover recovery needs Duel League total, current-week total, and current-day rankings from the same sync.'
    };
  }

  const leagueRows = scoreMap(league, primary);
  const weeklyRows = scoreMap(weekly, primary);
  const currentRows = scoreMap(currentDay, primary);
  if (!leagueRows.size || !weeklyRows.size || !currentRows.size) {
    return { eligible: false, recovered: false, reason: 'The rollover rankings did not contain the primary alliance.' };
  }

  const currentMeta = await env.DB.prepare(`
    SELECT week_start_time
    FROM duel_weekly
    WHERE cycle_id=? AND cycle_week=?
    ORDER BY captured_at DESC
    LIMIT 1
  `).bind(cycleId, cycleWeek).first();

  const weekStart = Number(currentMeta?.week_start_time || 0);
  const leagueAt = Date.parse(capturedAt(league));
  if (!weekStart || !Number.isFinite(leagueAt) || leagueAt < weekStart || leagueAt >= weekStart + DAY_MS) {
    return {
      eligible: false,
      recovered: false,
      reason: 'Previous-week rollover recovery only runs during the first Duel day after weekly reset.'
    };
  }

  const previousWeek = cycleWeek - 1;
  const [earlierResult, previousResult, dailyResult, lastSync] = await Promise.all([
    env.DB.prepare(`
      SELECT cycle_week,uid,score
      FROM duel_weekly
      WHERE cycle_id=? AND cycle_week<?
    `).bind(cycleId, previousWeek).all(),
    env.DB.prepare(`
      SELECT *
      FROM duel_weekly
      WHERE cycle_id=? AND cycle_week=?
    `).bind(cycleId, previousWeek).all(),
    env.DB.prepare(`
      SELECT *
      FROM duel_daily
      WHERE cycle_id=? AND cycle_week=? AND day_index BETWEEN 1 AND 6
    `).bind(cycleId, previousWeek).all(),
    env.DB.prepare(`
      SELECT MAX(captured_at) AS captured_at
      FROM captures
      WHERE cycle_id=? AND cycle_week=?
    `).bind(cycleId, previousWeek).first()
  ]);

  const earlierByUid = new Map();
  for (const row of earlierResult.results || []) {
    const uid = String(row.uid || '');
    earlierByUid.set(uid, Number(earlierByUid.get(uid) || 0) + Number(row.score || 0));
  }
  const previousByUid = new Map((previousResult.results || []).map(row => [String(row.uid), row]));
  const daysByUid = new Map();
  for (const row of dailyResult.results || []) {
    const uid = String(row.uid || '');
    if (!daysByUid.has(uid)) daysByUid.set(uid, new Map());
    daysByUid.get(uid).set(Number(row.day_index || 0), row);
  }

  const statements = [];
  const recoverable = [];
  const skipped = {
    unstableCurrentScore: 0,
    missingPreviousWeek: 0,
    incompleteDailyHistory: 0,
    wouldReduceStoredScore: 0,
    invalidDerivedScore: 0
  };

  for (const [uid, cumulative] of leagueRows.entries()) {
    if (!weeklyRows.has(uid) || !currentRows.has(uid) || weeklyRows.get(uid) !== currentRows.get(uid)) {
      skipped.unstableCurrentScore += 1;
      continue;
    }

    const previous = previousByUid.get(uid);
    if (!previous) {
      skipped.missingPreviousWeek += 1;
      continue;
    }

    const previousFinal = derivePreviousWeekScore(
      cumulative,
      weeklyRows.get(uid),
      Number(earlierByUid.get(uid) || 0)
    );
    if (previousFinal === null) {
      skipped.invalidDerivedScore += 1;
      continue;
    }

    const storedPrevious = Number(previous.score || 0);
    if (previousFinal < storedPrevious) {
      skipped.wouldReduceStoredScore += 1;
      continue;
    }

    const dayRows = daysByUid.get(uid) || new Map();
    const firstFiveComplete = [1, 2, 3, 4, 5].every(day => dayRows.has(day));
    if (!firstFiveComplete) {
      skipped.incompleteDailyHistory += 1;
      continue;
    }

    const firstFive = [1, 2, 3, 4, 5].reduce((sum, day) => sum + Number(dayRows.get(day)?.score || 0), 0);
    const finalDaySix = previousFinal - firstFive;
    const storedDaySix = Number(dayRows.get(6)?.score || 0);
    if (finalDaySix < 0 || finalDaySix < storedDaySix) {
      skipped.invalidDerivedScore += 1;
      continue;
    }

    recoverable.push({ uid, previousFinal, finalDaySix });

    if (previousFinal !== storedPrevious) {
      const sourceHashValue = `rollover:${sourceHash(league)}`;
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO score_history(
          change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
          old_score,new_score,delta,captured_at,score_source,source_hash
        ) VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(),
        'weekly',
        `${cycleId}|${previousWeek}|${uid}`,
        cycleId,
        previousWeek,
        String(previous.week_id || ''),
        uid,
        String(previous.name_at_capture || ''),
        storedPrevious,
        previousFinal,
        previousFinal - storedPrevious,
        capturedAt(league),
        'rollover_cumulative_recovery',
        sourceHashValue
      ));
      statements.push(env.DB.prepare(`
        UPDATE duel_weekly
        SET score=?,
            score_source='rollover_cumulative_recovery',
            source_priority=30,
            captured_at=?,
            source_hash=?
        WHERE cycle_id=? AND cycle_week=? AND uid=?
      `).bind(previousFinal, capturedAt(league), sourceHashValue, cycleId, previousWeek, uid));
    }

    if (finalDaySix !== storedDaySix) {
      const sourceHashValue = `rollover:${sourceHash(league)}:d6`;
      const existingDaySix = dayRows.get(6);
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO score_history(
          change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
          old_score,new_score,delta,captured_at,score_source,source_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(),
        'daily',
        `${cycleId}|${previousWeek}|6|${uid}`,
        cycleId,
        previousWeek,
        String(previous.week_id || ''),
        6,
        uid,
        String(previous.name_at_capture || ''),
        storedDaySix,
        finalDaySix,
        finalDaySix - storedDaySix,
        capturedAt(league),
        'rollover_cumulative_recovery',
        sourceHashValue
      ));

      if (existingDaySix) {
        statements.push(env.DB.prepare(`
          UPDATE duel_daily
          SET score=?,
              score_source='rollover_cumulative_recovery',
              source_priority=30,
              captured_at=?,
              source_hash=?
          WHERE cycle_id=? AND cycle_week=? AND day_index=6 AND uid=?
        `).bind(finalDaySix, capturedAt(league), sourceHashValue, cycleId, previousWeek, uid));
      } else {
        statements.push(env.DB.prepare(`
          INSERT INTO duel_daily(
            cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,
            score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,
            server_id,country,source_hash
          ) VALUES(?,?,?,?,6,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          cycleId,
          previousWeek,
          String(previous.week_id || ''),
          Number(previous.week_start_time || 0),
          uid,
          String(previous.name_at_capture || ''),
          finalDaySix,
          'rollover_cumulative_recovery',
          30,
          capturedAt(league),
          previous.alliance_id,
          previous.alliance_abbr,
          previous.alliance_name,
          previous.server_id,
          previous.country,
          sourceHashValue
        ));
      }
    }
  }

  if (statements.length) await runBatches(env.DB, statements, 60);

  if (recoverable.length) {
    await env.DB.prepare(`
      UPDATE duel_weekly AS w
      SET position=1+(
        SELECT COUNT(*)
        FROM duel_weekly AS other
        WHERE other.cycle_id=w.cycle_id
          AND other.cycle_week=w.cycle_week
          AND other.score>w.score
      )
      WHERE w.cycle_id=? AND w.cycle_week=?
    `).bind(cycleId, previousWeek).run();
  }

  const exactCoverage = recoverable.length === leagueRows.size
    && Object.values(skipped).every(value => value === 0);
  if (exactCoverage) {
    const allianceDaySix = recoverable.reduce((sum, row) => sum + row.finalDaySix, 0);
    await env.DB.prepare(`
      UPDATE duel_results
      SET alliance_score=?,
          is_win=NULL,
          outcome_source='rollover_cumulative_recovery',
          captured_at=?,
          source_hash=?
      WHERE cycle_id=? AND cycle_week=? AND day_index=6 AND is_win IS NULL
    `).bind(
      allianceDaySix,
      capturedAt(league),
      `rollover:${sourceHash(league)}:alliance-d6`,
      cycleId,
      previousWeek
    ).run();
  }

  const cumulativeTotal = sumMap(leagueRows);
  const currentWeekTotal = sumMap(weeklyRows);
  const earlierWeeksTotal = (earlierResult.results || []).reduce((sum, row) => sum + Number(row.score || 0), 0);
  const derivedPreviousWeekTotal = recoverable.reduce((sum, row) => sum + row.previousFinal, 0);
  const weeklyChanges = recoverable.filter(row =>
    Number(previousByUid.get(row.uid)?.score || 0) !== row.previousFinal
  ).length;
  const daySixChanges = recoverable.filter(row =>
    Number(daysByUid.get(row.uid)?.get(6)?.score || 0) !== row.finalDaySix
  ).length;

  return {
    eligible: true,
    recovered: weeklyChanges > 0 || daySixChanges > 0,
    cycleId,
    previousWeek,
    currentWeek: cycleWeek,
    lastPreviousWeekSync: String(lastSync?.captured_at || ''),
    source: 'duel_league_total_minus_current_week',
    cumulativeLeagueTotal: cumulativeTotal,
    currentWeekTotal,
    earlierWeeksTotal,
    derivedPreviousWeekTotal,
    recoveredPlayers: recoverable.length,
    weeklyChanges,
    daySixChanges,
    skipped,
    exactCoverage
  };
}

export function derivePreviousWeekScore(cumulativeLeagueTotal, currentWeekScore, earlierWeekScore) {
  const cumulative = Number(cumulativeLeagueTotal);
  const current = Number(currentWeekScore);
  const earlier = Number(earlierWeekScore);
  if (![cumulative, current, earlier].every(Number.isFinite)) return null;
  const result = cumulative - current - earlier;
  return result >= 0 ? result : null;
}

function latestRanking(snapshots, label) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter(snapshot =>
      String(snapshot?.dataset || '') === 'alliance_duel_rankings'
      && String(snapshot?.context?.rankTypeLabel || '') === label
      && Array.isArray(snapshot?.rows)
      && snapshot.rows.length
    )
    .sort((a, b) => capturedAt(b).localeCompare(capturedAt(a)))[0] || null;
}

function scoreMap(snapshot, alliance) {
  const map = new Map();
  for (const row of Array.isArray(snapshot?.rows) ? snapshot.rows : []) {
    if (String(row?.allianceAbbr || '') !== alliance) continue;
    const uid = String(row?.uid || '').trim();
    if (!uid) continue;
    map.set(uid, Number(row?.score || 0));
  }
  return map;
}

function capturedAt(snapshot) {
  return String(snapshot?.captured_at || snapshot?.capturedAt || new Date().toISOString());
}

function sourceHash(snapshot) {
  return String(snapshot?.source_hash || snapshot?.sourceHash || '');
}

function sumMap(map) {
  let total = 0;
  for (const value of map.values()) total += Number(value || 0);
  return total;
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
