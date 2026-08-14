-- Portal 0.9.4: reduce the scoring value of Duel days that occur after WDZ has already secured 7 of 13 week points.

INSERT OR IGNORE INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
VALUES('secured_week_multiplier_alliance_duel',0.35,'Alliance Duel score multiplier after the week is mathematically secured',datetime('now'));

CREATE TABLE IF NOT EXISTS duel_day_outcome_override (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  day_index INTEGER NOT NULL,
  is_win INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'admin',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(cycle_id,cycle_week,day_index)
);

-- Historical Week 1 was captured before outcome presentation was part of the portal.
-- WDZ vs 404b is confirmed as six WDZ wins; real duel_results rows always take precedence.
INSERT OR IGNORE INTO duel_day_outcome_override(cycle_id,cycle_week,day_index,is_win,source,note,updated_at) VALUES
('2026-08-02',1,1,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now')),
('2026-08-02',1,2,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now')),
('2026-08-02',1,3,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now')),
('2026-08-02',1,4,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now')),
('2026-08-02',1,5,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now')),
('2026-08-02',1,6,1,'historical_confirmed','WDZ vs 404b: confirmed WDZ win',datetime('now'));
