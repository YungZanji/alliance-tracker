PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS alliance_seasons (
  season_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_cycle_id TEXT NOT NULL,
  final_cycle_id TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  archived_at TEXT,
  scoring_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alliance_seasons_single_active
  ON alliance_seasons(status) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_alliance_seasons_start ON alliance_seasons(start_cycle_id DESC);

CREATE TABLE IF NOT EXISTS season_archived_leaderboard (
  season_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  public_id TEXT,
  rank INTEGER NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  row_json TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY(season_id, uid),
  FOREIGN KEY(season_id) REFERENCES alliance_seasons(season_id) ON DELETE CASCADE,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_season_archive_rank ON season_archived_leaderboard(season_id, rank);

-- Explicitly absent events are different from Bye weeks. A no-event week is removed
-- from the event denominator entirely and never creates a zero for a player.
CREATE TABLE IF NOT EXISTS event_week_availability (
  event_type TEXT NOT NULL CHECK(event_type IN ('state_ruler','glory_war')),
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'no_event' CHECK(status='no_event'),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(event_type, cycle_id, cycle_week),
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_event_week_availability_cycle
  ON event_week_availability(cycle_id, cycle_week, event_type);

-- Seed the season that began with the existing August 2 Duel League. Admin can rename
-- it, set the final Duel League/end timestamp, and archive it later.
INSERT OR IGNORE INTO alliance_seasons(
  season_id,name,start_cycle_id,final_cycle_id,starts_at,ends_at,status,archived_at,scoring_snapshot_json,created_at,updated_at
) VALUES(
  'season-2026-08','Season 1','2026-08-02',NULL,'2026-08-02T00:00:00Z',NULL,'active',NULL,'{}',datetime('now'),datetime('now')
);
