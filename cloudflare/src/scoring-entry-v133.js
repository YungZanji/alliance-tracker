import portal from './scoring-entry-v132.js';

const MAIN_STATE_RULER_SCORE_COMMAND = 'server.battle.user.score.rank';
const PRIMARY_ALLIANCE = 'WDZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/sync' || request.method !== 'POST') {
      return portal.fetch(request, env, ctx);
    }

    let body;
    try {
      body = await request.clone().json();
    } catch (_) {
      return portal.fetch(request, env, ctx);
    }

    // State Ruler exposes several player ranking feeds with different meanings and
    // score scales. Only the main user-score leaderboard is the event total used by
    // the participation model. Preserve the other feeds as diagnostic captures rather
    // than silently mixing battle/person scores with total State Ruler score.
    const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
    body.snapshots = snapshots.map(snapshot => {
      if (snapshot?.dataset !== 'state_ruler_rankings') return snapshot;
      if (String(snapshot.command || '') === MAIN_STATE_RULER_SCORE_COMMAND) return snapshot;
      return {
        ...snapshot,
        dataset: 'state_ruler_diagnostic_rankings',
        context: {
          ...(snapshot.context || {}),
          originalDataset: 'state_ruler_rankings',
          scoringEligible: false,
          diagnosticReason: 'Only server.battle.user.score.rank is used as the State Ruler total-score leaderboard.'
        }
      };
    });

    const headers = new Headers(request.headers);
    headers.delete('content-length');
    const forwarded = new Request(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const response = await portal.fetch(forwarded, env, ctx);
    if (!response.ok) return response;

    try {
      const result = await response.clone().json();
      const cycleId = String(result?.cycleId || '').trim();
      const cycleWeek = Number(result?.cycleWeek || 0);
      if (cycleId && cycleWeek >= 1 && cycleWeek <= 4) {
        await reconcileEnemyBuster(env, cycleId, cycleWeek);
      }
    } catch (error) {
      console.error('Post-sync Enemy Buster reconciliation failed', error);
    }
    return response;
  }
};

async function reconcileEnemyBuster(env, cycleId, cycleWeek) {
  const rowsResult = await env.DB.prepare(`
    SELECT
      w.cycle_id,w.cycle_week,w.week_id,w.week_start_time,w.uid,w.name_at_capture,
      w.score AS weekly_score,w.captured_at,w.alliance_id,w.alliance_abbr,w.alliance_name,
      w.server_id,w.country,w.source_hash,
      COUNT(DISTINCT d.day_index) AS completed_days,
      COALESCE(SUM(d.score),0) AS completed_total,
      d6.score AS existing_d6,d6.captured_at AS existing_d6_at
    FROM duel_weekly w
    JOIN duel_daily d
      ON d.cycle_id=w.cycle_id AND d.cycle_week=w.cycle_week AND d.uid=w.uid
     AND d.day_index BETWEEN 1 AND 5
    LEFT JOIN duel_daily d6
      ON d6.cycle_id=w.cycle_id AND d6.cycle_week=w.cycle_week AND d6.uid=w.uid AND d6.day_index=6
    WHERE w.cycle_id=? AND w.cycle_week=?
    GROUP BY
      w.cycle_id,w.cycle_week,w.week_id,w.week_start_time,w.uid,w.name_at_capture,w.score,
      w.captured_at,w.alliance_id,w.alliance_abbr,w.alliance_name,w.server_id,w.country,w.source_hash,
      d6.score,d6.captured_at
    HAVING COUNT(DISTINCT d.day_index)=5
  `).bind(cycleId, cycleWeek).all();

  const statements = [];
  const now = new Date().toISOString();
  for (const row of rowsResult.results || []) {
    const weekly = Number(row.weekly_score || 0);
    const firstFive = Number(row.completed_total || 0);
    const score = Math.max(0, weekly - firstFive);
    const oldScore = row.existing_d6 == null ? null : Number(row.existing_d6 || 0);
    const sourceHash = `weekly-delta:${String(row.source_hash || '')}`;

    statements.push(env.DB.prepare(`
      INSERT INTO duel_daily(
        cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,
        score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,
        server_id,country,source_hash
      ) VALUES(?,?,?,?,6,?,?,?,'weekly_final_delta',30,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week,day_index,uid) DO UPDATE SET
        week_id=excluded.week_id,
        week_start_time=excluded.week_start_time,
        name_at_capture=excluded.name_at_capture,
        score=excluded.score,
        score_source=excluded.score_source,
        source_priority=excluded.source_priority,
        captured_at=excluded.captured_at,
        alliance_id=excluded.alliance_id,
        alliance_abbr=excluded.alliance_abbr,
        alliance_name=excluded.alliance_name,
        server_id=excluded.server_id,
        country=excluded.country,
        source_hash=excluded.source_hash
      WHERE excluded.captured_at >= duel_daily.captured_at
         OR duel_daily.score_source IN ('weekly_delta','weekly_final_delta')
    `).bind(
      String(row.cycle_id),Number(row.cycle_week),String(row.week_id),Number(row.week_start_time),
      String(row.uid),String(row.name_at_capture || ''),score,String(row.captured_at || now),
      String(row.alliance_id || ''),String(row.alliance_abbr || PRIMARY_ALLIANCE),String(row.alliance_name || ''),
      Number(row.server_id || 0),String(row.country || ''),sourceHash
    ));

    if (oldScore !== null && oldScore !== score) {
      const changeId = await sha256(`enemy-buster|${cycleId}|${cycleWeek}|${row.uid}|${oldScore}|${score}|${row.captured_at}`);
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO score_history(
          change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
          old_score,new_score,delta,captured_at,score_source,source_hash
        ) VALUES(?,?,?,?,?,?,6,?,?,?,?,?,?,?,?)
      `).bind(
        changeId,'daily',`${cycleId}|${cycleWeek}|6|${row.uid}`,cycleId,cycleWeek,String(row.week_id),
        String(row.uid),String(row.name_at_capture || ''),oldScore,score,score-oldScore,
        String(row.captured_at || now),'weekly_final_delta',sourceHash
      ));
    }
  }

  await runBatches(env.DB, statements, 60);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}
