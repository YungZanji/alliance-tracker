PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS glory_war_plans (
  plan_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Glory War battle plan',
  state_id INTEGER,
  alliance_abbr TEXT NOT NULL DEFAULT '',
  plan_updated_at TEXT NOT NULL DEFAULT '',
  source_filename TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  plan_html TEXT NOT NULL,
  uploaded_by_uid TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  FOREIGN KEY(uploaded_by_uid) REFERENCES players(uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_glory_war_plans_one_active
  ON glory_war_plans(is_active)
  WHERE is_active=1;

CREATE INDEX IF NOT EXISTS idx_glory_war_plans_uploaded
  ON glory_war_plans(uploaded_at DESC);
