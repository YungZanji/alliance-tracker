PRAGMA foreign_keys = ON;

-- Historical recovery for cycle 2026-08-02, Week 1.
-- Day 1-5 source: 20260808_112533_Control_Sequence_Training,
-- snapshot 0201 completed_days at 2026-08-08T18:34:36.767Z.
-- It is the latest supplied complete snapshot with all 100 WDZ players.
-- Enemy Buster is reconstructed from the final authoritative duel_weekly value
-- already synced to D1: D6 = weekly final - D1 - D2 - D3 - D4 - D5.
-- State Ruler source: server.battle.user.score.rank at 2026-08-08T17:20:35.941Z.
-- No supplied archive contains Last Online evidence, so no attendance-only 2.25M
-- credits are fabricated by this migration.

INSERT INTO event_week_policy(event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at,updated_by_uid)
VALUES
  ('alliance_duel','2026-08-02',1,1,0.50,'Resource-save / low-stakes week; normal 6M daily warning is informational.','2026-08-09T13:20:00.000Z',NULL),
  ('state_ruler','2026-08-02',1,1,0.50,'State Ruler / SVS treated as a bye week.','2026-08-09T13:20:00.000Z',NULL)
ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
  is_bye=excluded.is_bye,
  weight_multiplier=excluded.weight_multiplier,
  note=excluded.note,
  updated_at=excluded.updated_at,
  updated_by_uid=NULL;

INSERT INTO duel_week_context(cycle_id,cycle_week,opponent_abbr,opponent_name,opponent_server_id,source,updated_at,updated_by_uid)
VALUES('2026-08-02',1,'404b','Tig Ole Bitties',293,'capture','2026-08-08T18:34:38.543Z',NULL)
ON CONFLICT(cycle_id,cycle_week) DO UPDATE SET
  opponent_abbr=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.opponent_abbr ELSE excluded.opponent_abbr END,
  opponent_name=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.opponent_name ELSE excluded.opponent_name END,
  opponent_server_id=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.opponent_server_id ELSE excluded.opponent_server_id END,
  source=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.source ELSE excluded.source END,
  updated_at=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.updated_at ELSE excluded.updated_at END,
  updated_by_uid=CASE WHEN duel_week_context.source='admin' THEN duel_week_context.updated_by_uid ELSE NULL END;

-- Compact source array format: [uid,d1,d2,d3,d4,d5].
WITH source(payload) AS (VALUES('[["1004427197000305",14041492,6869076,23108676,14321475,6704441],["1006557479000307",6040681,7972874,31894333,20732912,8172159],["1009380703000305",9079397,6027056,12611818,6379208,4110933],["1014818174000319",12575305,7889759,6412237,27315500,3274798],["1019735737000307",6689595,6565779,13973121,19755442,8089380],["1023306812000305",6289667,3716831,4470279,11157780,7740216],["1023835316000305",4421258,3728291,3327604,16104771,3345016],["1029340881000307",41396192,12044017,18327576,18684560,9421839],["1029972507000307",7302672,4428680,2785065,19577270,3223954],["1031293417000307",11202383,7034074,6903063,6377197,3754226],["1032201553000305",6030094,7573691,8631984,11743819,7673959],["1035314029000307",18173396,8880751,6139914,21951212,6990224],["1037836173000305",9899529,4680575,8841558,14455082,7470472],["1038226679000306",0,5380204,7242908,15298753,6260273],["1043358090000319",10613056,10033067,12942953,43582993,9815686],["1057629871000309",8668988,6789094,6121246,14308766,6420398],["1060453249000309",7954469,6139177,7216277,30662740,7936096],["1061702357000307",7880266,3438821,3600900,9754238,4129710],["1080010922000307",5327020,3251241,3201612,10504675,4667693],["1081888866000307",10212988,6006995,7821515,14325445,8075682],["1082649598000319",14336993,6005613,8129896,18471144,6015006],["1083047000000306",6329871,6218987,6901837,12979835,6008067],["1083205961000319",3820983,3946040,6112778,7488519,3336132],["1091593875000307",6253371,6093944,3273481,11928100,3126830],["1097154843000307",7136299,9074153,7593348,6978528,6210037],["1097847447000307",6839143,4006168,7014049,7775189,3311210],["1101053407000307",9669421,4745343,7691137,14602757,6967596],["1102575906000309",11134048,7041245,9302207,18130740,8097308],["1108315264000309",3239369,3093727,5244621,9422094,6271406],["1108575587000307",10779618,8409022,11869764,10493081,2463519],["1120120418000309",11371999,6056548,6346261,32554808,8113375],["1130197910000307",8553054,8043809,6586055,6398990,6261931],["1130742158000305",6478017,8712555,1638000,7606774,11615847],["1150445678000305",6239744,6627578,6104875,6242250,6289933],["1159244722000307",11579445,11874716,8086954,10363500,13970855],["1181729982000307",7173808,6108400,9735090,23832414,6501201],["1187621005000307",6288036,3700874,6215738,6447304,5414541],["1190408231000307",2679742,4826280,8146244,6043802,2439024],["1198328193000308",14606295,3642388,7382835,13037911,3716716],["1219357175000305",10084977,6183345,8605150,11029611,6710183],["1220058932000319",7112249,6667726,25349525,13286884,6283503],["1222759369000305",7616418,6395328,14983097,14926206,11723260],["1224097952000307",7751119,12696886,10567391,15431232,3510304],["1235208610000319",11270544,8323475,14573606,6200000,5170339],["1235848669000305",6167791,6390396,8945306,14208919,6156870],["1245012862000307",6308160,6366109,8730968,7813195,11315141],["1254007642000307",1143525,3628177,6981086,8076760,3922970],["1255578439000306",6964847,6068230,14093143,15046409,10728047],["1259993473000307",5845737,5514982,7913731,6504421,3943248],["1260916792000307",4665907,3044928,3789721,4283024,3651109],["1264944385000305",9694435,6790755,10794145,13210750,6928132],["1269393653000309",7521130,6581391,6697991,22652836,9057033],["1271741733000307",7365041,5880839,7021666,7903960,6367873],["1275950137000307",4256034,5293696,16475322,11528783,7705834],["1278830352000305",7170892,7330588,9776280,8850674,7988471],["1284726833000307",6869591,6299458,6587175,9642548,6543415],["1290882595000319",4741695,7314138,10674598,14535934,9576788],["1292489582000306",21737942,8125966,19222368,35815100,10161228],["1293365641000307",0,0,0,0,0],["1302347333000307",20098707,6103600,6378345,13506843,10424555],["1305058588000307",8213272,6949295,4333725,6792735,477360],["1315195263000309",7636898,6018592,7871764,11547593,4546132],["1319071558000319",19200975,8121983,6899592,12905738,6531430],["1322987059000309",13595963,9069406,11088097,14208400,6611325],["1323698079000305",6053287,6635341,15198213,17511418,6362252],["1332767458000307",6113452,3252240,6306580,8626432,3515039],["1340058842000305",9049812,6093935,7895637,7151067,10767545],["1341369741000307",3930748,3209904,3043403,6726130,4524722],["1353240723000307",7485840,6571935,11818685,9341750,15838326],["1354639616000315",0,11706097,18511133,35636433,16434999],["1356890256000319",23601192,8095354,32235994,10226053,12977687],["1362553825000307",8944225,4717586,4375659,11708373,3670016],["1364876227000319",15571432,6870026,16204356,41749589,13436312],["1366742687000307",3079140,3733404,7049698,6287345,599040],["1374694742000307",6019399,7557631,12598936,11804158,16643624],["1384278549000307",25388752,6815072,8562996,7559856,8514945],["1399439545000319",3972810,6304546,11133599,10893913,7086833],["1399722746000309",1261119,3090890,1730482,6245333,2434946],["1410131326000309",15608190,6257428,6039695,28058573,18396520],["1410970014000307",6321213,6090894,6824868,12731518,2232253],["1416860177000315",8049061,7281030,3677557,26407046,6242805],["1425025123000307",6976668,6089109,21111451,8261801,6010869],["1426725246000309",0,0,0,0,6844224],["1431988754000319",2740982,4923611,3524902,6359119,3240994],["1434548666000307",14637731,6008350,17186011,9615557,6064650],["1435777818000307",6144226,3677228,7842059,12710024,3246641],["1436455841000309",7138281,7709246,11867968,30142717,8260361],["1440795972000307",14033247,6015447,4215956,14243642,2251426],["1445137831000307",6510800,3779475,7145508,11069895,1186091],["1451552060000307",5874221,6011947,9619627,15108768,552006],["1451654799000307",7179558,6059600,3389957,7023150,7799828],["1472581813000307",9432802,6312748,13673299,5508746,1953252],["1475056221000305",10707411,8752579,15430538,21256579,18421652],["1485972148000309",3529409,5103871,6047367,8598934,8545833],["1487034469000301",6338372,6530124,9101633,14754645,7628877],["1519333099000307",17422703,6468204,7589174,16303630,6478012],["1522095180000307",6525800,4950415,8627880,12038292,3266195],["1524896695000307",6800616,6786142,8090455,4147500,6579774],["1527622752000307",3162049,1231104,4371112,13399075,8062853],["1530118819000307",7577179,6122228,8260480,11005400,6141139]]')),
expanded AS (
  SELECT json_extract(value,'$[0]') AS uid,1 AS day_index,json_extract(value,'$[1]') AS score FROM source,json_each(source.payload)
  UNION ALL SELECT json_extract(value,'$[0]'),2,json_extract(value,'$[2]') FROM source,json_each(source.payload)
  UNION ALL SELECT json_extract(value,'$[0]'),3,json_extract(value,'$[3]') FROM source,json_each(source.payload)
  UNION ALL SELECT json_extract(value,'$[0]'),4,json_extract(value,'$[4]') FROM source,json_each(source.payload)
  UNION ALL SELECT json_extract(value,'$[0]'),5,json_extract(value,'$[5]') FROM source,json_each(source.payload)
)
INSERT INTO duel_daily(cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash)
SELECT w.cycle_id,w.cycle_week,w.week_id,w.week_start_time,e.day_index,e.uid,w.name_at_capture,e.score,
  'historical_completed_days_recovery',25,'2026-08-08T18:34:36.767Z',w.alliance_id,w.alliance_abbr,w.alliance_name,w.server_id,w.country,
  'recovery:0201:'||e.uid||':d'||e.day_index
FROM expanded e JOIN duel_weekly w ON w.cycle_id='2026-08-02' AND w.cycle_week=1 AND w.uid=e.uid
WHERE 1
ON CONFLICT(cycle_id,cycle_week,day_index,uid) DO UPDATE SET
  week_id=excluded.week_id,week_start_time=excluded.week_start_time,name_at_capture=excluded.name_at_capture,
  score=excluded.score,score_source=excluded.score_source,source_priority=excluded.source_priority,
  captured_at=CASE WHEN duel_daily.captured_at>excluded.captured_at THEN duel_daily.captured_at ELSE excluded.captured_at END,
  alliance_id=excluded.alliance_id,alliance_abbr=excluded.alliance_abbr,alliance_name=excluded.alliance_name,
  server_id=excluded.server_id,country=excluded.country,source_hash=excluded.source_hash;

INSERT INTO duel_daily(cycle_id,cycle_week,week_id,week_start_time,day_index,uid,name_at_capture,score,score_source,source_priority,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash)
SELECT w.cycle_id,w.cycle_week,w.week_id,w.week_start_time,6,w.uid,w.name_at_capture,MAX(w.score-SUM(d.score),0),
  'weekly_final_delta',30,w.captured_at,w.alliance_id,w.alliance_abbr,w.alliance_name,w.server_id,w.country,'derived:weekly-final:'||w.source_hash
FROM duel_weekly w JOIN duel_daily d ON d.cycle_id=w.cycle_id AND d.cycle_week=w.cycle_week AND d.uid=w.uid AND d.day_index BETWEEN 1 AND 5
WHERE w.cycle_id='2026-08-02' AND w.cycle_week=1
GROUP BY w.cycle_id,w.cycle_week,w.week_id,w.week_start_time,w.uid,w.name_at_capture,w.score,w.captured_at,w.alliance_id,w.alliance_abbr,w.alliance_name,w.server_id,w.country,w.source_hash
HAVING COUNT(DISTINCT d.day_index)=5
ON CONFLICT(cycle_id,cycle_week,day_index,uid) DO UPDATE SET
  week_id=excluded.week_id,week_start_time=excluded.week_start_time,name_at_capture=excluded.name_at_capture,
  score=excluded.score,score_source=excluded.score_source,source_priority=excluded.source_priority,captured_at=excluded.captured_at,
  alliance_id=excluded.alliance_id,alliance_abbr=excluded.alliance_abbr,alliance_name=excluded.alliance_name,
  server_id=excluded.server_id,country=excluded.country,source_hash=excluded.source_hash;

-- Main State Ruler total leaderboard format: [uid,score,position].
WITH source(payload) AS (VALUES('[["1009380703000305",8846399,5],["1004427197000305",7308344,8],["1374694742000307",6524183,11],["1416860177000315",6498425,12],["1340058842000305",6309920,13],["1255578439000306",5855071,15],["1269393653000309",5354132,18],["1235208610000319",5271603,20],["1485972148000309",4939533,26],["1364876227000319",4441772,31],["1029340881000307",4207126,36],["1081888866000307",3983211,44],["1023306812000305",3982318,45],["1278830352000305",3795196,54],["1006557479000307",3678257,59],["1475056221000305",3563153,65],["1224097952000307",3558257,66],["1436455841000309",3506374,73],["1014818174000319",3402115,80],["1097847447000307",3235311,89],["1219357175000305",3137115,95],["1284726833000307",3134621,96],["1425025123000307",3121805,97]]')),
recovered AS (
  SELECT json_extract(value,'$[0]') AS uid,json_extract(value,'$[1]') AS score,json_extract(value,'$[2]') AS position
  FROM source,json_each(source.payload)
)
INSERT INTO event_week_scores(event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,source_command,captured_at,source_hash,metadata_json)
SELECT 'state_ruler','2026-08-02',1,r.uid,r.score,r.score,'leaderboard',r.position,'server.battle.user.score.rank',
  '2026-08-08T17:20:35.941Z','historical:svs:user-score:'||r.uid,
  '{"rankingScope":"partial_main_user_score_leaderboard","historicalRecovery":true,"leaderboardComplete":false}'
FROM recovered r JOIN players p ON p.uid=r.uid
WHERE 1
ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
  raw_score=MAX(COALESCE(event_week_scores.raw_score,0),excluded.raw_score),
  credited_score=MAX(event_week_scores.credited_score,excluded.credited_score),
  credit_source=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,0) THEN 'leaderboard' ELSE event_week_scores.credit_source END,
  leaderboard_position=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,0) THEN excluded.leaderboard_position ELSE event_week_scores.leaderboard_position END,
  source_command=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,0) THEN excluded.source_command ELSE event_week_scores.source_command END,
  captured_at=MAX(event_week_scores.captured_at,excluded.captured_at),
  source_hash=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,0) THEN excluded.source_hash ELSE event_week_scores.source_hash END,
  metadata_json=CASE WHEN excluded.raw_score>=COALESCE(event_week_scores.raw_score,0) THEN excluded.metadata_json ELSE event_week_scores.metadata_json END;

WITH source(payload) AS (VALUES('[["1009380703000305",8846399,5],["1004427197000305",7308344,8],["1374694742000307",6524183,11],["1416860177000315",6498425,12],["1340058842000305",6309920,13],["1255578439000306",5855071,15],["1269393653000309",5354132,18],["1235208610000319",5271603,20],["1485972148000309",4939533,26],["1364876227000319",4441772,31],["1029340881000307",4207126,36],["1081888866000307",3983211,44],["1023306812000305",3982318,45],["1278830352000305",3795196,54],["1006557479000307",3678257,59],["1475056221000305",3563153,65],["1224097952000307",3558257,66],["1436455841000309",3506374,73],["1014818174000319",3402115,80],["1097847447000307",3235311,89],["1219357175000305",3137115,95],["1284726833000307",3134621,96],["1425025123000307",3121805,97]]')),
recovered AS (SELECT json_extract(value,'$[0]') AS uid,json_extract(value,'$[1]') AS score FROM source,json_each(source.payload))
INSERT INTO event_scores(event_type,event_id,uid,score,captured_at,source_hash,metadata_json)
SELECT 'state_ruler','2026-08-02:W1',r.uid,r.score,'2026-08-08T17:20:35.941Z','historical:svs:user-score:'||r.uid,
  '{"rankingScope":"partial_main_user_score_leaderboard","historicalRecovery":true}'
FROM recovered r JOIN players p ON p.uid=r.uid
WHERE 1
ON CONFLICT(event_type,event_id,uid) DO UPDATE SET
  score=MAX(event_scores.score,excluded.score),captured_at=MAX(event_scores.captured_at,excluded.captured_at),
  source_hash=CASE WHEN excluded.score>=event_scores.score THEN excluded.source_hash ELSE event_scores.source_hash END,
  metadata_json=CASE WHEN excluded.score>=event_scores.score THEN excluded.metadata_json ELSE event_scores.metadata_json END;
