-- Portal 1.0.0: normalize Alliance Duel and State Ruler onto a shared Contribution Index.
-- Event-specific raw scoring remains unchanged; this only defines the cross-event combining scale.

INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
VALUES
  ('duel_contribution_baseline',6000000,'Weighted Duel Average that maps to Contribution Index 100',datetime('now')),
  ('state_ruler_contribution_baseline',2250000,'State Ruler credited score that maps to Contribution Index 100',datetime('now')),
  ('contribution_curve_exponent',0.50,'Exponent used to normalize event performance onto the Contribution Index',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;

-- State Ruler attendance credit already uses this setting. Preserve an existing Admin override if one exists.
INSERT INTO scoring_settings(setting_key,numeric_value,text_value,updated_at)
VALUES('state_ruler_attendance_floor',2250000,'Minimum State Ruler credit for confirmed attendance without a real leaderboard score',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;

-- Agreed overall event allocation. Glory War keeps its reserved 30% while its scoring model is still pending.
INSERT INTO participation_weights(event_type,label,weight,enabled) VALUES
  ('alliance_duel','Alliance Duel',0.45,1),
  ('state_ruler','State Ruler',0.25,1),
  ('glory_war','Glory War',0.30,1)
ON CONFLICT(event_type) DO UPDATE SET
  label=excluded.label,
  weight=excluded.weight,
  enabled=excluded.enabled;
