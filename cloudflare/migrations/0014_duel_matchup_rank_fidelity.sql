PRAGMA foreign_keys = ON;

ALTER TABLE duel_weekly ADD COLUMN overall_position INTEGER;
ALTER TABLE duel_weekly ADD COLUMN alliance_position INTEGER;
ALTER TABLE duel_daily ADD COLUMN overall_position INTEGER;
ALTER TABLE duel_daily ADD COLUMN alliance_position INTEGER;

CREATE TABLE IF NOT EXISTS duel_group_members (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  duel_group TEXT NOT NULL DEFAULT '',
  alliance_id TEXT NOT NULL,
  alliance_abbr TEXT NOT NULL DEFAULT '',
  alliance_name TEXT NOT NULL DEFAULT '',
  server_id INTEGER,
  league_position INTEGER,
  rank_type INTEGER,
  round_result TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, alliance_id)
);
CREATE INDEX IF NOT EXISTS idx_duel_group_members_week
  ON duel_group_members(cycle_id, cycle_week, league_position);
CREATE INDEX IF NOT EXISTS idx_duel_group_members_abbr
  ON duel_group_members(cycle_id, cycle_week, alliance_abbr);

CREATE TABLE IF NOT EXISTS duel_matchups (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  duel_group TEXT NOT NULL DEFAULT '',
  primary_alliance_id TEXT NOT NULL DEFAULT '',
  primary_alliance_abbr TEXT NOT NULL DEFAULT '',
  primary_alliance_name TEXT NOT NULL DEFAULT '',
  primary_state INTEGER,
  opponent_alliance_id TEXT NOT NULL DEFAULT '',
  opponent_abbr TEXT NOT NULL DEFAULT '',
  opponent_name TEXT NOT NULL DEFAULT '',
  opponent_state INTEGER,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week)
);
CREATE INDEX IF NOT EXISTS idx_duel_matchups_opponent
  ON duel_matchups(opponent_abbr, opponent_state);
