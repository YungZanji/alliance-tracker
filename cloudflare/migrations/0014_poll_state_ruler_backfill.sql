PRAGMA foreign_keys = ON;

-- Portal 0.9.2: retain an audit trail when an archived Alliance poll is used
-- as State Ruler attendance evidence. The actual attendance and credited score
-- continue to live in the existing event_attendance_evidence/event_week_scores
-- tables so State Ruler has one scoring path.
CREATE TABLE IF NOT EXISTS poll_state_ruler_applications (
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

CREATE INDEX IF NOT EXISTS idx_poll_state_ruler_applications_week
  ON poll_state_ruler_applications(cycle_id, cycle_week, applied_at DESC);
