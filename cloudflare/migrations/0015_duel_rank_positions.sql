PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS duel_rank_positions (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  metric_scope TEXT NOT NULL,
  day_index INTEGER NOT NULL DEFAULT 0,
  uid TEXT NOT NULL,
  overall_position INTEGER,
  alliance_position INTEGER,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, metric_scope, day_index, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_duel_rank_positions_week
  ON duel_rank_positions(cycle_id, cycle_week, metric_scope, day_index);
CREATE INDEX IF NOT EXISTS idx_duel_rank_positions_uid
  ON duel_rank_positions(uid, captured_at DESC);
