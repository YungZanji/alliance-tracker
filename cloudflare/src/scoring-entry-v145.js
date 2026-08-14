import portal from './scoring-entry-v144.js';

const PRIMARY_ALLIANCE = 'WDZ';
const DAY_META = [
  { dayIndex: 1, name: 'Tank Day', weight: 1 },
  { dayIndex: 2, name: 'Build Day', weight: 2 },
  { dayIndex: 3, name: 'Science Day', weight: 2 },
  { dayIndex: 4, name: 'Hero Day', weight: 2 },
  { dayIndex: 5, name: 'Training Day', weight: 2 },
  { dayIndex: 6, name: 'Enemy Buster', weight: 4 },
];
const TOTAL_DAY_WEIGHT = 13;
const WIN_THRESHOLD = 7;
const EVENT_TYPES = ['state_ruler', 'glory_war'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/seasons' && request.method === 'GET') {
      const gate = await requireUser(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await seasonDirectory(env)) });
    }

    if (url.pathname === '/api/admin/seasons' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return json({ ok: true, ...(await adminSeasonDirectory(env)) });
    }

    if (url.pathname === '/api/admin/seasons/save' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return saveSeason(request, env);
    }

    if (url.pathname === '/api/admin/seasons/archive' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return archiveSeason(request, env, ctx);
    }

    if (url.pathname === '/api/admin/seasons/start' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return startSeason(request, env);
    }

    if (url.pathname === '/api/admin/event-availability' && request.method === 'POST') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return updateEventAvailability(request, env);
    }

    if (url.pathname === '/api/participation' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      let base;
      try { base = await response.json(); } catch (_) { return response; }
      const season = await resolveSeason(env, url.searchParams.get('season'));
      if (!season) return json({ ...base, season: null, seasons: [] }, response.status);

      if (season.status === 'archived') {
        const archived = await archivedParticipation(env, season);
        if (archived) return json(archived, response.status);
      }

      try {
        const built = await buildSeasonParticipation(env, season, base);
        return json(stripInternal(built), response.status);
      } catch (error) {
        console.error('Could not build season-wide participation', error);
        return json({ ...base, season: publicSeason(season), seasonError: String(error?.message || error) }, response.status);
      }
    }

    if (url.pathname === '/api/scoring-guide' && request.method === 'GET') {
      const response = await portal.fetch(request, env, ctx);
      if (!response.ok) return response;
      try {
        const body = await response.json();
        const season = await resolveSeason(env, null);
        const noEvent = season ? await noEventWeeks(env, season) : [];
        return json({
          ...body,
          season: season ? publicSeason(season) : null,
          seasonRules: {
            multiLeague: true,
            seasonEndFreezesScoring: true,
            archivedLeaderboardFrozen: true,
            noEventWeeksExcluded: true,
            noEventWeeks: noEvent,
          },
        }, response.status);
      } catch (_) {
        return response;
      }
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireUser(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/auth/me';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function seasonDirectory(env) {
  const result = await env.DB.prepare(`
    SELECT season_id,name,start_cycle_id,final_cycle_id,starts_at,ends_at,status,archived_at,created_at,updated_at
    FROM alliance_seasons
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(starts_at,start_cycle_id) DESC
  `).all();
  const seasons = (result.results || []).map(publicSeason);
  return {
    seasons,
    activeSeason: seasons.find(row => row.status === 'active') || null,
    archivedSeasons: seasons.filter(row => row.status === 'archived'),
  };
}

async function adminSeasonDirectory(env) {
  const directory = await seasonDirectory(env);
  const [cyclesResult, availabilityResult] = await Promise.all([
    env.DB.prepare(`
      SELECT cycle_id,MAX(captured_at) AS latest_capture
      FROM duel_daily
      WHERE cycle_id IS NOT NULL AND cycle_id<>''
      GROUP BY cycle_id
      ORDER BY cycle_id
    `).all(),
    env.DB.prepare(`
      SELECT event_type,cycle_id,cycle_week,status,note,updated_at
      FROM event_week_availability
      ORDER BY cycle_id,cycle_week,event_type
    `).all(),
  ]);
  return {
    ...directory,
    duelCycles: (cyclesResult.results || []).map(row => ({ cycleId: String(row.cycle_id), latestCapture: String(row.latest_capture || '') })),
    eventAvailability: (availabilityResult.results || []).map(row => ({
      eventType: String(row.event_type), cycleId: String(row.cycle_id), cycleWeek: Number(row.cycle_week),
      status: String(row.status || 'no_event'), note: String(row.note || ''), updatedAt: String(row.updated_at || ''),
    })),
  };
}

async function resolveSeason(env, requestedId) {
  const requested = String(requestedId || '').trim();
  if (requested) {
    return env.DB.prepare('SELECT * FROM alliance_seasons WHERE season_id=?').bind(requested).first();
  }
  const active = await env.DB.prepare(`SELECT * FROM alliance_seasons WHERE status='active' ORDER BY created_at DESC LIMIT 1`).first();
  if (active) return active;
  return env.DB.prepare(`SELECT * FROM alliance_seasons ORDER BY COALESCE(archived_at,updated_at) DESC LIMIT 1`).first();
}

function publicSeason(row) {
  if (!row) return null;
  const end = String(row.ends_at || '');
  const ended = Boolean(end && Date.parse(end) <= Date.now());
  return {
    seasonId: String(row.season_id || ''),
    name: String(row.name || 'Season'),
    startCycleId: String(row.start_cycle_id || ''),
    finalCycleId: String(row.final_cycle_id || ''),
    startsAt: String(row.starts_at || ''),
    endsAt: end,
    status: String(row.status || 'active'),
    archivedAt: String(row.archived_at || ''),
    ended,
    frozen: String(row.status || '') === 'archived' || ended,
  };
}

async function saveSeason(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Invalid season settings.' }, 400); }
  const seasonId = String(body.seasonId || '').trim();
  const current = await env.DB.prepare('SELECT * FROM alliance_seasons WHERE season_id=?').bind(seasonId).first();
  if (!current) return json({ ok: false, error: 'Season was not found.' }, 404);
  if (String(current.status) === 'archived') return json({ ok: false, error: 'Archived seasons are frozen. Start a new season instead.' }, 409);

  const name = String(body.name || current.name || 'Season').trim().slice(0, 80) || 'Season';
  const startCycleId = validCycle(body.startCycleId) ? String(body.startCycleId) : String(current.start_cycle_id);
  const finalCycleId = body.finalCycleId ? (validCycle(body.finalCycleId) ? String(body.finalCycleId) : '') : '';
  if (finalCycleId && finalCycleId < startCycleId) return json({ ok: false, error: 'Final Duel League cannot be before the season start.' }, 400);
  const startsAt = normalizeIso(body.startsAt) || String(current.starts_at || '');
  const endsAt = normalizeIso(body.endsAt);
  if (endsAt && startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return json({ ok: false, error: 'Season end must be after its start.' }, 400);
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE alliance_seasons
    SET name=?,start_cycle_id=?,final_cycle_id=?,starts_at=?,ends_at=?,updated_at=?
    WHERE season_id=?
  `).bind(name,startCycleId,finalCycleId || null,startsAt || null,endsAt || null,now,seasonId).run();

  return json({ ok: true, season: publicSeason(await env.DB.prepare('SELECT * FROM alliance_seasons WHERE season_id=?').bind(seasonId).first()) });
}

async function startSeason(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Invalid new season.' }, 400); }
  const existing = await env.DB.prepare(`SELECT season_id,name FROM alliance_seasons WHERE status='active' LIMIT 1`).first();
  if (existing) return json({ ok: false, error: `Archive ${String(existing.name || 'the active season')} before starting another season.` }, 409);

  const startCycleId = validCycle(body.startCycleId) ? String(body.startCycleId) : '';
  if (!startCycleId) return json({ ok: false, error: 'Choose the first Duel League for the new season.' }, 400);
  const name = String(body.name || 'New Season').trim().slice(0,80) || 'New Season';
  const startsAt = normalizeIso(body.startsAt) || `${startCycleId}T00:00:00Z`;
  const now = new Date().toISOString();
  const seasonId = `season-${startCycleId}-${Date.now().toString(36)}`;

  await env.DB.prepare(`
    INSERT INTO alliance_seasons(season_id,name,start_cycle_id,starts_at,status,scoring_snapshot_json,created_at,updated_at)
    VALUES(?,?,?,?,'active','{}',?,?)
  `).bind(seasonId,name,startCycleId,startsAt,now,now).run();
  return json({ ok: true, season: publicSeason(await env.DB.prepare('SELECT * FROM alliance_seasons WHERE season_id=?').bind(seasonId).first()) });
}

async function archiveSeason(request, env, ctx) {
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Invalid archive request.' }, 400); }
  const seasonId = String(body.seasonId || '').trim();
  const current = await env.DB.prepare('SELECT * FROM alliance_seasons WHERE season_id=?').bind(seasonId).first();
  if (!current) return json({ ok: false, error: 'Season was not found.' }, 404);
  if (String(current.status) === 'archived') return json({ ok: true, season: publicSeason(current), alreadyArchived: true });

  const now = new Date().toISOString();
  const endAt = String(current.ends_at || '') || now;
  let finalCycleId = String(current.final_cycle_id || '');
  if (!finalCycleId) {
    const latest = await env.DB.prepare(`
      SELECT cycle_id FROM duel_daily
      WHERE cycle_id>=? AND captured_at<=?
      GROUP BY cycle_id ORDER BY cycle_id DESC LIMIT 1
    `).bind(String(current.start_cycle_id), endAt).first();
    finalCycleId = String(latest?.cycle_id || current.start_cycle_id || '');
  }
  const seasonForArchive = { ...current, final_cycle_id: finalCycleId || null, ends_at: endAt, status: 'archived', archived_at: now };

  const participationUrl = new URL(request.url);
  participationUrl.pathname = '/api/participation';
  participationUrl.search = '';
  const baseResponse = await portal.fetch(new Request(participationUrl.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  if (!baseResponse.ok) return baseResponse;
  const base = await baseResponse.json();
  const built = await buildSeasonParticipation(env, seasonForArchive, base);
  const snapshot = stripInternal(built);

  await env.DB.prepare(`
    UPDATE alliance_seasons
    SET final_cycle_id=?,ends_at=?,status='archived',archived_at=?,scoring_snapshot_json=?,updated_at=?
    WHERE season_id=?
  `).bind(finalCycleId || null,endAt,now,JSON.stringify({
    contribution: snapshot.contribution,
    settings: snapshot.settings,
    method: snapshot.method,
    availability: snapshot.availability,
    season: snapshot.season,
  }),now,seasonId).run();

  await env.DB.prepare('DELETE FROM season_archived_leaderboard WHERE season_id=?').bind(seasonId).run();
  const statements = built.players.map(row => env.DB.prepare(`
    INSERT INTO season_archived_leaderboard(season_id,uid,public_id,rank,score,row_json,archived_at)
    VALUES(?,?,?,?,?,?,?)
  `).bind(seasonId,String(row._uid || ''),String(row.publicId || ''),Number(row.rank || 0),Number(row.score || 0),JSON.stringify(stripPlayerInternal(row)),now));
  await runBatches(env.DB, statements, 70);
  return json({ ok: true, season: publicSeason({ ...seasonForArchive }), frozenPlayers: statements.length });
}

async function archivedParticipation(env, season) {
  const rows = await env.DB.prepare(`
    SELECT row_json FROM season_archived_leaderboard WHERE season_id=? ORDER BY rank
  `).bind(String(season.season_id)).all();
  if (!(rows.results || []).length) return null;
  let meta = {};
  try { meta = JSON.parse(String(season.scoring_snapshot_json || '{}')); } catch (_) {}
  return {
    ok: true,
    players: (rows.results || []).map(row => {
      try { return JSON.parse(String(row.row_json || '{}')); } catch (_) { return {}; }
    }),
    season: publicSeason(season),
    seasons: (await seasonDirectory(env)).seasons,
    contribution: meta.contribution || {},
    settings: meta.settings || {},
    availability: meta.availability || {},
    method: meta.method || 'Frozen season archive.',
    scoringMode: 'season_archive_v1',
    archived: true,
  };
}

async function updateEventAvailability(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'Invalid event availability.' }, 400); }
  const eventType = String(body.eventType || '');
  const cycleId = String(body.cycleId || '');
  const cycleWeek = Number(body.cycleWeek || 0);
  const noEvent = Boolean(body.noEvent);
  const note = String(body.note || '').trim().slice(0,240);
  if (!EVENT_TYPES.includes(eventType) || !validCycle(cycleId) || cycleWeek < 1 || cycleWeek > 4) {
    return json({ ok: false, error: 'Choose a valid event, Duel League, and week.' }, 400);
  }
  if (!noEvent) {
    await env.DB.prepare('DELETE FROM event_week_availability WHERE event_type=? AND cycle_id=? AND cycle_week=?')
      .bind(eventType,cycleId,cycleWeek).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO event_week_availability(event_type,cycle_id,cycle_week,status,note,updated_at,updated_by_uid)
      VALUES(?,?,?,'no_event',?,?,NULL)
      ON CONFLICT(event_type,cycle_id,cycle_week) DO UPDATE SET status='no_event',note=excluded.note,updated_at=excluded.updated_at
    `).bind(eventType,cycleId,cycleWeek,note,new Date().toISOString()).run();
  }
  return json({ ok: true, eventType, cycleId, cycleWeek, noEvent, note });
}

async function buildSeasonParticipation(env, season, base) {
  const startCycle = String(season.start_cycle_id || '');
  const finalCycle = String(season.final_cycle_id || '');
  const endAt = String(season.ends_at || '');
  const primary = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const cycleFilter = `cycle_id>=? AND (?='' OR cycle_id<=?)`;
  const captureFilter = `(?='' OR captured_at<=?)`;

  const [playersResult,dailyResult,policyResult,leaveResult,resultResult,overrideResult,eventResult,noEventResult] = await Promise.all([
    env.DB.prepare(`SELECT uid,public_id,current_name,alliance_abbr,server_id FROM players WHERE alliance_abbr=? ORDER BY current_name COLLATE NOCASE`).bind(primary).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,day_index,uid,score,captured_at FROM duel_daily WHERE ${cycleFilter} AND ${captureFilter} ORDER BY cycle_id,cycle_week,day_index`)
      .bind(startCycle,finalCycle,finalCycle,endAt,endAt).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,is_bye,weight_multiplier FROM event_week_policy WHERE ${cycleFilter}`)
      .bind(startCycle,finalCycle,finalCycle).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,uid,status FROM player_week_leave WHERE ${cycleFilter} AND status='away'`)
      .bind(startCycle,finalCycle,finalCycle).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,day_index,is_win,captured_at FROM duel_results WHERE ${cycleFilter} AND ${captureFilter}`)
      .bind(startCycle,finalCycle,finalCycle,endAt,endAt).all(),
    env.DB.prepare(`SELECT cycle_id,cycle_week,day_index,is_win,updated_at FROM duel_day_outcome_override WHERE ${cycleFilter}`)
      .bind(startCycle,finalCycle,finalCycle).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,uid,raw_score,credited_score,credit_source,leaderboard_position,captured_at FROM event_week_scores WHERE event_type IN ('state_ruler','glory_war') AND ${cycleFilter} AND ${captureFilter}`)
      .bind(startCycle,finalCycle,finalCycle,endAt,endAt).all(),
    env.DB.prepare(`SELECT event_type,cycle_id,cycle_week,status,note,updated_at FROM event_week_availability WHERE ${cycleFilter}`)
      .bind(startCycle,finalCycle,finalCycle).all(),
  ]);

  const settings = normalizeSettings(base);
  const weeks = buildDuelWeeks(dailyResult.results || []);
  const policies = new Map((policyResult.results || []).map(row => [eventWeekKey(row.event_type,row.cycle_id,row.cycle_week), {
    isBye: Number(row.is_bye || 0) === 1,
    multiplier: Math.max(0,finite(row.weight_multiplier,1)),
  }]));
  const away = new Set((leaveResult.results || []).map(row => playerWeekKey(row.uid,row.cycle_id,row.cycle_week)));
  const outcomes = buildOutcomes(resultResult.results || [],overrideResult.results || []);
  const noEvents = new Set((noEventResult.results || []).filter(row => String(row.status)==='no_event').map(row => eventWeekKey(row.event_type,row.cycle_id,row.cycle_week)));
  const eventWeeks = buildEventWeeks(eventResult.results || [],noEvents);
  const finalCycleComplete = Boolean(finalCycle && weeks.get(`${finalCycle}|4`)?.days.has(6));

  const players = (playersResult.results || []).map(player => {
    const uid = String(player.uid || '');
    const duel = scoreSeasonDuel(uid,weeks,policies,away,outcomes,settings,finalCycle);
    const duelIndex = contributionIndex(duel.weightedAverage,settings.duelBaseline,settings.curveExponent);
    const ruler = scoreSeasonEvent(uid,'state_ruler',eventWeeks.get('state_ruler') || new Map(),policies,away,settings.stateRulerBaseline,settings.curveExponent);
    const glory = { eventIndex: 0,index:0,raw:0,eligibleWeeks:0,playedWeeks:0,status:'pending_model' };
    const overall = duelIndex*settings.weights.alliance_duel + ruler.eventIndex*settings.weights.state_ruler;
    const qualified = !finalCycleComplete || duel.finalLeaguePlayedWeeks >= settings.minimumRankedDuelWeeks;
    return {
      _uid: uid,
      publicId: String(player.public_id || ''),
      name: String(player.current_name || ''),
      allianceAbbr: String(player.alliance_abbr || ''),
      serverId: Number(player.server_id || 0),
      score: round2(overall),
      overallContribution: round2(overall),
      components: {
        alliance_duel: { ...duel,eventIndex:round2(duelIndex),index:round2(duelIndex),baseline:settings.duelBaseline,weight:settings.weights.alliance_duel,weightedContribution:round2(duelIndex*settings.weights.alliance_duel) },
        state_ruler: { ...ruler,weight:settings.weights.state_ruler,weightedContribution:round2(ruler.eventIndex*settings.weights.state_ruler) },
        glory_war: { ...glory,weight:settings.weights.glory_war,weightedContribution:0 },
      },
      minimumDaysHit: duel.minimumDaysHit,
      minimumDaysAvailable: duel.minimumDaysAvailable,
      qualification: {
        qualified,
        finalCheckActive: finalCycleComplete,
        playedDuelWeeks: duel.finalLeaguePlayedWeeks,
        requiredDuelWeeks: settings.minimumRankedDuelWeeks,
      },
    };
  });

  players.sort((a,b) => {
    if (finalCycleComplete && a.qualification.qualified !== b.qualification.qualified) return a.qualification.qualified ? -1 : 1;
    return Number(b.score)-Number(a.score)
      || Number(b.components.alliance_duel.consistencyPercent)-Number(a.components.alliance_duel.consistencyPercent)
      || Number(b.components.alliance_duel.eligibleRaw)-Number(a.components.alliance_duel.eligibleRaw)
      || String(a.name).localeCompare(String(b.name));
  });
  players.forEach((row,index) => { row.rank=index+1; });

  const directory = await seasonDirectory(env);
  return {
    ...base,
    players,
    cycleId: String(base.cycleId || ''),
    scoringMode:'season_combined_contribution_v1',
    season: publicSeason(season),
    seasons: directory.seasons,
    seasonDuelLeagues: [...new Set([...weeks.values()].map(week => week.cycleId))].sort(),
    availability: {
      ...(base.availability || {}),
      alliance_duel: weeks.size>0,
      state_ruler: (eventWeeks.get('state_ruler')?.size || 0)>0,
      glory_war:false,
    },
    contribution: {
      ...(base.contribution || {}),
      weights:settings.weights,
      scales:{
        ...(base.contribution?.scales || {}),
        duelBaseline:settings.duelBaseline,
        stateRulerBaseline:settings.stateRulerBaseline,
        stateRulerAttendanceFloor:settings.stateRulerAttendanceFloor,
        curveExponent:settings.curveExponent,
      },
      provisional:true,
      pendingEvent:'glory_war',
    },
    method:`Season scoring spans every four-week Duel League from ${startCycle}${finalCycle ? ` through ${finalCycle}` : ' onward'}. Alliance Duel keeps the 1/2/2/2/2/4 day weighting, Bye and secured-week rules across all captured season weeks. State Ruler uses the shared Contribution Index. Explicit No Event weeks are excluded entirely. ${endAt ? `Scores captured after ${endAt} are outside this season.` : ''}`.trim(),
    seasonNoEventWeeks:(noEventResult.results || []).map(row => ({eventType:String(row.event_type),cycleId:String(row.cycle_id),cycleWeek:Number(row.cycle_week),note:String(row.note||'')})),
  };
}

function buildDuelWeeks(rows) {
  const weeks=new Map();
  for (const row of rows) {
    const cycleId=String(row.cycle_id||''); const cycleWeek=Number(row.cycle_week||0); const dayIndex=Number(row.day_index||0);
    if (!cycleId || cycleWeek<1 || cycleWeek>4 || dayIndex<1 || dayIndex>6) continue;
    const key=`${cycleId}|${cycleWeek}`;
    if (!weeks.has(key)) weeks.set(key,{cycleId,cycleWeek,days:new Map()});
    const week=weeks.get(key);
    if (!week.days.has(dayIndex)) week.days.set(dayIndex,{dayIndex,scores:new Map(),capturedAt:''});
    const day=week.days.get(dayIndex); day.scores.set(String(row.uid),Number(row.score||0));
    if (String(row.captured_at||'')>day.capturedAt) day.capturedAt=String(row.captured_at||'');
  }
  return weeks;
}

function buildOutcomes(results,overrides) {
  const byWeek=new Map();
  const put=(row,priority)=>{
    const cycleId=String(row.cycle_id||''); const cycleWeek=Number(row.cycle_week||0); const dayIndex=Number(row.day_index||0);
    if (!cycleId||cycleWeek<1||cycleWeek>4||dayIndex<1||dayIndex>6) return;
    const key=`${cycleId}|${cycleWeek}`;
    if (!byWeek.has(key)) byWeek.set(key,{days:new Map(),securedDayIndex:0,pointsWon:0});
    const week=byWeek.get(key); const current=week.days.get(dayIndex);
    if (!current||priority>=current.priority) week.days.set(dayIndex,{isWin:Number(row.is_win||0)===1,priority});
  };
  for (const row of overrides) put(row,1);
  for (const row of results) if (row.is_win!==null&&row.is_win!==undefined) put(row,2);
  for (const week of byWeek.values()) {
    let points=0;
    for (const meta of DAY_META) { if (week.days.get(meta.dayIndex)?.isWin) points+=meta.weight; if (!week.securedDayIndex&&points>=WIN_THRESHOLD) week.securedDayIndex=meta.dayIndex; }
    week.pointsWon=points;
  }
  return byWeek;
}

function scoreSeasonDuel(uid,weeks,policies,away,outcomes,settings,finalCycleId) {
  let weightedNumerator=0,availableWeight=0,raw=0,eligibleRaw=0,minimumDaysHit=0,minimumDaysAvailable=0;
  const playedWeeks=new Set(); const finalLeaguePlayed=new Set(); const dayAverages=[];
  for (const week of weeks.values()) for (const day of week.days.values()) raw+=Number(day.scores.get(uid)||0);
  for (const meta of DAY_META) {
    let adjustedTotal=0,rawTotal=0,eligibleWeeks=0;
    for (const week of weeks.values()) {
      const day=week.days.get(meta.dayIndex); if (!day) continue;
      if (away.has(playerWeekKey(uid,week.cycleId,week.cycleWeek))) continue;
      const score=Number(day.scores.get(uid)||0);
      const policy=policies.get(eventWeekKey('alliance_duel',week.cycleId,week.cycleWeek))||{isBye:false,multiplier:1};
      const byeMultiplier=policy.isBye?Math.max(0,finite(policy.multiplier,1)):1;
      const securedDayIndex=Number(outcomes.get(`${week.cycleId}|${week.cycleWeek}`)?.securedDayIndex||0);
      const securedMultiplier=securedDayIndex>0&&meta.dayIndex>securedDayIndex?settings.securedWeekWeight:1;
      const multiplier=byeMultiplier*securedMultiplier;
      eligibleWeeks+=1; rawTotal+=score; eligibleRaw+=score; adjustedTotal+=score*multiplier;
      if (score>0) { const wk=`${week.cycleId}|${week.cycleWeek}`; playedWeeks.add(wk); if (week.cycleId===finalCycleId) finalLeaguePlayed.add(wk); }
      if (!policy.isBye) { minimumDaysAvailable+=1; if (score>=settings.dailyMinimum) minimumDaysHit+=1; }
    }
    if (!eligibleWeeks) { dayAverages.push({...meta,average:0,rawAverage:0,eligibleWeeks:0}); continue; }
    const average=adjustedTotal/eligibleWeeks; const rawAverage=rawTotal/eligibleWeeks;
    dayAverages.push({...meta,average:round2(average),rawAverage:round2(rawAverage),eligibleWeeks});
    weightedNumerator+=average*meta.weight; availableWeight+=meta.weight;
  }
  const weightedAverage=availableWeight?weightedNumerator/availableWeight:0;
  return {
    raw,eligibleRaw,weightedAverage:round2(weightedAverage),consistencyPercent:minimumDaysAvailable?round1(minimumDaysHit*100/minimumDaysAvailable):0,
    dayAverages,availableDayWeight:availableWeight,totalDayWeight:TOTAL_DAY_WEIGHT,playedWeeks:playedWeeks.size,finalLeaguePlayedWeeks:finalLeaguePlayed.size,
    minimumDaysHit,minimumDaysAvailable,scoringMode:'season_weighted_day_average_secured_week',
  };
}

function buildEventWeeks(rows,noEvents) {
  const byEvent=new Map();
  for (const row of rows) {
    const eventType=String(row.event_type||''); const cycleId=String(row.cycle_id||''); const cycleWeek=Number(row.cycle_week||0);
    if (!EVENT_TYPES.includes(eventType)||!cycleId||cycleWeek<1||cycleWeek>4) continue;
    const key=eventWeekKey(eventType,cycleId,cycleWeek); if (noEvents.has(key)) continue;
    if (!byEvent.has(eventType)) byEvent.set(eventType,new Map());
    const weeks=byEvent.get(eventType); const weekKey=`${cycleId}|${cycleWeek}`;
    if (!weeks.has(weekKey)) weeks.set(weekKey,{cycleId,cycleWeek,scores:new Map()});
    weeks.get(weekKey).scores.set(String(row.uid),row);
  }
  return byEvent;
}

function scoreSeasonEvent(uid,eventType,weeks,policies,away,baseline,curveExponent) {
  let adjustedIndexTotal=0,creditedTotal=0,eligibleWeeks=0,playedWeeks=0,attendanceOnlyWeeks=0,realScoreWeeks=0;
  const detail=[];
  for (const week of weeks.values()) {
    if (away.has(playerWeekKey(uid,week.cycleId,week.cycleWeek))) { detail.push({cycleId:week.cycleId,cycleWeek:week.cycleWeek,status:'on_leave',excluded:true}); continue; }
    eligibleWeeks+=1; const row=week.scores.get(uid); const credited=Math.max(0,Number(row?.credited_score||0));
    const baseIndex=contributionIndex(credited,baseline,curveExponent); const policy=policies.get(eventWeekKey(eventType,week.cycleId,week.cycleWeek))||{isBye:false,multiplier:1};
    const weekMultiplier=policy.isBye?Math.max(0,finite(policy.multiplier,1)):1; const adjusted=baseIndex*weekMultiplier;
    creditedTotal+=credited; adjustedIndexTotal+=adjusted; if (credited>0) playedWeeks+=1;
    if (String(row?.credit_source||'')==='attendance_minimum') attendanceOnlyWeeks+=1; if (row?.raw_score!==null&&row?.raw_score!==undefined) realScoreWeeks+=1;
    detail.push({cycleId:week.cycleId,cycleWeek:week.cycleWeek,status:credited>0?String(row?.credit_source||'credited'):'missed',excluded:false,creditedScore:credited,index:round2(adjusted),weekMultiplier});
  }
  const index=eligibleWeeks?adjustedIndexTotal/eligibleWeeks:0;
  return { raw:creditedTotal,creditedTotal,averageCreditedScore:eligibleWeeks?round2(creditedTotal/eligibleWeeks):0,index:round2(index),eventIndex:round2(index),baseline,eligibleWeeks,playedWeeks,attendanceOnlyWeeks,realScoreWeeks,weeks:detail };
}

function normalizeSettings(base) {
  const contribution=base?.contribution||{}; const scales=contribution.scales||{}; const weights=contribution.weights||{}; const duel=base?.settings||{};
  return {
    dailyMinimum:finite(duel.dailyMinimum,6000000),
    minimumRankedDuelWeeks:Math.max(1,Math.min(4,Math.round(finite(duel.minimumRankedDuelWeeks,3)))),
    securedWeekWeight:clamp01(duel.securedWeekWeight,0.35),
    duelBaseline:Math.max(1,finite(scales.duelBaseline,6000000)),
    stateRulerBaseline:Math.max(1,finite(scales.stateRulerBaseline,2250000)),
    stateRulerAttendanceFloor:Math.max(0,finite(scales.stateRulerAttendanceFloor,2250000)),
    curveExponent:Math.max(0.1,Math.min(1,finite(scales.curveExponent,0.5))),
    weights:{ alliance_duel:clamp01(weights.alliance_duel,0.45),state_ruler:clamp01(weights.state_ruler,0.25),glory_war:clamp01(weights.glory_war,0.30) },
  };
}

async function noEventWeeks(env,season) {
  const result=await env.DB.prepare(`
    SELECT event_type,cycle_id,cycle_week,note FROM event_week_availability
    WHERE cycle_id>=? AND (?='' OR cycle_id<=?) ORDER BY cycle_id,cycle_week,event_type
  `).bind(String(season.start_cycle_id||''),String(season.final_cycle_id||''),String(season.final_cycle_id||'')).all();
  return (result.results||[]).map(row=>({eventType:String(row.event_type),cycleId:String(row.cycle_id),cycleWeek:Number(row.cycle_week),note:String(row.note||'')}));
}

function contributionIndex(performance,baseline,curve) { const p=Math.max(0,Number(performance||0)),b=Math.max(1,Number(baseline||1)),c=Math.max(.1,Math.min(1,Number(curve||.5))); return p>0?100*Math.pow(p/b,c):0; }
function eventWeekKey(eventType,cycleId,cycleWeek){return `${eventType}|${cycleId}|${Number(cycleWeek)}`;}
function playerWeekKey(uid,cycleId,cycleWeek){return `${uid}|${cycleId}|${Number(cycleWeek)}`;}
function validCycle(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''));}
function normalizeIso(value){if(!value)return '';const date=new Date(String(value));return Number.isNaN(date.getTime())?'':date.toISOString();}
function finite(value,fallback){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clamp01(value,fallback){return Math.max(0,Math.min(1,finite(value,fallback)));}
function round1(value){return Math.round(Number(value||0)*10)/10;}
function round2(value){return Math.round(Number(value||0)*100)/100;}
function stripPlayerInternal(row){const copy={...row};delete copy._uid;return copy;}
function stripInternal(body){return {...body,players:(body.players||[]).map(stripPlayerInternal)};}
async function runBatches(db,statements,size){for(let i=0;i<statements.length;i+=size)await db.batch(statements.slice(i,i+size));}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
