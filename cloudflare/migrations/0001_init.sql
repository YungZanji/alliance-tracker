PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  current_name TEXT NOT NULL,
  alliance_id TEXT,
  alliance_abbr TEXT,
  alliance_name TEXT,
  server_id INTEGER,
  country TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_aliases (
  alias_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alias_uid ON player_aliases(uid);

CREATE TABLE IF NOT EXISTS captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_snapshot_id INTEGER,
  session_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  command TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  primary_alliance TEXT NOT NULL,
  rank_type INTEGER,
  rank_type_label TEXT,
  source_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(dataset, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_captures_cycle ON captures(cycle_id, captured_at);

CREATE TABLE IF NOT EXISTS duel_weekly (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  uid TEXT NOT NULL,
  name_at_capture TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  score_source TEXT NOT NULL,
  source_priority INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_weekly_uid ON duel_weekly(uid);
CREATE INDEX IF NOT EXISTS idx_weekly_cycle_score ON duel_weekly(cycle_id, score DESC);

CREATE TABLE IF NOT EXISTS duel_daily (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  uid TEXT NOT NULL,
  name_at_capture TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  score_source TEXT NOT NULL,
  source_priority INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  alliance_id TEXT,
  alliance_abbr TEXT,
  alliance_name TEXT,
  server_id INTEGER,
  country TEXT,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, day_index, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_daily_uid ON duel_daily(uid);
CREATE INDEX IF NOT EXISTS idx_daily_cycle ON duel_daily(cycle_id, cycle_week, day_index);

CREATE TABLE IF NOT EXISTS score_history (
  change_id TEXT PRIMARY KEY,
  metric_type TEXT NOT NULL,
  row_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  day_index INTEGER,
  uid TEXT NOT NULL,
  name_at_capture TEXT NOT NULL,
  old_score INTEGER NOT NULL,
  new_score INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  score_source TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_history_uid_time ON score_history(uid, captured_at DESC);

CREATE TABLE IF NOT EXISTS duel_results (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  event_name TEXT,
  alliance_score INTEGER,
  opponent_score INTEGER,
  is_win INTEGER,
  mvp_uid TEXT,
  mvp_name TEXT,
  mvp_score INTEGER,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, day_index)
);

CREATE TABLE IF NOT EXISTS duel_seasons (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  current_position INTEGER,
  current_group TEXT,
  current_round_result TEXT,
  current_rank_type TEXT,
  previous_position INTEGER,
  previous_group TEXT,
  previous_round_result TEXT,
  previous_rank_type TEXT,
  message_id TEXT,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week)
);
