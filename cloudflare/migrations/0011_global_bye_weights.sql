PRAGMA foreign_keys = ON;

-- A Bye week can either inherit the event-wide default or keep an explicit
-- per-week override. Existing policies are preserved as explicit overrides.
ALTER TABLE event_week_policy ADD COLUMN use_default_bye_weight INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO scoring_settings(setting_key,numeric_value,text_value,updated_at) VALUES
  ('bye_week_multiplier_alliance_duel',0.35,'Default Alliance Duel Bye-week weight',datetime('now')),
  ('bye_week_multiplier_state_ruler',0.35,'Default State Ruler/SVS Bye-week weight',datetime('now')),
  ('bye_week_multiplier_glory_war',0.35,'Default Glory War Bye-week weight',datetime('now'));
