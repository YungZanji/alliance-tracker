PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS duel_week_context (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  opponent_abbr TEXT NOT NULL DEFAULT '',
  opponent_name TEXT NOT NULL DEFAULT '',
  opponent_server_id INTEGER,
  source TEXT NOT NULL DEFAULT 'capture',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(cycle_id, cycle_week)
);
CREATE INDEX IF NOT EXISTS idx_duel_week_context_cycle ON duel_week_context(cycle_id, cycle_week);

CREATE TABLE IF NOT EXISTS player_week_leave (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  uid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'away',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_week_leave_week ON player_week_leave(cycle_id, cycle_week);
CREATE INDEX IF NOT EXISTS idx_player_week_leave_uid ON player_week_leave(uid, cycle_id, cycle_week);
