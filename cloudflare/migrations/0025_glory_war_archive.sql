PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS glory_war_matches (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  primary_alliance_id TEXT,
  primary_alliance_abbr TEXT NOT NULL,
  primary_alliance_name TEXT,
  primary_server_id INTEGER,
  opponent_alliance_id TEXT,
  opponent_alliance_abbr TEXT,
  opponent_alliance_name TEXT,
  opponent_server_id INTEGER,
  primary_state_score INTEGER NOT NULL DEFAULT 0,
  opponent_state_score INTEGER NOT NULL DEFAULT 0,
  primary_alliance_score INTEGER NOT NULL DEFAULT 0,
  opponent_alliance_score INTEGER NOT NULL DEFAULT 0,
  is_win INTEGER,
  result TEXT NOT NULL DEFAULT '',
  player_count INTEGER NOT NULL DEFAULT 0,
  source_command TEXT NOT NULL DEFAULT 'alliance.declare.war.personal.rank',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (cycle_id, cycle_week)
);

CREATE INDEX IF NOT EXISTS idx_glory_war_matches_captured
  ON glory_war_matches(captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_glory_war_scores_week
  ON event_week_scores(event_type, cycle_id, cycle_week, credited_score DESC);
