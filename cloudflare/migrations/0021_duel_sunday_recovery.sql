PRAGMA foreign_keys = ON;

-- Alliance Duel restore points keep the materialized leaderboard state separate
-- from the raw capture and score-history audit trail.
CREATE TABLE IF NOT EXISTS duel_restore_points (
  restore_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_session_id TEXT NOT NULL DEFAULT '',
  state_hash TEXT NOT NULL,
  daily_json TEXT NOT NULL DEFAULT '[]',
  weekly_json TEXT NOT NULL DEFAULT '[]',
  league_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_duel_restore_points_week
  ON duel_restore_points(cycle_id,cycle_week,created_at DESC);

CREATE TABLE IF NOT EXISTS duel_restore_log (
  action_id TEXT PRIMARY KEY,
  restore_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  restored_at TEXT NOT NULL,
  safety_restore_id TEXT NOT NULL DEFAULT '',
  restored_state_hash TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(restore_id) REFERENCES duel_restore_points(restore_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_duel_restore_log_time
  ON duel_restore_log(restored_at DESC);

-- Week 2 and Week 3 of the Aug 2 Duel League were hit by the game's Sunday
-- rollover response: completed-day rankings came back as zero after the event
-- closed. The sync audit already contains each overwritten non-zero value, so
-- restore only rows that are currently zero and have a matching non-zero value
-- immediately before that zero replacement.
INSERT OR IGNORE INTO score_history(
  change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
  old_score,new_score,delta,captured_at,score_source,source_hash
)
SELECT
  'sunday-recovery:'||d.cycle_id||':'||d.cycle_week||':'||d.day_index||':'||d.uid,
  'daily',
  d.cycle_id||'|'||d.cycle_week||'|'||d.day_index||'|'||d.uid,
  d.cycle_id,
  d.cycle_week,
  d.week_id,
  d.day_index,
  d.uid,
  d.name_at_capture,
  d.score,
  (
    SELECT h.old_score
    FROM score_history h
    WHERE h.metric_type='daily'
      AND h.cycle_id=d.cycle_id
      AND h.cycle_week=d.cycle_week
      AND h.day_index=d.day_index
      AND h.uid=d.uid
      AND h.new_score=0
      AND h.old_score>0
    ORDER BY h.captured_at DESC
    LIMIT 1
  ),
  (
    SELECT h.old_score
    FROM score_history h
    WHERE h.metric_type='daily'
      AND h.cycle_id=d.cycle_id
      AND h.cycle_week=d.cycle_week
      AND h.day_index=d.day_index
      AND h.uid=d.uid
      AND h.new_score=0
      AND h.old_score>0
    ORDER BY h.captured_at DESC
    LIMIT 1
  ) - d.score,
  datetime('now'),
  'history_recovery',
  'recovery:sunday-zero-reset'
FROM duel_daily d
WHERE d.cycle_id='2026-08-02'
  AND d.cycle_week IN (2,3)
  AND d.day_index BETWEEN 1 AND 5
  AND d.score=0
  AND EXISTS(
    SELECT 1
    FROM score_history h
    WHERE h.metric_type='daily'
      AND h.cycle_id=d.cycle_id
      AND h.cycle_week=d.cycle_week
      AND h.day_index=d.day_index
      AND h.uid=d.uid
      AND h.new_score=0
      AND h.old_score>0
  );

UPDATE duel_daily AS d
SET
  score=(
    SELECT h.old_score
    FROM score_history h
    WHERE h.metric_type='daily'
      AND h.cycle_id=d.cycle_id
      AND h.cycle_week=d.cycle_week
      AND h.day_index=d.day_index
      AND h.uid=d.uid
      AND h.new_score=0
      AND h.old_score>0
      AND h.score_source<>'history_recovery'
    ORDER BY h.captured_at DESC
    LIMIT 1
  ),
  score_source='history_recovery',
  source_priority=MAX(source_priority,25),
  source_hash='recovery:sunday-zero-reset'
WHERE d.cycle_id='2026-08-02'
  AND d.cycle_week IN (2,3)
  AND d.day_index BETWEEN 1 AND 5
  AND d.score=0
  AND EXISTS(
    SELECT 1
    FROM score_history h
    WHERE h.metric_type='daily'
      AND h.cycle_id=d.cycle_id
      AND h.cycle_week=d.cycle_week
      AND h.day_index=d.day_index
      AND h.uid=d.uid
      AND h.new_score=0
      AND h.old_score>0
      AND h.score_source<>'history_recovery'
  );

-- Once Days 1-5 are back, Enemy Buster is exactly the final current-week
-- leaderboard minus those five saved days. This uses weekly_combined, not the
-- cumulative four-week Duel League leaderboard.
INSERT OR IGNORE INTO score_history(
  change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
  old_score,new_score,delta,captured_at,score_source,source_hash
)
SELECT
  'sunday-d6-recovery:'||d6.cycle_id||':'||d6.cycle_week||':'||d6.uid,
  'daily',
  d6.cycle_id||'|'||d6.cycle_week||'|6|'||d6.uid,
  d6.cycle_id,
  d6.cycle_week,
  d6.week_id,
  6,
  d6.uid,
  d6.name_at_capture,
  d6.score,
  MAX(0,w.score-COALESCE((
    SELECT SUM(d.score)
    FROM duel_daily d
    WHERE d.cycle_id=d6.cycle_id
      AND d.cycle_week=d6.cycle_week
      AND d.uid=d6.uid
      AND d.day_index BETWEEN 1 AND 5
  ),0)),
  MAX(0,w.score-COALESCE((
    SELECT SUM(d.score)
    FROM duel_daily d
    WHERE d.cycle_id=d6.cycle_id
      AND d.cycle_week=d6.cycle_week
      AND d.uid=d6.uid
      AND d.day_index BETWEEN 1 AND 5
  ),0))-d6.score,
  datetime('now'),
  'weekly_final_delta_recovery',
  'recovery:weekly-final-delta:'||w.source_hash
FROM duel_daily d6
JOIN duel_weekly w
  ON w.cycle_id=d6.cycle_id
 AND w.cycle_week=d6.cycle_week
 AND w.uid=d6.uid
WHERE d6.cycle_id='2026-08-02'
  AND d6.cycle_week IN (2,3)
  AND d6.day_index=6
  AND d6.score<>MAX(0,w.score-COALESCE((
    SELECT SUM(d.score)
    FROM duel_daily d
    WHERE d.cycle_id=d6.cycle_id
      AND d.cycle_week=d6.cycle_week
      AND d.uid=d6.uid
      AND d.day_index BETWEEN 1 AND 5
  ),0));

UPDATE duel_daily AS d6
SET
  score=MAX(0,(
    SELECT w.score
    FROM duel_weekly w
    WHERE w.cycle_id=d6.cycle_id
      AND w.cycle_week=d6.cycle_week
      AND w.uid=d6.uid
  )-COALESCE((
    SELECT SUM(d.score)
    FROM duel_daily d
    WHERE d.cycle_id=d6.cycle_id
      AND d.cycle_week=d6.cycle_week
      AND d.uid=d6.uid
      AND d.day_index BETWEEN 1 AND 5
  ),0)),
  score_source='weekly_final_delta_recovery',
  source_priority=30,
  source_hash='recovery:weekly-final-delta:'||COALESCE((
    SELECT w.source_hash
    FROM duel_weekly w
    WHERE w.cycle_id=d6.cycle_id
      AND w.cycle_week=d6.cycle_week
      AND w.uid=d6.uid
  ),'')
WHERE d6.cycle_id='2026-08-02'
  AND d6.cycle_week IN (2,3)
  AND d6.day_index=6
  AND EXISTS(
    SELECT 1
    FROM duel_weekly w
    WHERE w.cycle_id=d6.cycle_id
      AND w.cycle_week=d6.cycle_week
      AND w.uid=d6.uid
  );
