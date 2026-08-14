PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS alliance_polls (
  poll_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  publisher_uid TEXT,
  publisher_name TEXT,
  alliance_abbr TEXT,
  created_at TEXT,
  ends_at TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  support_multi INTEGER NOT NULL DEFAULT 0,
  source_session_id TEXT,
  captured_at TEXT NOT NULL,
  first_archived_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  roster_size INTEGER NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alliance_poll_options (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  option_text TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, option_id),
  FOREIGN KEY (poll_id) REFERENCES alliance_polls(poll_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alliance_poll_participants (
  poll_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  public_id TEXT,
  player_name TEXT,
  alliance_abbr TEXT,
  roster_member INTEGER NOT NULL DEFAULT 0,
  voted INTEGER NOT NULL DEFAULT 0,
  option_ids_json TEXT NOT NULL DEFAULT '[]',
  option_texts_json TEXT NOT NULL DEFAULT '[]',
  archived_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, uid),
  FOREIGN KEY (poll_id) REFERENCES alliance_polls(poll_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alliance_polls_created ON alliance_polls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alliance_poll_participants_vote ON alliance_poll_participants(poll_id, voted, player_name);
