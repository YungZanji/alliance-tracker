PRAGMA foreign_keys = ON;

-- The Sep 6 rollover capture landed just after the weekly reset. Rank type 2 is
-- the cumulative Duel League total and the new Week 2 score was still zero, so
-- the difference is the exact final Week 1 score for each player.
CREATE TEMP TABLE _rollover_week1_final (
  uid TEXT PRIMARY KEY,
  final_score INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL
);

INSERT INTO _rollover_week1_final(uid,final_score,captured_at,source_hash)
SELECT
  l.uid,
  l.score - COALESCE(current.score,0),
  l.captured_at,
  l.source_hash
FROM duel_league_total l
LEFT JOIN duel_weekly current
  ON current.cycle_id=l.cycle_id
 AND current.cycle_week=2
 AND current.uid=l.uid
JOIN duel_weekly previous
  ON previous.cycle_id=l.cycle_id
 AND previous.cycle_week=1
 AND previous.uid=l.uid
WHERE l.cycle_id='2026-08-30'
  AND l.cycle_week=2
  AND l.score >= COALESCE(current.score,0)
  AND (l.score - COALESCE(current.score,0)) >= previous.score;

INSERT OR IGNORE INTO score_history(
  change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
  old_score,new_score,delta,captured_at,score_source,source_hash
)
SELECT
  'rollover-2026-08-30-w1-weekly-' || previous.uid,
  'weekly',
  previous.cycle_id || '|' || previous.cycle_week || '|' || previous.uid,
  previous.cycle_id,
  previous.cycle_week,
  previous.week_id,
  NULL,
  previous.uid,
  previous.name_at_capture,
  previous.score,
  recovered.final_score,
  recovered.final_score - previous.score,
  recovered.captured_at,
  'rollover_cumulative_recovery',
  'rollover:' || recovered.source_hash
FROM duel_weekly previous
JOIN _rollover_week1_final recovered ON recovered.uid=previous.uid
WHERE previous.cycle_id='2026-08-30'
  AND previous.cycle_week=1
  AND recovered.final_score<>previous.score;

UPDATE duel_weekly
SET
  score=(SELECT recovered.final_score FROM _rollover_week1_final recovered WHERE recovered.uid=duel_weekly.uid),
  score_source='rollover_cumulative_recovery',
  source_priority=30,
  captured_at=(SELECT recovered.captured_at FROM _rollover_week1_final recovered WHERE recovered.uid=duel_weekly.uid),
  source_hash='rollover:' || (SELECT recovered.source_hash FROM _rollover_week1_final recovered WHERE recovered.uid=duel_weekly.uid)
WHERE cycle_id='2026-08-30'
  AND cycle_week=1
  AND uid IN (SELECT uid FROM _rollover_week1_final);

CREATE TEMP TABLE _rollover_week1_day6 (
  uid TEXT PRIMARY KEY,
  final_score INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL
);

INSERT INTO _rollover_week1_day6(uid,final_score,captured_at,source_hash)
SELECT
  recovered.uid,
  recovered.final_score - SUM(CASE WHEN d.day_index BETWEEN 1 AND 5 THEN d.score ELSE 0 END),
  recovered.captured_at,
  recovered.source_hash
FROM _rollover_week1_final recovered
JOIN duel_daily d
  ON d.cycle_id='2026-08-30'
 AND d.cycle_week=1
 AND d.uid=recovered.uid
GROUP BY recovered.uid,recovered.final_score,recovered.captured_at,recovered.source_hash
HAVING COUNT(DISTINCT CASE WHEN d.day_index BETWEEN 1 AND 5 THEN d.day_index END)=5
   AND recovered.final_score - SUM(CASE WHEN d.day_index BETWEEN 1 AND 5 THEN d.score ELSE 0 END) >= 0
   AND recovered.final_score - SUM(CASE WHEN d.day_index BETWEEN 1 AND 5 THEN d.score ELSE 0 END)
       >= COALESCE(MAX(CASE WHEN d.day_index=6 THEN d.score END),0);

INSERT OR IGNORE INTO score_history(
  change_id,metric_type,row_key,cycle_id,cycle_week,week_id,day_index,uid,name_at_capture,
  old_score,new_score,delta,captured_at,score_source,source_hash
)
SELECT
  'rollover-2026-08-30-w1-day6-' || previous.uid,
  'daily',
  previous.cycle_id || '|' || previous.cycle_week || '|6|' || previous.uid,
  previous.cycle_id,
  previous.cycle_week,
  previous.week_id,
  6,
  previous.uid,
  previous.name_at_capture,
  COALESCE(day6.score,0),
  recovered.final_score,
  recovered.final_score - COALESCE(day6.score,0),
  recovered.captured_at,
  'rollover_cumulative_recovery',
  'rollover:' || recovered.source_hash || ':d6'
FROM duel_weekly previous
JOIN _rollover_week1_day6 recovered ON recovered.uid=previous.uid
LEFT JOIN duel_daily day6
  ON day6.cycle_id=previous.cycle_id
 AND day6.cycle_week=previous.cycle_week
 AND day6.day_index=6
 AND day6.uid=previous.uid
WHERE previous.cycle_id='2026-08-30'
  AND previous.cycle_week=1
  AND recovered.final_score<>COALESCE(day6.score,0);

INSERT INTO duel_daily(
  cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,
  score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,
  server_id,country,source_hash
)
SELECT
  previous.cycle_id,
  previous.cycle_week,
  previous.week_id,
  previous.week_start_time,
  6,
  previous.uid,
  previous.name_at_capture,
  recovered.final_score,
  'rollover_cumulative_recovery',
  30,
  recovered.captured_at,
  previous.alliance_id,
  previous.alliance_abbr,
  previous.alliance_name,
  previous.server_id,
  previous.country,
  'rollover:' || recovered.source_hash || ':d6'
FROM duel_weekly previous
JOIN _rollover_week1_day6 recovered ON recovered.uid=previous.uid
WHERE previous.cycle_id='2026-08-30'
  AND previous.cycle_week=1
ON CONFLICT(cycle_id,cycle_week,day_index,uid) DO UPDATE SET
  score=excluded.score,
  score_source=excluded.score_source,
  source_priority=excluded.source_priority,
  captured_at=excluded.captured_at,
  source_hash=excluded.source_hash
WHERE excluded.score>=duel_daily.score;

UPDATE duel_weekly AS w
SET position=1+(
  SELECT COUNT(*)
  FROM duel_weekly other
  WHERE other.cycle_id=w.cycle_id
    AND other.cycle_week=w.cycle_week
    AND other.score>w.score
)
WHERE w.cycle_id='2026-08-30' AND w.cycle_week=1;

UPDATE duel_results
SET
  alliance_score=(SELECT SUM(final_score) FROM _rollover_week1_day6),
  is_win=NULL,
  outcome_source='rollover_cumulative_recovery',
  captured_at=(SELECT MAX(captured_at) FROM _rollover_week1_day6),
  source_hash='rollover:2026-09-07:alliance-d6'
WHERE cycle_id='2026-08-30'
  AND cycle_week=1
  AND day_index=6
  AND is_win IS NULL
  AND EXISTS(SELECT 1 FROM _rollover_week1_day6);

DROP TABLE _rollover_week1_day6;
DROP TABLE _rollover_week1_final;
