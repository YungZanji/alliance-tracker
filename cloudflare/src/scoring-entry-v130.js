import portal from './roster-entry.js';

const SESSION_COOKIE = 'at_session';
const PRIMARY_ALLIANCE = 'WDZ';
const EVENT_TYPES = new Set(['alliance_duel', 'state_ruler', 'glory_war']);
const WEEKS_PER_CYCLE = 4;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/sync' && request.method === 'POST') {
        const mirror = request.clone();
        const response = await portal.fetch(request, env, ctx);
        if (response.ok) {
          try {
            const [body, syncResult] = await Promise.all([
              mirror.json(),
              response.clone().json().catch(() => ({})),
            ]);
            await ingestEventSnapshots(body, syncResult, env);
          } catch (error) {
            console.error('1.3 event scoring ingestion failed', error);
          }
        }
        return response;
      }

      if (url.pathname === '/api/participation' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        return auth.response || handleParticipationV130(env);
      }
      if (url.pathname === '/api/state-ruler' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        return auth.response || handleStateRuler(url, env);
      }
      if (url.pathname === '/api/event-week-policy' && request.method === 'GET') {
        const auth = await requireUser(request, env);
        return auth.response || handleEventWeekPolicy(url, env);
      }
      if (url.pathname === '/api/admin/event-week-policy' && request.method === 'POST') {
        const auth = await requireAdmin(request, env);
        return auth.response || handleEventWeekPolicyUpdate(request, env, auth.user);
      }
      if (url.pathname === '/api/admin/state-ruler-attendance' && request.method === 'POST') {
        const auth = await requireAdmin(request, env);
        return auth.response || handleStateRulerAttendanceUpdate(request, env, auth.user);
      }
      if (url.pathname === '/api/admin/scoring-context' && request.method === 'GET') {
        const auth = await requireAdmin(request, env);
        return auth.response || handleScoringContext(url, env);
      }
      return portal.fetch(request, env, ctx);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: String(error?.message || error) }, 500);
    }
  }
};

async function ingestEventSnapshots(body, syncResult, env) {
  const cycleId = String(syncResult?.cycleId || '').trim();
  const cycleWeek = Number(syncResult?.cycleWeek || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > WEEKS_PER_CYCLE) return;
  const snapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  await Promise.all([
    ingestStateRulerRankings(snapshots, cycleId, cycleWeek, env),
    ingestAttendanceEvidence(snapshots, cycleId, cycleWeek, env),
  ]);
}

async function ingestStateRulerRankings(snapshots, cycleId, cycleWeek, env) {
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim().toLowerCase();
  const relevant = snapshots.filter(snapshot => snapshot?.dataset === 'state_ruler_rankings');
  if (!relevant.length) return;

  const best = new Map();
  for (const snapshot of relevant) {
    const command = String(snapshot.command || '');
    const capturedAt = String(snapshot.captured_at || snapshot.capturedAt || new Date().toISOString());
    const sourceHash = String(snapshot.source_hash || snapshot.sourceHash || '');
    const scope = String(snapshot?.context?.rankingScope || 'partial_leaderboard');
    for (const row of Array.isArray(snapshot.rows) ? snapshot.rows : []) {
      const uid = String(row?.uid || '').trim();
      if (!uid) continue;
      const abbr = String(row?.allianceAbbr || '').trim().toLowerCase();
      if (abbr && abbr !== primary) continue;
      const score = Number(row?.score || 0);
      const candidate = {
        uid,
        name: String(row?.name || ''),
        score: Number.isFinite(score) ? score : 0,
        position: Number(row?.position || 0) || null,
        command,
        capturedAt,
        sourceHash,
        scope,
      };
      const current = best.get(uid);
      if (!current || candidate.score > current.score || (candidate.score === current.score && candidate.capturedAt > current.capturedAt)) {
        best.set(uid, candidate);
      }
    }
  }
  if (!best.size) return;

  const knownResult = await env.DB.prepare('SELECT uid FROM players').all();
  const known = new Set((knownResult.results || []).map(row => String(row.uid)));
  const statements = [];
  const eventId = `${cycleId}:W${cycleWeek}`;
  for (const row of best.values()) {
    if (!known.has(row.uid)) continue;
    const metadata = JSON.stringify({ rankingScope: row.scope, incompleteLeaderboard: true });
    statements.push(env.DB.prepare(`
      INSERT INTO event_week_scores(event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,source_command,captured_at,source_hash,metadata_json)
      VALUES('state_ruler',?,?,?,?,?,'leaderboard',?,?,?,?,?)
      ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
        raw_score=CASE WHEN excluded.raw_score > COALESCE(event_week_scores.raw_score,-1) THEN excluded.raw_score ELSE event_week_scores.raw_score END,
        credited_score=CASE WHEN excluded.raw_score > COALESCE(event_week_scores.raw_score,-1) THEN excluded.raw_score ELSE MAX(event_week_scores.credited_score,excluded.credited_score) END,
        credit_source=CASE WHEN excluded.raw_score >= COALESCE(event_week_scores.raw_score,-1) THEN 'leaderboard' ELSE event_week_scores.credit_source END,
        leaderboard_position=CASE WHEN excluded.raw_score >= COALESCE(event_week_scores.raw_score,-1) THEN excluded.leaderboard_position ELSE event_week_scores.leaderboard_position END,
        source_command=CASE WHEN excluded.raw_score >= COALESCE(event_week_scores.raw_score,-1) THEN excluded.source_command ELSE event_week_scores.source_command END,
        captured_at=CASE WHEN excluded.captured_at > event_week_scores.captured_at THEN excluded.captured_at ELSE event_week_scores.captured_at END,
        source_hash=CASE WHEN excluded.raw_score >= COALESCE(event_week_scores.raw_score,-1) THEN excluded.source_hash ELSE event_week_scores.source_hash END,
        metadata_json=CASE WHEN excluded.raw_score >= COALESCE(event_week_scores.raw_score,-1) THEN excluded.metadata_json ELSE event_week_scores.metadata_json END
    `).bind(cycleId, cycleWeek, row.uid, row.score, row.score, row.position, row.command, row.capturedAt, row.sourceHash, metadata));
    statements.push(env.DB.prepare(`
      INSERT INTO event_scores(event_type,event_id,uid,score,captured_at,source_hash,metadata_json)
      VALUES('state_ruler',?,?,?,?,?,?)
      ON CONFLICT(event_type,event_id,uid) DO UPDATE SET
        score=MAX(event_scores.score,excluded.score),
        captured_at=CASE WHEN excluded.captured_at > event_scores.captured_at THEN excluded.captured_at ELSE event_scores.captured_at END,
        source_hash=CASE WHEN excluded.score >= event_scores.score THEN excluded.source_hash ELSE event_scores.source_hash END,
        metadata_json=CASE WHEN excluded.score >= event_scores.score THEN excluded.metadata_json ELSE event_scores.metadata_json END
    `).bind(eventId, row.uid, row.score, row.capturedAt, row.sourceHash, metadata));
  }
  await runBatches(env.DB, statements, 60);
}

async function ingestAttendanceEvidence(snapshots, cycleId, cycleWeek, env) {
  const rows = snapshots
    .filter(snapshot => snapshot?.dataset === 'state_ruler_attendance')
    .flatMap(snapshot => (Array.isArray(snapshot.rows) ? snapshot.rows : []).map(row => ({
      ...row,
      capturedAt: String(snapshot.captured_at || snapshot.capturedAt || new Date().toISOString()),
    })));
  for (const row of rows) {
    const uid = String(row?.uid || '').trim();
    if (!uid) continue;
    await upsertAttendance(env, {
      cycleId,
      cycleWeek,
      uid,
      attended: Boolean(row?.attended),
      lastOnlineAt: String(row?.lastOnlineAt || ''),
      windowStart: String(row?.windowStart || ''),
      windowEnd: String(row?.windowEnd || ''),
      source: String(row?.source || 'captured_last_online'),
      note: '',
      updatedByUid: null,
      updatedAt: row.capturedAt,
    });
  }
}

async function handleStateRuler(url, env) {
  const { cycleId, cycleWeek } = await resolveCycleWeek(url, env);
  if (!cycleId) return json({ ok: true, cycleId: '', cycleWeek: 1, players: [], summary: {}, dataQuality: { status: 'empty' } });

  const [scoresResult, attendanceResult, policyResult, floor] = await Promise.all([
    env.DB.prepare(`
      SELECT p.public_id,p.current_name,p.alliance_abbr,p.server_id,s.uid,s.raw_score,s.credited_score,s.credit_source,
             s.leaderboard_position,s.source_command,s.captured_at
      FROM event_week_scores s JOIN players p ON p.uid=s.uid
      WHERE s.event_type='state_ruler' AND s.cycle_id=? AND s.cycle_week=?
    `).bind(cycleId, cycleWeek).all(),
    env.DB.prepare(`
      SELECT p.public_id,a.uid,a.attended,a.last_online_at,a.window_start,a.window_end,a.source,a.note,a.updated_at
      FROM event_attendance_evidence a JOIN players p ON p.uid=a.uid
      WHERE a.event_type='state_ruler' AND a.cycle_id=? AND a.cycle_week=?
    `).bind(cycleId, cycleWeek).all(),
    policyFor(env, 'state_ruler', cycleId, cycleWeek),
    numericSetting(env, 'state_ruler_attendance_floor', 2250000),
  ]);

  const attendance = new Map((attendanceResult.results || []).map(row => [String(row.uid), row]));
  const top = Math.max(0, ...(scoresResult.results || []).map(row => Number(row.credited_score || 0)));
  const players = (scoresResult.results || []).map(row => {
    const evidence = attendance.get(String(row.uid));
    const credited = Number(row.credited_score || 0);
    return {
      publicId: String(row.public_id || ''),
      name: String(row.current_name || ''),
      allianceAbbr: String(row.alliance_abbr || ''),
      serverId: Number(row.server_id || 0),
      rawScore: row.raw_score == null ? null : Number(row.raw_score),
      creditedScore: credited,
      creditSource: String(row.credit_source || ''),
      leaderboardPosition: row.leaderboard_position == null ? null : Number(row.leaderboard_position),
      sourceCommand: String(row.source_command || ''),
      normalizedIndex: top > 0 ? Number((credited * 100 / top).toFixed(2)) : 0,
      attended: Number(evidence?.attended || 0) === 1,
      lastOnlineAt: String(evidence?.last_online_at || ''),
      attendanceSource: String(evidence?.source || ''),
      latestCapture: String(row.captured_at || evidence?.updated_at || ''),
    };
  });
  players.sort((a, b) => b.creditedScore - a.creditedScore || a.name.localeCompare(b.name));
  players.forEach((row, index) => row.rank = index + 1);
  return json({
    ok: true,
    cycleId,
    cycleWeek,
    players,
    policy: policyResult,
    summary: {
      players: players.length,
      leaderboardPlayers: players.filter(row => row.creditSource === 'leaderboard').length,
      attendanceOnly: players.filter(row => row.creditSource === 'attendance_minimum').length,
      topScore: top,
      attendanceFloor: floor,
      isBye: Boolean(policyResult.isBye),
      weightMultiplier: policyResult.weightMultiplier,
    },
    dataQuality: {
      status: players.length ? 'partial' : 'empty',
      leaderboardComplete: false,
      note: 'State Ruler game feeds observed so far are partial/top ranking feeds. Attendance evidence can fill participation credit without pretending those players appeared on the leaderboard.'
    }
  });
}

async function handleEventWeekPolicy(url, env) {
  const { cycleId, cycleWeek } = await resolveCycleWeek(url, env);
  const requestedType = String(url.searchParams.get('eventType') || '').trim();
  const types = EVENT_TYPES.has(requestedType) ? [requestedType] : [...EVENT_TYPES];
  const policies = [];
  if (cycleId) {
    for (const eventType of types) {
      for (let week = 1; week <= WEEKS_PER_CYCLE; week += 1) {
        policies.push(await policyFor(env, eventType, cycleId, week));
      }
    }
  }
  const settings = await scoringSettings(env);
  return json({ ok: true, cycleId, cycleWeek, policies, settings });
}

async function handleEventWeekPolicyUpdate(request, env, user) {
  const body = await request.json();
  const eventType = String(body?.eventType || '').trim();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const isBye = Boolean(body?.isBye);
  const defaultBye = await numericSetting(env, 'bye_week_multiplier', 0.5);
  let multiplier = Number(body?.weightMultiplier);
  if (!Number.isFinite(multiplier)) multiplier = isBye ? defaultBye : 1;
  multiplier = Math.max(0, Math.min(2, multiplier));
  const note = String(body?.note || '').trim().slice(0, 300);
  if (!EVENT_TYPES.has(eventType) || !cycleId || cycleWeek < 1 || cycleWeek > WEEKS_PER_CYCLE) {
    return json({ ok: false, error: 'Choose a valid event, cycle and week.' }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_week_policy(event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at,updated_by_uid)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET
      is_bye=excluded.is_bye,weight_multiplier=excluded.weight_multiplier,note=excluded.note,
      updated_at=excluded.updated_at,updated_by_uid=excluded.updated_by_uid
  `).bind(eventType, cycleId, cycleWeek, isBye ? 1 : 0, multiplier, note, now, user.uid).run();
  return json({ ok: true, policy: await policyFor(env, eventType, cycleId, cycleWeek) });
}

async function handleStateRulerAttendanceUpdate(request, env, user) {
  const body = await request.json();
  const cycleId = String(body?.cycleId || '').trim().slice(0, 120);
  const cycleWeek = Number(body?.cycleWeek || 0);
  const publicId = String(body?.publicId || '').trim();
  if (!cycleId || cycleWeek < 1 || cycleWeek > WEEKS_PER_CYCLE || !publicId) {
    return json({ ok: false, error: 'Choose a State Ruler week and player.' }, 400);
  }
  const player = await env.DB.prepare('SELECT uid FROM players WHERE public_id=?').bind(publicId).first();
  if (!player) return json({ ok: false, error: 'Player was not found.' }, 404);
  await upsertAttendance(env, {
    cycleId,
    cycleWeek,
    uid: String(player.uid),
    attended: Boolean(body?.attended),
    lastOnlineAt: String(body?.lastOnlineAt || ''),
    windowStart: String(body?.windowStart || ''),
    windowEnd: String(body?.windowEnd || ''),
    source: 'admin',
    note: String(body?.note || '').trim().slice(0, 240),
    updatedByUid: user.uid,
    updatedAt: new Date().toISOString(),
  });
  return json({ ok: true });
}

async function upsertAttendance(env, evidence) {
  const now = evidence.updatedAt || new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO event_attendance_evidence(event_type,cycle_id,cycle_week,uid,attended,last_online_at,window_start,window_end,source,note,updated_at,updated_by_uid)
    VALUES('state_ruler',?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
      attended=excluded.attended,last_online_at=excluded.last_online_at,window_start=excluded.window_start,
      window_end=excluded.window_end,source=excluded.source,note=excluded.note,updated_at=excluded.updated_at,
      updated_by_uid=excluded.updated_by_uid
  `).bind(evidence.cycleId, evidence.cycleWeek, evidence.uid, evidence.attended ? 1 : 0,
    evidence.lastOnlineAt || null, evidence.windowStart || null, evidence.windowEnd || null,
    evidence.source || 'manual', evidence.note || '', now, evidence.updatedByUid || null).run();

  const existing = await env.DB.prepare(`
    SELECT raw_score,credited_score,credit_source,captured_at,source_hash
    FROM event_week_scores WHERE event_type='state_ruler' AND cycle_id=? AND cycle_week=? AND uid=?
  `).bind(evidence.cycleId, evidence.cycleWeek, evidence.uid).first();
  if (existing?.raw_score != null) return;

  if (!evidence.attended) {
    if (existing?.credit_source === 'attendance_minimum') {
      await env.DB.prepare(`DELETE FROM event_week_scores WHERE event_type='state_ruler' AND cycle_id=? AND cycle_week=? AND uid=?`)
        .bind(evidence.cycleId, evidence.cycleWeek, evidence.uid).run();
    }
    return;
  }
  const floor = await numericSetting(env, 'state_ruler_attendance_floor', 2250000);
  await env.DB.prepare(`
    INSERT INTO event_week_scores(event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,source_command,captured_at,source_hash,metadata_json)
    VALUES('state_ruler',?,?,?,NULL,?,'attendance_minimum',NULL,'attendance',?,'attendance',?)
    ON CONFLICT(event_type,cycle_id,cycle_week,uid) DO UPDATE SET
      credited_score=CASE WHEN event_week_scores.raw_score IS NULL THEN excluded.credited_score ELSE event_week_scores.credited_score END,
      credit_source=CASE WHEN event_week_scores.raw_score IS NULL THEN 'attendance_minimum' ELSE event_week_scores.credit_source END,
      captured_at=CASE WHEN event_week_scores.raw_score IS NULL THEN excluded.captured_at ELSE event_week_scores.captured_at END,
      metadata_json=CASE WHEN event_week_scores.raw_score IS NULL THEN excluded.metadata_json ELSE event_week_scores.metadata_json END
  `).bind(evidence.cycleId, evidence.cycleWeek, evidence.uid, floor, now,
    JSON.stringify({ attendanceSource: evidence.source || 'manual', minimumCredit: floor })).run();
}

async function handleScoringContext(url, env) {
  const { cycleId, cycleWeek } = await resolveCycleWeek(url, env);
  const [playersResult, policyPayload, ruler] = await Promise.all([
    env.DB.prepare(`SELECT public_id,current_name,alliance_abbr,server_id FROM players WHERE alliance_abbr=? ORDER BY current_name COLLATE NOCASE`)
      .bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all(),
    handleEventWeekPolicy(url, env).then(response => response.json()),
    handleStateRuler(url, env).then(response => response.json()),
  ]);
  return json({
    ok: true,
    cycleId,
    cycleWeek,
    players: (playersResult.results || []).map(row => ({ publicId: row.public_id, name: row.current_name, allianceAbbr: row.alliance_abbr, serverId: Number(row.server_id || 0) })),
    policies: policyPayload.policies || [],
    settings: policyPayload.settings || {},
    stateRuler: ruler,
  });
}

async function handleParticipationV130(env) {
  const weightsResult = await env.DB.prepare('SELECT event_type,label,weight,enabled FROM participation_weights ORDER BY event_type').all();
  const weights = (weightsResult.results || []).map(row => ({
    eventType: String(row.event_type), label: String(row.label), weight: Number(row.weight || 0), enabled: Number(row.enabled || 0) === 1
  }));
  const playersResult = await env.DB.prepare(`
    SELECT uid,public_id,current_name,alliance_abbr,server_id FROM players
    WHERE alliance_abbr=?
  `).bind(String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim()).all();
  const [duelRows, eventRows, policyRows] = await Promise.all([
    env.DB.prepare(`SELECT cycle_id,cycle_week,uid,score FROM duel_weekly`).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,uid,credited_score FROM event_week_scores`).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier FROM event_week_policy`).all(),
  ]);

  const policyMap = new Map((policyRows.results || []).map(row => [weekKey(row.event_type, row.cycle_id, row.cycle_week), Number(row.weight_multiplier || 0)]));
  const rowsByEvent = new Map();
  const push = (eventType, row, score) => {
    if (!rowsByEvent.has(eventType)) rowsByEvent.set(eventType, []);
    rowsByEvent.get(eventType).push({ cycleId: String(row.cycle_id), cycleWeek: Number(row.cycle_week), uid: String(row.uid), score: Number(score || 0) });
  };
  for (const row of duelRows.results || []) push('alliance_duel', row, row.score);
  for (const row of eventRows.results || []) push(String(row.event_type), row, row.credited_score);

  const eventModels = new Map();
  for (const weight of weights) {
    const rows = rowsByEvent.get(weight.eventType) || [];
    const weeks = new Map();
    for (const row of rows) {
      const key = `${row.cycleId}|${row.cycleWeek}`;
      if (!weeks.has(key)) weeks.set(key, { cycleId: row.cycleId, cycleWeek: row.cycleWeek, scores: new Map(), top: 0 });
      const week = weeks.get(key);
      const current = Number(week.scores.get(row.uid) || 0);
      if (row.score > current) week.scores.set(row.uid, row.score);
      week.top = Math.max(week.top, row.score);
    }
    eventModels.set(weight.eventType, weeks);
  }

  const available = {};
  for (const weight of weights) available[weight.eventType] = (eventModels.get(weight.eventType)?.size || 0) > 0;

  const players = (playersResult.results || []).map(player => {
    const components = {};
    let combinedNumerator = 0;
    let combinedDenominator = 0;
    for (const weight of weights) {
      const weeks = eventModels.get(weight.eventType) || new Map();
      let eventNumerator = 0;
      let eventDenominator = 0;
      let rawTotal = 0;
      for (const week of weeks.values()) {
        const raw = Number(week.scores.get(String(player.uid)) || 0);
        rawTotal += raw;
        const index = week.top > 0 ? Math.min(100, raw * 100 / week.top) : 0;
        const multiplier = policyMap.get(weekKey(weight.eventType, week.cycleId, week.cycleWeek)) ?? 1;
        if (multiplier > 0) {
          eventNumerator += index * multiplier;
          eventDenominator += multiplier;
        }
      }
      const eventIndex = eventDenominator ? eventNumerator / eventDenominator : 0;
      components[weight.eventType] = {
        raw: rawTotal,
        index: Number(eventIndex.toFixed(2)),
        available: Boolean(available[weight.eventType]),
        weight: weight.weight,
        weeks: weeks.size,
      };
      if (weight.enabled && available[weight.eventType] && weight.weight > 0) {
        combinedNumerator += eventIndex * weight.weight;
        combinedDenominator += weight.weight;
      }
    }
    return {
      publicId: String(player.public_id || ''),
      name: String(player.current_name || ''),
      allianceAbbr: String(player.alliance_abbr || ''),
      serverId: Number(player.server_id || 0),
      score: combinedDenominator ? Number((combinedNumerator / combinedDenominator).toFixed(2)) : 0,
      components,
    };
  });
  players.sort((a, b) => b.score - a.score || Number(b.components.alliance_duel?.raw || 0) - Number(a.components.alliance_duel?.raw || 0) || a.name.localeCompare(b.name));
  players.forEach((row, index) => row.rank = index + 1);
  return json({
    ok: true,
    players,
    weights,
    availability: available,
    method: 'Each event is normalized week-by-week against that week’s top credited score. Confirmed State Ruler attendance without a leaderboard score receives the configured minimum credit. Bye-week multipliers reduce that week’s influence before the event components are combined with the configured event weights.'
  });
}

async function policyFor(env, eventType, cycleId, cycleWeek) {
  const row = await env.DB.prepare(`
    SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier,note,updated_at
    FROM event_week_policy WHERE event_type=? AND cycle_id=? AND cycle_week=?
  `).bind(eventType, cycleId, cycleWeek).first();
  return {
    eventType,
    cycleId,
    cycleWeek,
    isBye: Number(row?.is_bye || 0) === 1,
    weightMultiplier: row ? Number(row.weight_multiplier || 0) : 1,
    note: String(row?.note || ''),
    updatedAt: String(row?.updated_at || ''),
  };
}

async function scoringSettings(env) {
  const result = await env.DB.prepare('SELECT setting_key,numeric_value,text_value FROM scoring_settings').all();
  const output = {};
  for (const row of result.results || []) {
    output[String(row.setting_key)] = { numericValue: row.numeric_value == null ? null : Number(row.numeric_value), text: String(row.text_value || '') };
  }
  return output;
}

async function numericSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT numeric_value FROM scoring_settings WHERE setting_key=?').bind(key).first();
  const value = Number(row?.numeric_value);
  return Number.isFinite(value) ? value : fallback;
}

async function resolveCycleWeek(url, env) {
  let cycleId = String(url.searchParams.get('cycle') || '').trim();
  if (!cycleId) {
    const latest = await env.DB.prepare(`SELECT cycle_id,MAX(captured_at) AS latest_capture FROM duel_weekly GROUP BY cycle_id ORDER BY latest_capture DESC LIMIT 1`).first();
    cycleId = String(latest?.cycle_id || '');
  }
  let cycleWeek = Number(url.searchParams.get('week') || 0);
  if (cycleId && !(cycleWeek >= 1 && cycleWeek <= WEEKS_PER_CYCLE)) {
    const latest = await env.DB.prepare(`SELECT MAX(cycle_week) AS w FROM duel_weekly WHERE cycle_id=?`).bind(cycleId).first();
    cycleWeek = Math.max(1, Math.min(WEEKS_PER_CYCLE, Number(latest?.w || 1)));
  }
  return { cycleId, cycleWeek: cycleWeek || 1 };
}

async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user || Number(user.login_enabled || 0) !== 1) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  return { user };
}

async function requireAdmin(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth;
  if (Number(auth.user.is_admin || 0) !== 1) return { response: json({ ok: false, error: 'Administrator access is required.' }, 403) };
  return auth;
}

async function getSessionUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256(token);
  return env.DB.prepare(`
    SELECT p.uid,p.public_id,p.current_name,p.is_admin,p.login_enabled
    FROM auth_sessions s JOIN players p ON p.uid=s.uid
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(hash, new Date().toISOString()).first();
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('cookie') || '');
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function weekKey(eventType, cycleId, cycleWeek) {
  return `${eventType}|${cycleId}|${Number(cycleWeek)}`;
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
