CREATE TABLE IF NOT EXISTS admin_credentials (
  uid TEXT PRIMARY KEY,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 210000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_uid ON admin_sessions(uid);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_audit_uid_time ON admin_login_audit(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_login_audit_ip_time ON admin_login_audit(ip_hash, created_at DESC);

-- Bootstrap exactly one current administrator. The plaintext bootstrap password is never stored here.
INSERT INTO admin_credentials(uid,password_salt,password_hash,iterations,created_at,updated_at)
SELECT uid,
       'pB6s/alHGndgk7HNYyIkpA==',
       'e2CJsw/1zZir8fQvgZm9v3ztCFvxK9QIpTYSaicbBw0=',
       210000,
       datetime('now'),
       datetime('now')
FROM players
WHERE is_admin=1
ORDER BY COALESCE(last_login_at,'' ) DESC, uid
LIMIT 1
ON CONFLICT(uid) DO NOTHING;
