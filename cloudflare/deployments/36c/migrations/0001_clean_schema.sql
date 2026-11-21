-- Clean 36C baseline: schema only, no WDZ history or credentials.
PRAGMA foreign_keys=ON;

CREATE TABLE admin_credentials (
  uid TEXT PRIMARY KEY,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 210000,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE admin_login_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE SET NULL
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE alliance_poll_options (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  option_text TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (poll_id, option_id),
  FOREIGN KEY (poll_id) REFERENCES alliance_polls(poll_id) ON DELETE CASCADE
);

CREATE TABLE alliance_poll_participants (
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

CREATE TABLE alliance_polls (
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

CREATE TABLE alliance_seasons (
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

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE canyon_plan_image_chunks (
  language_code TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_base64 TEXT NOT NULL,
  PRIMARY KEY(language_code, chunk_index),
  FOREIGN KEY(language_code) REFERENCES canyon_plan_images(language_code) ON DELETE CASCADE
);

CREATE TABLE canyon_plan_images (
  language_code TEXT PRIMARY KEY,
  language_label TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  image_base64 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  uploaded_by_uid TEXT,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(uploaded_by_uid) REFERENCES players(uid)
);

CREATE TABLE captures (
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

CREATE TABLE duel_daily (
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
  source_hash TEXT NOT NULL, overall_position INTEGER, alliance_position INTEGER,
  PRIMARY KEY(cycle_id, cycle_week, day_index, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE duel_day_outcome_override (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  is_win INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(cycle_id,cycle_week,day_index)
);

CREATE TABLE duel_group_members (
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

CREATE TABLE duel_league_total (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  uid TEXT NOT NULL,
  name_at_capture TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  score_source TEXT NOT NULL,
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

CREATE TABLE duel_matchups (
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

CREATE TABLE duel_rank_positions (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  week_id TEXT NOT NULL,
  week_start_time INTEGER NOT NULL,
  metric_scope TEXT NOT NULL,
  day_index INTEGER NOT NULL DEFAULT 0,
  uid TEXT NOT NULL,
  overall_position INTEGER,
  alliance_position INTEGER,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY(cycle_id, cycle_week, metric_scope, day_index, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE duel_restore_log (
  action_id TEXT PRIMARY KEY,
  restore_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  restored_at TEXT NOT NULL,
  safety_restore_id TEXT NOT NULL DEFAULT '',
  restored_state_hash TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(restore_id) REFERENCES duel_restore_points(restore_id) ON DELETE RESTRICT
);

CREATE TABLE duel_restore_points (
  restore_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_session_id TEXT NOT NULL DEFAULT '',
  state_hash TEXT NOT NULL,
  daily_json TEXT NOT NULL DEFAULT '[]',
  weekly_json TEXT NOT NULL DEFAULT '[]',
  league_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE duel_results (
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
  source_hash TEXT NOT NULL, opponent_abbr TEXT, outcome_source TEXT NOT NULL DEFAULT 'legacy',
  PRIMARY KEY(cycle_id, cycle_week, day_index)
);

CREATE TABLE duel_seasons (
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

CREATE TABLE duel_week_context (
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

CREATE TABLE duel_week_membership (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  uid TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(cycle_id,cycle_week,uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE duel_weekly (
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
  source_hash TEXT NOT NULL, overall_position INTEGER, alliance_position INTEGER,
  PRIMARY KEY(cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE event_attendance_evidence (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  uid TEXT NOT NULL,
  attended INTEGER NOT NULL DEFAULT 0,
  last_online_at TEXT,
  window_start TEXT,
  window_end TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(event_type, cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE,
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid) ON DELETE SET NULL
);

CREATE TABLE event_scores (
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

CREATE TABLE event_week_availability (
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

CREATE TABLE event_week_context (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  opponent_state INTEGER,
  opponent_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'admin',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT,
  PRIMARY KEY(event_type, cycle_id, cycle_week),
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid)
);

CREATE TABLE event_week_policy (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  is_bye INTEGER NOT NULL DEFAULT 0,
  weight_multiplier REAL NOT NULL DEFAULT 1.0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT, use_default_bye_weight INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(event_type, cycle_id, cycle_week),
  FOREIGN KEY(updated_by_uid) REFERENCES players(uid) ON DELETE SET NULL
);

CREATE TABLE event_week_scores (
  event_type TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  uid TEXT NOT NULL,
  raw_score REAL,
  credited_score REAL NOT NULL DEFAULT 0,
  credit_source TEXT NOT NULL DEFAULT 'leaderboard',
  leaderboard_position INTEGER,
  source_command TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(event_type, cycle_id, cycle_week, uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE glory_war_matches (
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

CREATE TABLE glory_war_plans (
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

CREATE TABLE guest_accounts (
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

CREATE TABLE login_audit (
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

CREATE TABLE participation_weights (
  event_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE player_aliases (
  alias_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE TABLE player_week_leave (
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

CREATE TABLE players (
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
, login_enabled INTEGER NOT NULL DEFAULT 1, is_admin INTEGER NOT NULL DEFAULT 0, last_login_at TEXT, login_count INTEGER NOT NULL DEFAULT 0);

CREATE TABLE poll_state_ruler_applications (
  poll_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL CHECK(cycle_week BETWEEN 1 AND 4),
  attendance_option_id TEXT NOT NULL,
  attendance_option_text TEXT NOT NULL DEFAULT '',
  attendance_floor REAL NOT NULL DEFAULT 2250000,
  yes_count INTEGER NOT NULL DEFAULT 0,
  floor_credits_added INTEGER NOT NULL DEFAULT 0,
  real_scores_preserved INTEGER NOT NULL DEFAULT 0,
  explicit_other_votes INTEGER NOT NULL DEFAULT 0,
  unknown_players INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT NOT NULL,
  PRIMARY KEY(poll_id, cycle_id, cycle_week, attendance_option_id),
  FOREIGN KEY(poll_id) REFERENCES alliance_polls(poll_id) ON DELETE CASCADE
);

CREATE TABLE score_history (
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

CREATE TABLE scoring_settings (
  setting_key TEXT PRIMARY KEY,
  numeric_value REAL,
  text_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE season_archived_leaderboard (
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

CREATE INDEX idx_admin_login_audit_ip_time ON admin_login_audit(ip_hash, created_at DESC);

CREATE INDEX idx_admin_login_audit_uid_time ON admin_login_audit(uid, created_at DESC);

CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE INDEX idx_admin_sessions_uid ON admin_sessions(uid);

CREATE INDEX idx_alias_uid ON player_aliases(uid);

CREATE INDEX idx_alliance_poll_participants_vote ON alliance_poll_participants(poll_id, voted, player_name);

CREATE INDEX idx_alliance_polls_created ON alliance_polls(created_at DESC);

CREATE UNIQUE INDEX idx_alliance_seasons_single_active
  ON alliance_seasons(status) WHERE status='active';

CREATE INDEX idx_alliance_seasons_start ON alliance_seasons(start_cycle_id DESC);

CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE INDEX idx_auth_sessions_uid ON auth_sessions(uid);

CREATE INDEX idx_canyon_plan_image_chunks_language
  ON canyon_plan_image_chunks(language_code, chunk_index);

CREATE INDEX idx_canyon_plan_images_updated
  ON canyon_plan_images(updated_at DESC);

CREATE INDEX idx_captures_cycle ON captures(cycle_id, captured_at);

CREATE INDEX idx_daily_cycle ON duel_daily(cycle_id, cycle_week, day_index);

CREATE INDEX idx_daily_uid ON duel_daily(uid);

CREATE INDEX idx_duel_group_members_abbr
  ON duel_group_members(cycle_id, cycle_week, alliance_abbr);

CREATE INDEX idx_duel_group_members_week
  ON duel_group_members(cycle_id, cycle_week, league_position);

CREATE INDEX idx_duel_league_total_cycle_score ON duel_league_total(cycle_id, cycle_week, score DESC);

CREATE INDEX idx_duel_league_total_uid ON duel_league_total(uid);

CREATE INDEX idx_duel_matchups_opponent
  ON duel_matchups(opponent_abbr, opponent_state);

CREATE INDEX idx_duel_rank_positions_uid
  ON duel_rank_positions(uid, captured_at DESC);

CREATE INDEX idx_duel_rank_positions_week
  ON duel_rank_positions(cycle_id, cycle_week, metric_scope, day_index);

CREATE INDEX idx_duel_restore_log_time
  ON duel_restore_log(restored_at DESC);

CREATE INDEX idx_duel_restore_points_week
  ON duel_restore_points(cycle_id,cycle_week,created_at DESC);

CREATE INDEX idx_duel_week_context_cycle ON duel_week_context(cycle_id, cycle_week);

CREATE INDEX idx_duel_week_membership_week
  ON duel_week_membership(cycle_id,cycle_week,captured_at DESC);

CREATE INDEX idx_event_scores_type_uid ON event_scores(event_type, uid);

CREATE INDEX idx_event_week_availability_cycle
  ON event_week_availability(cycle_id, cycle_week, event_type);

CREATE INDEX idx_event_week_context_cycle
  ON event_week_context(event_type, cycle_id, cycle_week);

CREATE INDEX idx_event_week_policy_cycle ON event_week_policy(cycle_id, cycle_week, event_type);

CREATE INDEX idx_event_week_scores_type_week ON event_week_scores(event_type, cycle_id, cycle_week, credited_score DESC);

CREATE INDEX idx_event_week_scores_uid ON event_week_scores(uid, event_type, cycle_id, cycle_week);

CREATE INDEX idx_glory_war_matches_captured
  ON glory_war_matches(captured_at DESC);

CREATE UNIQUE INDEX idx_glory_war_plans_one_active
  ON glory_war_plans(is_active)
  WHERE is_active=1;

CREATE INDEX idx_glory_war_plans_uploaded
  ON glory_war_plans(uploaded_at DESC);

CREATE INDEX idx_glory_war_scores_week
  ON event_week_scores(event_type, cycle_id, cycle_week, credited_score DESC);

CREATE INDEX idx_guest_accounts_active ON guest_accounts(active, expires_at);

CREATE INDEX idx_guest_accounts_expiry ON guest_accounts(expires_at);

CREATE INDEX idx_history_uid_time ON score_history(uid, captured_at DESC);

CREATE INDEX idx_login_audit_created ON login_audit(created_at DESC);

CREATE INDEX idx_login_audit_uid ON login_audit(uid, created_at DESC);

CREATE INDEX idx_player_week_leave_uid ON player_week_leave(uid, cycle_id, cycle_week);

CREATE INDEX idx_player_week_leave_week ON player_week_leave(cycle_id, cycle_week);

CREATE INDEX idx_poll_state_ruler_applications_week
  ON poll_state_ruler_applications(cycle_id, cycle_week, applied_at DESC);

CREATE INDEX idx_season_archive_rank ON season_archived_leaderboard(season_id, rank);

CREATE INDEX idx_weekly_cycle_score ON duel_weekly(cycle_id, score DESC);

CREATE INDEX idx_weekly_uid ON duel_weekly(uid);
