PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS event_week_context (
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

CREATE INDEX IF NOT EXISTS idx_event_week_context_cycle
  ON event_week_context(event_type, cycle_id, cycle_week);

-- Historical Week 1 State Ruler matchup supplied by the administrator.
INSERT INTO event_week_context(
  event_type,cycle_id,cycle_week,opponent_state,opponent_label,source,updated_at,updated_by_uid
)
VALUES(
  'state_ruler','2026-08-02',1,350,'State 350','admin','2026-08-10T03:19:00.000Z',NULL
)
ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
  opponent_state=excluded.opponent_state,
  opponent_label=excluded.opponent_label,
  source=excluded.source,
  updated_at=excluded.updated_at;
