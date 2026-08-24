PRAGMA foreign_keys = ON;

-- The game's alliance_duel_results payload can describe an unrelated opponent.
-- Keep explicit provenance on the materialized day result and use rankings as
-- the authoritative matchup source.
ALTER TABLE duel_results ADD COLUMN opponent_abbr TEXT;
ALTER TABLE duel_results ADD COLUMN outcome_source TEXT NOT NULL DEFAULT 'legacy';

-- A full weekly_combined leaderboard is an authoritative roster snapshot for
-- that Duel week. Keep historical duel_weekly rows intact, but record which
-- UIDs belong to the latest complete leaderboard so old rows cannot inflate
-- current totals or player counts.
CREATE TABLE IF NOT EXISTS duel_week_membership (
  cycle_id TEXT NOT NULL,
  cycle_week INTEGER NOT NULL,
  uid TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_hash TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(cycle_id,cycle_week,uid),
  FOREIGN KEY(uid) REFERENCES players(uid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_duel_week_membership_week
  ON duel_week_membership(cycle_id,cycle_week,captured_at DESC);

INSERT OR REPLACE INTO duel_week_membership(cycle_id,cycle_week,uid,captured_at,source_hash)
SELECT w.cycle_id,w.cycle_week,w.uid,w.captured_at,w.source_hash
FROM duel_weekly w
WHERE w.score_source='weekly_combined'
  AND w.captured_at=(
    SELECT MAX(w2.captured_at)
    FROM duel_weekly w2
    WHERE w2.cycle_id=w.cycle_id
      AND w2.cycle_week=w.cycle_week
      AND w2.score_source='weekly_combined'
  );

-- Recovery evidence:
-- Week 2's Aug 15 completed-days capture shows WDZ ahead of DREA on D1-D5.
-- The Aug 16 final weekly leaderboard gives the exact final D6 delta.
-- Week 3's Aug 22 completed-days capture shows WDZ vs Gwgp on D1-D5.
-- The Aug 23 final weekly leaderboard gives the exact final D6 delta.
-- These rows replace the unrelated-opponent scores returned by the Sunday
-- alliance_duel_results payload.

INSERT INTO duel_results(
  cycle_id,cycle_week,week_id,week_start_time,day_index,event_name,
  alliance_score,opponent_score,is_win,mvp_uid,mvp_name,mvp_score,
  captured_at,source_hash,opponent_abbr,outcome_source
) VALUES
('2026-08-02',2,'2026-08-09',1786327200000,1,'Tank Day',1247293231,718207203,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d1:completed-days','DREA','rankings_recovered'),
('2026-08-02',2,'2026-08-09',1786327200000,2,'Build Day',822182299,569633755,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d2:completed-days','DREA','rankings_recovered'),
('2026-08-02',2,'2026-08-09',1786327200000,3,'Science Day',877525978,573979009,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d3:completed-days','DREA','rankings_recovered'),
('2026-08-02',2,'2026-08-09',1786327200000,4,'Hero Day',2414774754,1263334778,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d4:completed-days','DREA','rankings_recovered'),
('2026-08-02',2,'2026-08-09',1786327200000,5,'Training Day',789637746,610884145,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d5:completed-days','DREA','rankings_recovered'),
('2026-08-02',2,'2026-08-09',1786327200000,6,'Enemy Buster',1941691033,1318166412,1,'','',0,'2026-08-16T23:42:48.333Z','recovery:week2:d6:weekly-delta','DREA','rankings_recovered'),

('2026-08-02',3,'2026-08-16',1786932000000,1,'Tank Day',1230450234,1634377499,0,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d1:completed-days','Gwgp','rankings_recovered'),
('2026-08-02',3,'2026-08-16',1786932000000,2,'Build Day',861450877,855778111,1,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d2:completed-days','Gwgp','rankings_recovered'),
('2026-08-02',3,'2026-08-16',1786932000000,3,'Science Day',908905367,987331004,0,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d3:completed-days','Gwgp','rankings_recovered'),
('2026-08-02',3,'2026-08-16',1786932000000,4,'Hero Day',2391899734,2513539189,0,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d4:completed-days','Gwgp','rankings_recovered'),
('2026-08-02',3,'2026-08-16',1786932000000,5,'Training Day',877267583,1051494792,0,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d5:completed-days','Gwgp','rankings_recovered'),
('2026-08-02',3,'2026-08-16',1786932000000,6,'Enemy Buster',1293794669,1961502338,0,'','',0,'2026-08-23T23:13:41.428Z','recovery:week3:d6:weekly-delta','Gwgp','rankings_recovered')
ON CONFLICT(cycle_id,cycle_week,day_index) DO UPDATE SET
  week_id=excluded.week_id,
  week_start_time=excluded.week_start_time,
  event_name=excluded.event_name,
  alliance_score=excluded.alliance_score,
  opponent_score=excluded.opponent_score,
  is_win=excluded.is_win,
  mvp_uid='',
  mvp_name='',
  mvp_score=0,
  captured_at=excluded.captured_at,
  source_hash=excluded.source_hash,
  opponent_abbr=excluded.opponent_abbr,
  outcome_source=excluded.outcome_source;
