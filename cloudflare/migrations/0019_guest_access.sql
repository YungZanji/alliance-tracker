PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guest_accounts (
  guest_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  guest_uid TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 120000,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_login_at TEXT,
  login_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(guest_uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_guest_accounts_expiry ON guest_accounts(expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_accounts_active ON guest_accounts(active, expires_at);
