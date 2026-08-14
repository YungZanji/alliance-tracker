PRAGMA foreign_keys = ON;

-- A shared weekly policy layer for Alliance Duel, State Ruler/SVS and Glory War.
-- weight_multiplier remains editable so the exact competitive weighting can be tuned
-- later without rewriting captured scores.
CREATE TABLE IF NOT EXISTS event_week_policy (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  is_bye INTEGER NOT NULL DEFAULT 0,
  weight_multiplier REAL NOT NULL DEFAULT 1.0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(event_type, cycle_id, cycle_week),
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_event_week_policy_cycle ON event_week_policy(cycle_id, cycle_week, event_type);

-- Canonical weekly event score/evidence. raw_score is the actual observed score when
-- present. credited_score can also represent a participation floor when a leaderboard
-- is incomplete. credit_source explains which rule produced it.
CREATE TABLE IF NOT EXISTS event_week_scores (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  uid TEXT NOT NULL,
  raw_score REAL,
  credited_score REAL NOT NULL DEFAULT 0,
  credit_source TEXT NOT NULL DEFAULT 'leaderboard',
  leaderboard_position INTEGER,
  source_command TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(event_type, cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_week_scores_type_week ON event_week_scores(event_type, cycle_id, cycle_week, credited_score DESC);
CREATE INDEX IF NOT EXISTS idx_event_week_scores_uid ON event_week_scores(uid, event_type, cycle_id, cycle_week);

-- Attendance evidence is deliberately separate from scores. This lets a future Last
-- Online collector prove that somebody attended the SVS window without inventing a
-- leaderboard score. The scoring layer can then apply the configured minimum credit.
CREATE TABLE IF NOT EXISTS event_attendance_evidence (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  uid TEXT NOT NULL,
  attended INTEGER NOT NULL DEFAULT 0,
  last_online_at TEXT,
  window_start TEXT,
  window_end TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(event_type, cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE,
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scoring_settings (
  setting_key TEXT PRIMARY KEY,
  numeric_value REAL,
  text_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO scoring_settings(setting_key,numeric_value,text_value,updated_at) VALUES
  ('state_ruler_attendance_floor',2250000,'Minimum credited score for confirmed State Ruler attendance without a leaderboard score',datetime('now')),
  ('bye_week_multiplier',0.50,'Initial reduced weighting for weeks marked Bye; editable in Admin',datetime('now')),
  ('duel_daily_minimum',6000000,'Normal-week Alliance Duel daily target',datetime('now'));
