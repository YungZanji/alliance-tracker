PRAGMA foreign_keys = ON;

-- The Last Z Duel rankings expose two different player score scopes:
--   rankType 1 / weekly_combined      = the current week's score
--   rankType 2 / weekly_own_alliance = cumulative score across the Duel League
-- Older ingestion merged both into duel_weekly and preferred rankType 2. Preserve
-- that cumulative value separately, then repair duel_weekly from captured daily rows.
CREATE TABLE IF NOT EXISTS duel_league_total (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  uid TEXT NOT NULL,
  name_at_capture TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  score_source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  alliance_id TEXT,
  alliance_abbr TEXT,
  alliance_name TEXT,
  server_id INTEGER,
  country TEXT,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_duel_league_total_uid ON duel_league_total(uid);
CREATE INDEX IF NOT EXISTS idx_duel_league_total_cycle_score ON duel_league_total(cycle_id, cycle_week, score DESC);

-- Preserve the previously stored leaderboard before correcting duel_weekly. This is
-- especially important for Week 2, where the values are Week 1 + Week 2 cumulative.
INSERT INTO duel_league_total(
  cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,
  score_source,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
)
SELECT
  cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,
  'legacy_weekly_own_alliance',captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
FROM duel_weekly
WHERE 1=1
ON CONFLICT(cycle_id,cycle_week,uid) DO UPDATE SET
  week_id=excluded.week_id,
  week_start_time=excluded.week_start_time,
  name_at_capture=excluded.name_at_capture,
  score=excluded.score,
  position=excluded.position,
  score_source=excluded.score_source,
  captured_at=excluded.captured_at,
  alliance_id=excluded.alliance_id,
  alliance_abbr=excluded.alliance_abbr,
  alliance_name=excluded.alliance_name,
  server_id=excluded.server_id,
  country=excluded.country,
  source_hash=excluded.source_hash;

-- A weekly total is the sum of that week's six daily scores. Repair every row for
-- which daily evidence already exists. Future rankType 1 captures will replace this
-- low-priority repair value with the game's authoritative current-week leaderboard.
UPDATE duel_weekly
SET
  score = COALESCE((
    SELECT SUM(d.score)
    FROM duel_daily d
    WHERE d.cycle_id=duel_weekly.cycle_id
      AND d.cycle_week=duel_weekly.cycle_week
      AND d.uid=duel_weekly.uid
  ), score),
  score_source = CASE
    WHEN EXISTS(
      SELECT 1 FROM duel_daily d
      WHERE d.cycle_id=duel_weekly.cycle_id
        AND d.cycle_week=duel_weekly.cycle_week
        AND d.uid=duel_weekly.uid
    ) THEN 'daily_sum_repair'
    ELSE score_source
  END,
  source_priority = CASE
    WHEN EXISTS(
      SELECT 1 FROM duel_daily d
      WHERE d.cycle_id=duel_weekly.cycle_id
        AND d.cycle_week=duel_weekly.cycle_week
        AND d.uid=duel_weekly.uid
    ) THEN 5
    ELSE source_priority
  END
WHERE EXISTS(
  SELECT 1 FROM duel_daily d
  WHERE d.cycle_id=duel_weekly.cycle_id
    AND d.cycle_week=duel_weekly.cycle_week
    AND d.uid=duel_weekly.uid
);

-- Re-rank repaired weekly rows within each week.
UPDATE duel_weekly AS w
SET position = 1 + (
  SELECT COUNT(*)
  FROM duel_weekly AS other
  WHERE other.cycle_id=w.cycle_id
    AND other.cycle_week=w.cycle_week
    AND other.score>w.score
);
