PRAGMA foreign_keys = ON;

ALTER TABLE players ADD COLUMN login_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_login_at TEXT;
ALTER TABLE players ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_uid ON auth_sessions(uid);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  entered_uid_hash TEXT NOT NULL,
  player_name TEXT,
  success INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ip_hash TEXT,
  country TEXT,
  colo TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_audit_uid ON login_audit(uid, created_at DESC);

CREATE TABLE IF NOT EXISTS event_scores (
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(event_type, event_id, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_scores_type_uid ON event_scores(event_type, uid);

CREATE TABLE IF NOT EXISTS participation_weights (
  event_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO participation_weights(event_type,label,weight,enabled) VALUES
  ('alliance_duel','Alliance Duel',1,1),
  ('state_ruler','State Ruler',1,1),
  ('glory_war','Glory War',1,1);

-- Bootstrap the existing owner account from the already-captured canonical player row.
-- The actual UID never appears in source control and the role remains attached to the stable UID.
UPDATE players
SET is_admin = 1
WHERE uid = (
  SELECT uid FROM players
  WHERE current_name = 'Mr Zanji' AND alliance_abbr = 'WDZ' AND server_id = 305
  ORDER BY last_seen_at DESC
  LIMIT 1
);
