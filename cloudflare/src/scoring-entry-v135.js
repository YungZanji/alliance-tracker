import portal from './scoring-entry-v134.js';

const PRIMARY_ALLIANCE = 'WDZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      return handleSync(request, env, ctx);
    }

    if (url.pathname === '/api/duel' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      return attachLeagueTotals(response, env);
    }

    if (url.pathname === '/api/state-ruler' && request.method === 'GET') {
      return handlePersistentStateRuler(request, env, ctx);
    }

    if (url.pathname === '/api/glory-war' && request.method === 'GET') {
      return handlePersistentGloryWar(request, env, ctx);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function handleSync(request, env, ctx) {
  let body;
  try {
    body = await request.clone().json();
  } catch (_) {
    return portal.fetch(request, env, ctx);
  }

  const originalSnapshots = Array.isArray(body?.snapshots) ? body.snapshots : [];
  const leagueSnapshots = originalSnapshots.filter(snapshot =>
    snapshot?.dataset === 'alliance_duel_rankings'
    && String(snapshot?.context?.rankTypeLabel || '') === 'weekly_own_alliance'
  );
  const leagueKeys = new Set(leagueSnapshots.map(snapshot => snapshot));

  // rankType 2 is NOT the current week. It is the cumulative four-week Duel League
  // leaderboard. Keep it away from the legacy duel_weekly collector entirely.
  body.snapshots = originalSnapshots.map(snapshot => {
    if (!leagueKeys.has(snapshot)) return snapshot;
    return {
      ...snapshot,
      dataset: 'alliance_duel_league_totals',
      context: {
        ...(snapshot.context || {}),
        originalDataset: 'alliance_duel_rankings',
        scoreScope: 'duel_league_cumulative',
      },
    };
  });

  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const response = await portal.fetch(forwarded, env, ctx);
  if (!response.ok || !leagueSnapshots.length) return response;

  try {
    const result = await response.clone().json();
    const cycleId = String(result?.cycleId || '').trim();
    const cycleWeek = Number(result?.cycleWeek || 0);
    if (cycleId && cycleWeek >= 1 && cycleWeek <= 4) {
      await ingestLeagueTotals(leagueSnapshots, cycleId, cycleWeek, env);
    }
  } catch (error) {
    console.error('Duel League total ingestion failed', error);
  }
  return response;
}

async function ingestLeagueTotals(snapshots, cycleId, cycleWeek, env) {
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const best = new Map();
  for (const snapshot of snapshots) {
    const capturedAt = String(snapshot.captured_at || snapshot.capturedAt || new Date().toISOString());
    const sourceHash = String(snapshot.source_hash || snapshot.sourceHash || '');
    for (const raw of Array.isArray(snapshot.rows) ? snapshot.rows : []) {
      if (String(raw?.allianceAbbr || '') !== primary) continue;
      const uid = String(raw?.uid || '').trim();
      if (!uid) continue;
      const candidate = {
        uid,
        name: String(raw?.name || ''),
        score: Number(raw?.score || 0),
        position: Number(raw?.position || 0),
        capturedAt,
        sourceHash,
        allianceId: String(raw?.allianceId || ''),
        allianceAbbr: String(raw?.allianceAbbr || ''),
        allianceName: String(raw?.allianceName || ''),
        serverId: Number(raw?.serverId || 0),
        country: String(raw?.country || ''),
      };
      const current = best.get(uid);
      if (!current || candidate.capturedAt >= current.capturedAt) best.set(uid, candidate);
    }
  }
  if (!best.size) return;

  const weeklyMeta = await env.DB.prepare(`
    SELECT week_id,week_start_time FROM duel_weekly
    WHERE cycle_id=? AND cycle_week=? ORDER BY captured_at DESC LIMIT 1
  `).bind(cycleId, cycleWeek).first();
  const weekId = String(weeklyMeta?.week_id || '');
  const weekStartTime = Number(weeklyMeta?.week_start_time || 0);
  const statements = [];
  for (const row of best.values()) {
    statements.push(env.DB.prepare(`
      INSERT INTO duel_league_total(
        cycle_id,cycle_week,week_id,week_start_time,uid,name_at_capture,score,position,
        score_source,captured_at,alliance_id,alliance_abbr,alliance_name,server_id,country,source_hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cycle_id,cycle_week,uid) DO UPDATE SET
        week_id=excluded.week_id,
        week_start_time=excluded.week_start_time,
        name_at_capture=excluded.name_at_capture,
        score=excluded.score,
        position=excluded.position,
        score_source=excluded.score_source,
        captured_at=excluded.captured_at,
        alliance_id=excluded.alliance_id,
        alliance_abbr=excluded.alliance_abbr,
        alliance_name=excluded.alliance_name,
        server_id=excluded.server_id,
        country=excluded.country,
        source_hash=excluded.source_hash
      WHERE excluded.captured_at >= duel_league_total.captured_at
    `).bind(
      cycleId, cycleWeek, weekId, weekStartTime, row.uid, row.name, row.score, row.position,
      'weekly_own_alliance', row.capturedAt, row.allianceId, row.allianceAbbr,
      row.allianceName, row.serverId, row.country, row.sourceHash
    ));
  }
  await runBatches(env.DB, statements, 60);
}

async function attachLeagueTotals(response, env) {
  try {
    const body = await response.json();
    const cycleId = String(body?.cycleId || '').trim();
    const cycleWeek = Number(body?.cycleWeek || 0);
    if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return json(body, response.status);

    const result = await env.DB.prepare(`
      SELECT p.public_id,l.score,l.position,l.captured_at
      FROM duel_league_total l JOIN players p ON p.uid=l.uid
      WHERE l.cycle_id=? AND l.cycle_week=?
    `).bind(cycleId, cycleWeek).all();
    const league = new Map((result.results || []).map(row => [String(row.public_id), row]));
    for (const player of body.players || []) {
      const row = league.get(String(player.publicId || ''));
      player.duelLeagueTotal = Number(row?.score || 0);
      player.duelLeaguePosition = Number(row?.position || 0);
      player.duelLeagueCapturedAt = String(row?.captured_at || '');
    }
    body.summary = {
      ...(body.summary || {}),
      duelLeagueTotal: (body.players || []).reduce((sum, row) => sum + Number(row.duelLeagueTotal || 0), 0),
    };
    body.scoreSemantics = {
      weeklyTotal: 'Current Duel week only (rankType 1 / weekly_combined; daily sum is the fallback repair source).',
      duelLeagueTotal: 'Cumulative score across the active four-week Duel League (rankType 2 / weekly_own_alliance).',
    };
    return json(body, response.status);
  } catch (_) {
    return response;
  }
}

async function handlePersistentStateRuler(request, env, ctx) {
  const url = new URL(request.url);
  const hasExplicitSelection = Boolean(url.searchParams.get('cycle') || url.searchParams.get('week'));
  if (!hasExplicitSelection) {
    const latest = await latestEventWeek(env, 'state_ruler');
    if (latest) {
      url.searchParams.set('cycle', latest.cycleId);
      url.searchParams.set('week', String(latest.cycleWeek));
      const forwarded = new Request(url.toString(), {
        method: 'GET',
        headers: request.headers,
      });
      return portal.fetch(forwarded, env, ctx);
    }
  }
  return portal.fetch(request, env, ctx);
}

async function handlePersistentGloryWar(request, env, ctx) {
  const authUrl = new URL(request.url);
  authUrl.pathname = '/api/auth/me';
  authUrl.search = '';
  const gate = await portal.fetch(new Request(authUrl.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  if (!gate.ok) return gate;

  const url = new URL(request.url);
  let cycleId = String(url.searchParams.get('cycle') || '').trim();
  let cycleWeek = Number(url.searchParams.get('week') || 0);
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    const latest = await latestEventWeek(env, 'glory_war');
    cycleId = latest?.cycleId || '';
    cycleWeek = latest?.cycleWeek || 0;
  }
  if (!cycleId || cycleWeek < 1 || cycleWeek > 4) {
    return json({ ok: true, cycleId: '', cycleWeek: 0, players: [], summary: {}, latestKnown: false });
  }

  const rows = await env.DB.prepare(`
    SELECT p.public_id,p.current_name,p.alliance_abbr,p.server_id,s.raw_score,s.credited_score,s.credit_source,s.captured_at
    FROM event_week_scores s JOIN players p ON p.uid=s.uid
    WHERE s.event_type='glory_war' AND s.cycle_id=? AND s.cycle_week=?
    ORDER BY s.credited_score DESC,p.current_name ASC
  `).bind(cycleId, cycleWeek).all();
  const players = (rows.results || []).map((row, index) => ({
    rank: index + 1,
    publicId: String(row.public_id || ''),
    name: String(row.current_name || ''),
    allianceAbbr: String(row.alliance_abbr || ''),
    serverId: Number(row.server_id || 0),
    rawScore: row.raw_score == null ? null : Number(row.raw_score),
    creditedScore: Number(row.credited_score || 0),
    creditSource: String(row.credit_source || ''),
    latestCapture: String(row.captured_at || ''),
  }));
  return json({
    ok: true,
    cycleId,
    cycleWeek,
    players,
    latestKnown: players.length > 0,
    summary: {
      players: players.length,
      topScore: Number(players[0]?.creditedScore || 0),
      latestCapture: players.reduce((latest, row) => row.latestCapture > latest ? row.latestCapture : latest, ''),
    },
  });
}

async function latestEventWeek(env, eventType) {
  const row = await env.DB.prepare(`
    SELECT cycle_id,cycle_week,MAX(captured_at) AS latest_capture
    FROM event_week_scores
    WHERE event_type=? AND credited_score>0
    GROUP BY cycle_id,cycle_week
    ORDER BY latest_capture DESC
    LIMIT 1
  `).bind(eventType).first();
  if (!row) return null;
  return {
    cycleId: String(row.cycle_id || ''),
    cycleWeek: Number(row.cycle_week || 0),
    latestCapture: String(row.latest_capture || ''),
  };
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
