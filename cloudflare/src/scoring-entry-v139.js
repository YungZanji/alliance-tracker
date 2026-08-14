import portal from './scoring-entry-v138.js';

const PRIMARY_ALLIANCE = 'WDZ';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Desktop Poll Capture uses the same private upload token as normal capture sync.
    if (url.pathname === '/api/polls/sync' && request.method === 'POST') {
      return handlePollSync(request, env);
    }

    if (url.pathname === '/api/admin/polls' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      return listPolls(env);
    }

    if (url.pathname.startsWith('/api/admin/polls/') && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      const pollId = decodeURIComponent(url.pathname.slice('/api/admin/polls/'.length));
      return pollDetail(pollId, env);
    }

    return portal.fetch(request, env, ctx);
  }
};

async function requireAdmin(request, env, ctx) {
  const url = new URL(request.url);
  url.pathname = '/api/admin/scoring-context';
  url.search = '';
  const response = await portal.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }), env, ctx);
  return response.ok ? null : response;
}

async function handlePollSync(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: 'Invalid poll archive payload.' }, 400);
  }
  const supplied = String(body.uploadToken || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '');
  if (!env.UPLOAD_TOKEN || supplied !== String(env.UPLOAD_TOKEN)) {
    return json({ ok: false, error: 'Invalid upload token.' }, 401);
  }

  const incoming = Array.isArray(body.polls) ? body.polls : [];
  if (!incoming.length) return json({ ok: false, error: 'No decoded alliance polls were supplied.' }, 400);

  const alliance = String(env.PRIMARY_ALLIANCE_ABBR || PRIMARY_ALLIANCE).trim();
  const rosterResult = await env.DB.prepare(`
    SELECT uid,public_id,current_name,alliance_abbr
    FROM players
    WHERE alliance_abbr=?
    ORDER BY current_name COLLATE NOCASE
  `).bind(alliance).all();
  const roster = rosterResult.results || [];
  const playerByUid = new Map(roster.map(row => [String(row.uid), row]));
  const now = new Date().toISOString();
  const archived = [];

  for (const raw of incoming.slice(0, 20)) {
    const poll = normalizePoll(raw, body, now);
    if (!poll.pollId || !poll.question) continue;

    const optionById = new Map(poll.options.map(option => [option.id, option]));
    const votesByUid = new Map();
    for (const vote of poll.votes) {
      if (!vote.uid || !vote.optionId) continue;
      if (!votesByUid.has(vote.uid)) votesByUid.set(vote.uid, new Set());
      votesByUid.get(vote.uid).add(vote.optionId);
    }

    const participants = new Map();
    for (const player of roster) {
      const uid = String(player.uid || '');
      if (!uid) continue;
      participants.set(uid, {
        uid,
        publicId: String(player.public_id || ''),
        playerName: String(player.current_name || ''),
        allianceAbbr: String(player.alliance_abbr || alliance),
        rosterMember: 1,
      });
    }
    for (const uid of votesByUid.keys()) {
      if (!participants.has(uid)) {
        const known = playerByUid.get(uid);
        participants.set(uid, {
          uid,
          publicId: String(known?.public_id || ''),
          playerName: String(known?.current_name || ''),
          allianceAbbr: String(known?.alliance_abbr || ''),
          rosterMember: known ? 1 : 0,
        });
      }
    }

    const optionCounts = new Map(poll.options.map(option => [option.id, 0]));
    let votedCount = 0;
    for (const participant of participants.values()) {
      const optionIds = [...(votesByUid.get(participant.uid) || [])];
      participant.optionIds = optionIds;
      participant.optionTexts = optionIds.map(id => optionById.get(id)?.text || `Option ${id}`);
      participant.voted = optionIds.length ? 1 : 0;
      if (participant.voted) votedCount += 1;
      for (const optionId of optionIds) optionCounts.set(optionId, Number(optionCounts.get(optionId) || 0) + 1);
    }

    const statements = [
      env.DB.prepare(`
        INSERT INTO alliance_polls(
          poll_id,question,publisher_uid,publisher_name,alliance_abbr,created_at,ends_at,status,support_multi,
          source_session_id,captured_at,first_archived_at,updated_at,roster_size,vote_count
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(poll_id) DO UPDATE SET
          question=excluded.question,publisher_uid=excluded.publisher_uid,publisher_name=excluded.publisher_name,
          alliance_abbr=excluded.alliance_abbr,created_at=excluded.created_at,ends_at=excluded.ends_at,
          status=excluded.status,support_multi=excluded.support_multi,source_session_id=excluded.source_session_id,
          captured_at=excluded.captured_at,updated_at=excluded.updated_at,roster_size=excluded.roster_size,vote_count=excluded.vote_count
      `).bind(
        poll.pollId,poll.question,poll.publisherUid,poll.publisherName,poll.allianceAbbr || alliance,poll.createdAt,poll.endsAt,
        poll.status,poll.supportMulti ? 1 : 0,poll.sessionId,poll.capturedAt,now,now,roster.length,votedCount
      ),
      env.DB.prepare('DELETE FROM alliance_poll_options WHERE poll_id=?').bind(poll.pollId),
      env.DB.prepare('DELETE FROM alliance_poll_participants WHERE poll_id=?').bind(poll.pollId),
    ];

    for (let index = 0; index < poll.options.length; index += 1) {
      const option = poll.options[index];
      statements.push(env.DB.prepare(`
        INSERT INTO alliance_poll_options(poll_id,option_id,option_text,position,vote_count)
        VALUES(?,?,?,?,?)
      `).bind(poll.pollId, option.id, option.text, index + 1, Number(optionCounts.get(option.id) || 0)));
    }

    for (const participant of participants.values()) {
      statements.push(env.DB.prepare(`
        INSERT INTO alliance_poll_participants(
          poll_id,uid,public_id,player_name,alliance_abbr,roster_member,voted,option_ids_json,option_texts_json,archived_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)
      `).bind(
        poll.pollId,participant.uid,participant.publicId,participant.playerName,participant.allianceAbbr,
        participant.rosterMember,participant.voted,JSON.stringify(participant.optionIds),JSON.stringify(participant.optionTexts),now
      ));
    }

    await runBatches(env.DB, statements, 80);
    archived.push({
      pollId: poll.pollId,
      question: poll.question,
      options: poll.options.length,
      votes: votedCount,
      rosterSize: roster.length,
      didNotVote: Math.max(0, roster.length - [...participants.values()].filter(row => row.rosterMember && row.voted).length),
      capturedAt: poll.capturedAt,
    });
  }

  if (!archived.length) return json({ ok: false, error: 'No valid alliance poll records were found in the payload.' }, 400);
  return json({ ok: true, archived });
}

function normalizePoll(raw, body, now) {
  const pollId = String(raw?.pollId ?? raw?.uuid ?? '').trim();
  const options = (Array.isArray(raw?.options) ? raw.options : Array.isArray(raw?.voteList) ? raw.voteList : [])
    .map((option, index) => ({
      id: String(option?.id ?? option?.index ?? index + 1),
      text: String(option?.text ?? option?.voteNote ?? `Option ${index + 1}`).trim(),
    }))
    .filter(option => option.id);
  const votes = (Array.isArray(raw?.votes) ? raw.votes : Array.isArray(raw?.voteDetails) ? raw.voteDetails : [])
    .map(vote => ({ uid: String(vote?.uid || '').trim(), optionId: String(vote?.optionId ?? vote?.voteId ?? '').trim() }))
    .filter(vote => vote.uid && vote.optionId);
  return {
    pollId,
    question: String(raw?.question ?? raw?.notice ?? '').trim(),
    publisherUid: String(raw?.publisherUid ?? raw?.uid ?? ''),
    publisherName: String(raw?.publisherName ?? raw?.name ?? ''),
    allianceAbbr: String(raw?.allianceAbbr ?? raw?.abbr ?? ''),
    createdAt: toIso(raw?.createdAt ?? raw?.create_time),
    endsAt: toIso(raw?.endsAt ?? raw?.end_time),
    status: Number(raw?.status || 0),
    supportMulti: Boolean(Number(raw?.supportMulti || 0)),
    options,
    votes,
    sessionId: String(raw?.sessionId ?? body?.sessionId ?? ''),
    capturedAt: String(raw?.capturedAt ?? body?.capturedAt ?? now),
  };
}

async function listPolls(env) {
  const result = await env.DB.prepare(`
    SELECT poll_id,question,publisher_name,alliance_abbr,created_at,ends_at,status,support_multi,
           captured_at,first_archived_at,updated_at,roster_size,vote_count
    FROM alliance_polls
    ORDER BY COALESCE(created_at,captured_at) DESC
  `).all();
  const polls = (result.results || []).map(row => ({
    pollId: String(row.poll_id),
    question: String(row.question || ''),
    publisherName: String(row.publisher_name || ''),
    allianceAbbr: String(row.alliance_abbr || ''),
    createdAt: String(row.created_at || ''),
    endsAt: String(row.ends_at || ''),
    status: Number(row.status || 0),
    supportMulti: Number(row.support_multi || 0) === 1,
    capturedAt: String(row.captured_at || ''),
    firstArchivedAt: String(row.first_archived_at || ''),
    updatedAt: String(row.updated_at || ''),
    rosterSize: Number(row.roster_size || 0),
    voteCount: Number(row.vote_count || 0),
    didNotVote: Math.max(0, Number(row.roster_size || 0) - Number(row.vote_count || 0)),
  }));
  return json({ ok: true, polls });
}

async function pollDetail(pollId, env) {
  if (!pollId) return json({ ok: false, error: 'Poll ID is required.' }, 400);
  const poll = await env.DB.prepare(`
    SELECT * FROM alliance_polls WHERE poll_id=?
  `).bind(pollId).first();
  if (!poll) return json({ ok: false, error: 'Poll was not found.' }, 404);
  const [optionsResult, participantsResult] = await Promise.all([
    env.DB.prepare(`
      SELECT option_id,option_text,position,vote_count
      FROM alliance_poll_options WHERE poll_id=? ORDER BY position,option_id
    `).bind(pollId).all(),
    env.DB.prepare(`
      SELECT uid,public_id,player_name,alliance_abbr,roster_member,voted,option_ids_json,option_texts_json
      FROM alliance_poll_participants
      WHERE poll_id=?
      ORDER BY voted DESC, player_name COLLATE NOCASE, uid
    `).bind(pollId).all(),
  ]);
  return json({
    ok: true,
    poll: {
      pollId: String(poll.poll_id), question: String(poll.question || ''), publisherUid: String(poll.publisher_uid || ''),
      publisherName: String(poll.publisher_name || ''), allianceAbbr: String(poll.alliance_abbr || ''),
      createdAt: String(poll.created_at || ''), endsAt: String(poll.ends_at || ''), status: Number(poll.status || 0),
      supportMulti: Number(poll.support_multi || 0) === 1, capturedAt: String(poll.captured_at || ''),
      firstArchivedAt: String(poll.first_archived_at || ''), updatedAt: String(poll.updated_at || ''),
      rosterSize: Number(poll.roster_size || 0), voteCount: Number(poll.vote_count || 0),
    },
    options: (optionsResult.results || []).map(row => ({
      id: String(row.option_id), text: String(row.option_text || ''), position: Number(row.position || 0), voteCount: Number(row.vote_count || 0),
    })),
    participants: (participantsResult.results || []).map(row => ({
      uid: String(row.uid), publicId: String(row.public_id || ''), playerName: String(row.player_name || ''),
      allianceAbbr: String(row.alliance_abbr || ''), rosterMember: Number(row.roster_member || 0) === 1,
      voted: Number(row.voted || 0) === 1, optionIds: parseJsonArray(row.option_ids_json), optionTexts: parseJsonArray(row.option_texts_json),
    })),
  });
}

async function runBatches(db, statements, size) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}
function parseJsonArray(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}
function toIso(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    const millis = number > 10_000_000_000 ? number : number * 1000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
