import './app-v064.js';

let scheduled = false;
let scoringAdmin = null;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => { scoringAdmin = null; schedule(); });
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(async () => {
    scheduled = false;
    await Promise.allSettled([enhanceDuelBye(), enhanceStateRuler(), enhanceScoringAdmin(), enhanceHomeStateRuler()]);
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function enhanceDuelBye() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1');
  const cycle = document.getElementById('cycle-select')?.value || '';
  const week = Number(document.getElementById('week-select')?.value || 0);
  const table = document.querySelector('#duel-table table');
  if (!title?.textContent.startsWith('Alliance Duel') || !cycle || !week || !table) return;
  const key = `${cycle}|${week}`;
  if (table.dataset.policyKey === key) return;
  try {
    const data = await api(`/api/event-week-policy?eventType=alliance_duel&cycle=${encodeURIComponent(cycle)}&week=${week}`);
    const policy = (data.policies || []).find(row => Number(row.cycleWeek) === week);
    table.dataset.policyKey = key;
    table.classList.toggle('duel-bye-week', Boolean(policy?.isBye));
    let badge = main.querySelector('.duel-bye-badge');
    if (policy?.isBye) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge badge-amber duel-bye-badge';
        main.querySelector('.page-head')?.appendChild(badge);
      }
      badge.textContent = `Bye week · ${Math.round(Number(policy.weightMultiplier || 0) * 100)}% weight`;
      badge.title = policy.note || 'This week has reduced scoring importance. The normal 6,000,000 daily warning is informational only.';
    } else if (badge) {
      badge.remove();
    }
  } catch (error) {
    console.warn('Could not load Duel bye-week policy:', error);
  }
}

async function enhanceStateRuler() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (title !== 'State Ruler' || main.dataset.stateRulerLoaded === '1') return;
  main.dataset.stateRulerLoaded = '1';
  try {
    const data = await api('/api/state-ruler');
    const panel = main.querySelector('.coming') || main.querySelector('.panel');
    if (!panel) return;
    if (!(data.players || []).length) {
      panel.innerHTML = `<div class="state-ruler-empty"><h2>No normalized State Ruler scores yet</h2><p class="muted">The Windows client can rebuild previously captured SVS leaderboard responses and sync them here. The feeds observed so far are partial leaderboards, so missing players are not treated as zero until attendance evidence is available.</p></div>`;
      return;
    }
    const s = data.summary || {};
    panel.className = 'panel state-ruler-panel';
    panel.innerHTML = `
      <div class="panel-head"><div><div class="panel-title">State Ruler · Week ${Number(data.cycleWeek || 1)}</div><div class="muted">Partial leaderboard + attendance credit model</div></div>${data.policy?.isBye ? `<span class="badge badge-amber">Bye · ${Math.round(Number(data.policy.weightMultiplier || 0) * 100)}% weight</span>` : '<span class="badge badge-blue">Normal week</span>'}</div>
      <div class="metrics state-ruler-metrics">
        ${metric('Captured players', s.players)}
        ${metric('Leaderboard', s.leaderboardPlayers)}
        ${metric('Attendance only', s.attendanceOnly)}
        ${metric('Attendance floor', format(s.attendanceFloor))}
      </div>
      <div class="table-wrap"><table class="responsive-table"><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Credited score</th><th class="numeric">Index</th><th>Credit</th></tr></thead><tbody>
      ${(data.players || []).map(row => `<tr><td class="rank-cell">#${Number(row.rank)}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>S${Number(row.serverId || 0)}</small></td><td class="numeric score">${format(row.creditedScore)}</td><td class="numeric">${Number(row.normalizedIndex || 0).toFixed(1)}</td><td>${row.creditSource === 'leaderboard' ? '<span class="badge badge-green">Leaderboard</span>' : '<span class="badge badge-amber">Attendance · 2.25M</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="method-box">${esc(data.dataQuality?.note || '')}</div>`;
  } catch (error) {
    console.warn('Could not load State Ruler scoring:', error);
    main.dataset.stateRulerLoaded = '0';
  }
}

async function enhanceHomeStateRuler() {
  const main = document.getElementById('main');
  if (!main?.querySelector('.hero')) return;
  const card = [...main.querySelectorAll('.feature-card')].find(node => node.querySelector('h2')?.textContent?.trim() === 'State Ruler');
  if (!card || card.dataset.v130Loaded === '1') return;
  card.dataset.v130Loaded = '1';
  try {
    const data = await api('/api/state-ruler');
    if (!(data.players || []).length) return;
    const copy = card.querySelector('p');
    const badge = card.querySelector('.badge');
    if (copy) copy.textContent = `${Number(data.summary?.leaderboardPlayers || 0)} leaderboard · ${Number(data.summary?.attendanceOnly || 0)} attendance-only`;
    if (badge) {
      badge.textContent = data.policy?.isBye ? 'Bye week' : 'Scores captured';
      badge.className = `badge ${data.policy?.isBye ? 'badge-amber' : 'badge-green'}`;
    }
  } catch (_) {}
}

async function enhanceScoringAdmin() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim();
  if (title !== 'Administrator') return;
  if (!document.getElementById('scoring-admin-v130')) mountScoringAdmin(main);
  if (!scoringAdmin) await loadScoringAdmin();
}

function mountScoringAdmin(main) {
  const panel = document.createElement('section');
  panel.id = 'scoring-admin-v130';
  panel.className = 'section panel duel-admin-panel';
  panel.innerHTML = `
    <div class="panel-head"><div><div class="panel-title">Event scoring & bye weeks</div><div class="muted">Weekly importance applies to Alliance Duel, State Ruler and Glory War. State Ruler attendance can be recorded separately from leaderboard score.</div></div></div>
    <div class="duel-admin-grid">
      <div class="duel-admin-card">
        <h3>Week importance</h3>
        <label>Cycle</label><select class="select" id="score-cycle"></select>
        <label>Event</label><select class="select" id="score-event"><option value="alliance_duel">Alliance Duel</option><option value="state_ruler">State Ruler / SVS</option><option value="glory_war">Glory War</option></select>
        <label>Week</label><select class="select" id="score-week">${[1,2,3,4].map(w => `<option value="${w}">Week ${w}</option>`).join('')}</select>
        <label class="score-check"><input type="checkbox" id="score-bye"> Declare this a Bye week</label>
        <label>Weight multiplier</label><input class="input" id="score-multiplier" type="number" min="0" max="2" step="0.05" value="1">
        <small class="muted">1.00 = normal. Bye currently defaults to 0.50 and can be changed.</small>
        <label>Note <span class="muted">optional</span></label><input class="input" id="score-note" maxlength="300" placeholder="Resource save week, low-stakes matchup, etc.">
        <div class="duel-admin-actions"><button class="btn btn-primary" id="score-save-policy">Save week policy</button></div>
        <div class="duel-admin-status" id="score-policy-status"></div>
      </div>
      <div class="duel-admin-card">
        <h3>State Ruler attendance</h3>
        <label>Player</label><select class="select" id="svs-player"></select>
        <label>Week</label><select class="select" id="svs-week">${[1,2,3,4].map(w => `<option value="${w}">Week ${w}</option>`).join('')}</select>
        <label class="score-check"><input type="checkbox" id="svs-attended"> Attended State Ruler</label>
        <label>Last online evidence <span class="muted">optional until automated</span></label><input class="input" id="svs-last-online" placeholder="ISO timestamp or leave blank">
        <label>Note</label><input class="input" id="svs-attendance-note" maxlength="240" placeholder="Manual attendance confirmation">
        <div class="duel-admin-actions"><button class="btn btn-primary" id="svs-save-attendance">Save attendance</button></div>
        <div class="duel-admin-status" id="svs-attendance-status"></div>
      </div>
    </div>`;
  main.appendChild(panel);
  ['score-cycle','score-event','score-week'].forEach(id => panel.querySelector(`#${id}`).addEventListener('change', fillPolicy));
  panel.querySelector('#score-bye').addEventListener('change', event => {
    if (event.target.checked && Number(panel.querySelector('#score-multiplier').value) === 1) panel.querySelector('#score-multiplier').value = '0.50';
  });
  panel.querySelector('#score-save-policy').addEventListener('click', savePolicy);
  panel.querySelector('#svs-save-attendance').addEventListener('click', saveAttendance);
}

async function loadScoringAdmin(preferredCycle = '') {
  try {
    const suffix = preferredCycle ? `?cycle=${encodeURIComponent(preferredCycle)}` : '';
    scoringAdmin = await api(`/api/admin/scoring-context${suffix}`);
    const cycle = document.getElementById('score-cycle');
    cycle.innerHTML = (scoringAdmin.cycles || []).map(row => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('');
    if (scoringAdmin.cycleId) cycle.value = scoringAdmin.cycleId;
    const player = document.getElementById('svs-player');
    player.innerHTML = (scoringAdmin.players || []).map(row => `<option value="${esc(row.publicId)}">${esc(row.name)} · S${Number(row.serverId || 0)}</option>`).join('');
    fillPolicy();
  } catch (error) {
    status('score-policy-status', error.message, true);
  }
}

function fillPolicy() {
  if (!scoringAdmin) return;
  const eventType = document.getElementById('score-event')?.value || 'alliance_duel';
  const week = Number(document.getElementById('score-week')?.value || 1);
  const row = (scoringAdmin.policies || []).find(item => item.eventType === eventType && Number(item.cycleWeek) === week);
  document.getElementById('score-bye').checked = Boolean(row?.isBye);
  document.getElementById('score-multiplier').value = String(row?.weightMultiplier ?? 1);
  document.getElementById('score-note').value = row?.note || '';
  status('score-policy-status', row?.isBye ? `Bye week · ${Math.round(Number(row.weightMultiplier || 0) * 100)}% weight` : 'Normal week · full weight');
}

async function savePolicy() {
  const cycleId = document.getElementById('score-cycle')?.value || '';
  const eventType = document.getElementById('score-event')?.value || '';
  const cycleWeek = Number(document.getElementById('score-week')?.value || 1);
  const isBye = document.getElementById('score-bye')?.checked || false;
  const weightMultiplier = Number(document.getElementById('score-multiplier')?.value || 1);
  const note = document.getElementById('score-note')?.value.trim() || '';
  try {
    await api('/api/admin/event-week-policy', { method: 'POST', body: JSON.stringify({ cycleId, eventType, cycleWeek, isBye, weightMultiplier, note }) });
    scoringAdmin = null;
    await loadScoringAdmin(cycleId);
    status('score-policy-status', 'Week policy saved.', false, true);
  } catch (error) { status('score-policy-status', error.message, true); }
}

async function saveAttendance() {
  const cycleId = document.getElementById('score-cycle')?.value || '';
  const publicId = document.getElementById('svs-player')?.value || '';
  const cycleWeek = Number(document.getElementById('svs-week')?.value || 1);
  const attended = document.getElementById('svs-attended')?.checked || false;
  const lastOnlineAt = document.getElementById('svs-last-online')?.value.trim() || '';
  const note = document.getElementById('svs-attendance-note')?.value.trim() || '';
  try {
    await api('/api/admin/state-ruler-attendance', { method: 'POST', body: JSON.stringify({ cycleId, cycleWeek, publicId, attended, lastOnlineAt, note }) });
    status('svs-attendance-status', attended ? 'Attendance saved. The 2.25M minimum credit applies unless a leaderboard score exists.' : 'Attendance cleared.', false, true);
  } catch (error) { status('svs-attendance-status', error.message, true); }
}

function metric(label, value) {
  return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div></article>`;
}
function format(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function status(id, message, error = false, success = false) {
  const node = document.getElementById(id); if (!node) return;
  node.textContent = message || ''; node.classList.toggle('error', error); node.classList.toggle('success', success && !error);
}
