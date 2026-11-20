-- Product defaults only. No players, season history, credentials, or captures.
INSERT INTO participation_weights(event_type,label,weight,enabled) VALUES
('alliance_duel','Alliance Duel',0.45,1),
('state_ruler','State Ruler',0.25,1),
('glory_war','Glory War',0.30,1);
