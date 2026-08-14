import portal from './scoring-entry-v143.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/activity' && request.method === 'GET') {
      const gate = await requireAdmin(request, env, ctx);
      if (gate) return gate;
      const limit = Math.max(25, Math.min(300, Number(url.searchParams.get('limit') || 200)));
      return json({ ok: true, activity: await buildActivityHistory(env, limit) });
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

async function buildActivityHistory(env, limit) {
  const perType = Math.max(25, Math.min(100, limit));
  const [duel, polls, ruler, glory, pollApplications] = await Promise.all([
    safeAll(env, `
      SELECT
        COALESCE(NULLIF(session_id,''), source_hash) AS sync_key,
        MAX(received_at) AS occurred_at,
        MAX(cycle_id) AS cycle_id,
        MAX(cycle_week) AS cycle_week,
        COUNT(*) AS snapshot_count,
        SUM(COALESCE(row_count,0)) AS row_count,
        GROUP_CONCAT(DISTINCT dataset) AS datasets
      FROM captures
      GROUP BY COALESCE(NULLIF(session_id,''), source_hash)
      ORDER BY occurred_at DESC
      LIMIT ?
    `, [perType]),
    safeAll(env, `
      SELECT poll_id,question,publisher_name,updated_at AS occurred_at,vote_count,roster_size
      FROM alliance_polls
      ORDER BY updated_at DESC
      LIMIT ?
    `, [perType]),
    safeAll(env, `
      SELECT cycle_id,cycle_week,MAX(captured_at) AS occurred_at,COUNT(*) AS player_rows,
        SUM(CASE WHEN raw_score IS NOT NULL THEN 1 ELSE 0 END) AS real_scores,
        SUM(CASE WHEN credit_source='attendance_minimum' THEN 1 ELSE 0 END) AS attendance_credits
      FROM event_week_scores
      WHERE event_type='state_ruler'
      GROUP BY cycle_id,cycle_week
      ORDER BY occurred_at DESC
      LIMIT ?
    `, [perType]),
    safeAll(env, `
      SELECT cycle_id,cycle_week,MAX(captured_at) AS occurred_at,COUNT(*) AS player_rows,
        SUM(CASE WHEN raw_score IS NOT NULL THEN 1 ELSE 0 END) AS real_scores
      FROM event_week_scores
      WHERE event_type='glory_war'
      GROUP BY cycle_id,cycle_week
      ORDER BY occurred_at DESC
      LIMIT ?
    `, [perType]),
    safeAll(env, `
      SELECT poll_id,cycle_id,cycle_week,attendance_option_text,yes_count,floor_credits_added,
        real_scores_preserved,applied_at AS occurred_at
      FROM poll_state_ruler_applications
      ORDER BY applied_at DESC
      LIMIT ?
    `, [perType]),
  ]);

  const activity = [];

  for (const row of duel) {
    const datasets = String(row.datasets || '').split(',').filter(Boolean);
    activity.push({
      id: `duel:${row.sync_key || row.occurred_at}`,
      type: 'alliance_duel',
      label: 'Alliance Duel Sync',
      occurredAt: row.occurred_at,
      title: `${row.cycle_id || 'Duel cycle'} · Week ${Number(row.cycle_week || 0) || '—'}`,
      detail: `${Number(row.snapshot_count || 0)} snapshots · ${Number(row.row_count || 0)} normalized rows`,
      meta: datasets.join(' · '),
    });
  }

  for (const row of polls) {
    activity.push({
      id: `poll:${row.poll_id}`,
      type: 'poll',
      label: 'Poll Archive',
      occurredAt: row.occurred_at,
      title: String(row.question || 'Alliance poll'),
      detail: `${Number(row.vote_count || 0)} votes · ${Number(row.roster_size || 0)} roster snapshot`,
      meta: row.publisher_name ? `Published by ${row.publisher_name}` : '',
    });
  }

  for (const row of ruler) {
    activity.push({
      id: `ruler:${row.cycle_id}:${row.cycle_week}`,
      type: 'state_ruler',
      label: 'State Ruler',
      occurredAt: row.occurred_at,
      title: `${row.cycle_id || 'Cycle'} · Week ${Number(row.cycle_week || 0) || '—'}`,
      detail: `${Number(row.player_rows || 0)} credited players · ${Number(row.real_scores || 0)} real scores`,
      meta: `${Number(row.attendance_credits || 0)} attendance-floor credits`,
    });
  }

  for (const row of glory) {
    activity.push({
      id: `glory:${row.cycle_id}:${row.cycle_week}`,
      type: 'glory_war',
      label: 'Glory War',
      occurredAt: row.occurred_at,
      title: `${row.cycle_id || 'Cycle'} · Week ${Number(row.cycle_week || 0) || '—'}`,
      detail: `${Number(row.player_rows || 0)} credited players · ${Number(row.real_scores || 0)} real scores`,
      meta: '',
    });
  }

  for (const row of pollApplications) {
    activity.push({
      id: `poll-ruler:${row.poll_id}:${row.cycle_id}:${row.cycle_week}`,
      type: 'poll_state_ruler',
      label: 'Poll → State Ruler',
      occurredAt: row.occurred_at,
      title: `${row.cycle_id || 'Cycle'} · Week ${Number(row.cycle_week || 0) || '—'}`,
      detail: `${Number(row.yes_count || 0)} “${String(row.attendance_option_text || 'attendance')}” votes applied`,
      meta: `${Number(row.floor_credits_added || 0)} floor credits · ${Number(row.real_scores_preserved || 0)} real scores preserved`,
    });
  }

  activity.sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')));
  return activity.slice(0, limit);
}

async function safeAll(env, sql, bindings = []) {
  try {
    let statement = env.DB.prepare(sql);
    if (bindings.length) statement = statement.bind(...bindings);
    const result = await statement.all();
    return result.results || [];
  } catch (error) {
    console.warn('Admin activity query skipped:', error);
    return [];
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
