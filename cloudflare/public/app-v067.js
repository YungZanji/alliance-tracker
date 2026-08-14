import './app-v066.js';

let scheduled = false;
let adminOverview = null;
let adminOverviewCycle = '';
let homeRequest = 0;
let rulerRequest = 0;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  adminOverview = null;
  adminOverviewCycle = '';
  schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    await Promise.allSettled([
      enhanceHome(),
      enhanceDuel(),
      enhanceStateRuler(),
      enhanceGloryWar(),
      enhanceAdminOverview(),
    ]);
  }, 20);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

async function enhanceHome() {
  const main = document.getElementById('main');
  if (!main?.querySelector('.hero')) return;
  const sentinel = findFeatureCard('Alliance Duel') || findFeatureCard('State Ruler');
  if (sentinel?.dataset.v069HomeLoaded === '1' || sentinel?.dataset.v069HomeLoading === '1') return;
  if (sentinel) sentinel.dataset.v069HomeLoading = '1';
  const requestId = ++homeRequest;
  try {
    const [duelContext, ruler] = await Promise.all([
      api('/api/duel-context'),
      api('/api/state-ruler'),
    ]);
    if (requestId !== homeRequest || !document.getElementById('main')?.querySelector('.hero')) return;

    const duelCard = findFeatureCard('Alliance Duel');
    if (duelCard) {
      const opponent = duelContext.currentOpponent || selectedDuelOpponent(duelContext);
      const title = duelCard.querySelector('h2');
      setText(title, opponent?.abbr ? `Alliance Duel: WDZ vs ${opponent.abbr}` : 'Alliance Duel');
      const copy = duelCard.querySelector('p');
      let leader = null;
      if (duelContext.cycleId && duelContext.cycleWeek) {
        try {
          const duel = await api(`/api/duel?cycle=${encodeURIComponent(duelContext.cycleId)}&week=${Number(duelContext.cycleWeek)}`);
          leader = [...(duel.players || [])].sort((a, b) => Number(b.weeklyScore || 0) - Number(a.weeklyScore || 0))[0] || null;
        } catch (_) {}
      }
      setText(copy, `Current leader: ${leader?.name || 'Awaiting scores'}`);
      if (title && opponent?.name) title.title = `${opponent.abbr} · ${opponent.name}`;
      duelCard.dataset.v069HomeLoaded = '1';
    }

    const rulerCard = findFeatureCard('State Ruler');
    if (rulerCard) {
      const title = rulerCard.querySelector('h2');
      const opponentState = Number(ruler.matchup?.opponentState || 0);
      setText(title, opponentState ? `State Ruler: 305 vs ${opponentState}` : 'State Ruler');
      setText(rulerCard.querySelector('p'), `Current leader: ${ruler.currentLeader?.name || ruler.players?.[0]?.name || 'Awaiting results'}`);
      const badge = rulerCard.querySelector('.badge');
      if (badge) {
        const text = (ruler.players || []).length ? (ruler.policy?.isBye ? 'Bye week' : 'Live') : 'Awaiting results';
        setText(badge, text);
        badge.className = `badge ${(ruler.players || []).length ? (ruler.policy?.isBye ? 'badge-amber' : 'badge-green') : 'badge-amber'}`;
      }
      rulerCard.dataset.v069HomeLoaded = '1';
    }

    const gloryCard = findFeatureCard('Glory War');
    if (gloryCard) {
      setText(gloryCard.querySelector('p'), 'Awaiting season start');
      const badge = gloryCard.querySelector('.badge');
      if (badge) {
        setText(badge, 'Awaiting season start');
        badge.className = 'badge badge-purple';
      }
      gloryCard.dataset.v069HomeLoaded = '1';
    }
  } catch (error) {
    console.warn('Could not refresh Home event context:', error);
  } finally {
    if (sentinel) sentinel.dataset.v069HomeLoading = '0';
  }
}

function findFeatureCard(prefix) {
  return [...document.querySelectorAll('#main .feature-card')].find(card =>
    (card.querySelector('h2')?.textContent || '').trim().startsWith(prefix)
  );
}

async function enhanceDuel() {
  const main = document.getElementById('main');
  const pageTitle = main?.querySelector('.page-head h1');
  const cycleSelect = document.getElementById('cycle-select');
  const weekSelect = document.getElementById('week-select');
  const table = document.querySelector('#duel-table table');
  if (!pageTitle?.textContent.startsWith('Alliance Duel') || !cycleSelect || !weekSelect || !cycleSelect.value || !table) return;

  const cycleId = cycleSelect.value;
  const cycleWeek = Number(weekSelect.value || 1);
  const key = `${cycleId}|${cycleWeek}|${table.querySelectorAll('tbody tr[data-player]').length}`;
  if (table.dataset.v069ContextKey === key || table.dataset.v069ContextLoading === '1') return;
  table.dataset.v069ContextLoading = '1';
  try {
    const data = await api(`/api/duel-context?cycle=${encodeURIComponent(cycleId)}&week=${cycleWeek}`);
    if (document.getElementById('cycle-select')?.value !== cycleId || Number(document.getElementById('week-select')?.value || 1) !== cycleWeek) return;

    for (const option of [...weekSelect.options]) {
      const context = (data.weeks || []).find(row => Number(row.cycleWeek) === Number(option.value));
      const opponent = context?.opponent;
      const next = opponent?.abbr ? `Week ${Number(option.value)} · WDZ vs ${opponent.abbr}` : `Week ${Number(option.value)}`;
      setText(option, next);
    }

    const selected = (data.weeks || []).find(row => Number(row.cycleWeek) === cycleWeek);
    const opponent = selected?.opponent;
    setText(pageTitle, opponent?.abbr ? `Alliance Duel: Week ${cycleWeek} · WDZ vs ${opponent.abbr}` : `Alliance Duel: Week ${cycleWeek}`);

    const panelTitle = [...main.querySelectorAll('.panel-title')].find(node => /^Week\s+\d+/i.test(node.textContent || ''));
    if (panelTitle) setText(panelTitle, opponent?.abbr ? `Week ${cycleWeek} · WDZ vs ${opponent.abbr} player scores` : `Week ${cycleWeek} player scores`);

    applyLeaveBadges(table, data.leave || []);
    table.dataset.v069ContextKey = key;
  } catch (error) {
    console.warn('Could not refresh Duel opponent/leave context:', error);
  } finally {
    table.dataset.v069ContextLoading = '0';
  }
}

function applyLeaveBadges(table, leaves) {
  const leaveMap = new Map(leaves.map(row => [String(row.publicId), row]));
  table.querySelectorAll('tbody tr[data-player]').forEach(row => {
    const leave = leaveMap.get(String(row.dataset.player || ''));
    const playerCell = row.querySelector('.player-cell') || row.children[1];
    if (!playerCell) return;
    let badge = playerCell.querySelector('.player-leave-badge');
    if (!leave) {
      badge?.remove();
      row.classList.remove('player-on-leave');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'player-leave-badge';
      const strong = playerCell.querySelector('strong');
      if (strong) strong.insertAdjacentElement('afterend', badge);
      else playerCell.prepend(badge);
    }
    setText(badge, 'On Leave');
    const nextTitle = leave.note || 'Marked On Leave for this week.';
    if (badge.title !== nextTitle) badge.title = nextTitle;
    row.classList.add('player-on-leave');
  });
}

async function enhanceStateRuler() {
  const main = document.getElementById('main');
  const pageTitle = main?.querySelector('.page-head h1');
  if (!pageTitle || !pageTitle.textContent.startsWith('State Ruler')) return;
  const panelBefore = main.querySelector('.state-ruler-panel') || main.querySelector('.coming') || main.querySelector('.panel');
  if (panelBefore?.dataset.v069RulerLoading === '1') return;
  if (panelBefore) panelBefore.dataset.v069RulerLoading = '1';
  const requestId = ++rulerRequest;
  try {
    const data = await api('/api/state-ruler');
    if (requestId !== rulerRequest) return;
    const currentMain = document.getElementById('main');
    if (!currentMain?.querySelector('.page-head h1')?.textContent.startsWith('State Ruler')) return;

    const opponentState = Number(data.matchup?.opponentState || 0);
    setText(currentMain.querySelector('.page-head h1'), opponentState ? `State Ruler: 305 vs ${opponentState}` : 'State Ruler');
    currentMain.querySelectorAll('.page-head .badge').forEach(node => { if (/discovery/i.test(node.textContent || '')) node.remove(); });

    const panel = currentMain.querySelector('.state-ruler-panel') || currentMain.querySelector('.coming') || currentMain.querySelector('.panel');
    if (!panel) return;
    const key = `${data.cycleId || ''}|${Number(data.cycleWeek || 1)}|${(data.players || []).length}|${data.players?.[0]?.creditedScore || 0}|${data.policy?.isBye ? 1 : 0}|${opponentState}`;
    const alreadyClean = panel.dataset.v069RulerKey === key && !panel.querySelector('.panel-head .muted') && !panel.querySelector('.method-box');
    if (alreadyClean) return;

    if (!(data.players || []).length) {
      panel.className = 'panel state-ruler-panel';
      panel.innerHTML = '<div class="state-ruler-empty"><h2>Awaiting results</h2><p class="muted">Results will appear here when available.</p></div>';
      panel.dataset.v069RulerKey = key;
      return;
    }

    const s = data.summary || {};
    panel.className = 'panel state-ruler-panel';
    panel.innerHTML = `
      <div class="panel-head"><div><div class="panel-title">State Ruler · Week ${Number(data.cycleWeek || 1)}</div></div>${data.policy?.isBye ? `<span class="badge badge-amber">Bye · ${Math.round(Number(data.policy.weightMultiplier || 0) * 100)}% weight</span>` : ''}</div>
      <div class="metrics state-ruler-metrics">
        ${metric('Captured players', s.players)}
        ${metric('Leaderboard', s.leaderboardPlayers)}
        ${metric('Attendance only', s.attendanceOnly)}
        ${metric('Attendance floor', format(s.attendanceFloor))}
      </div>
      <div class="table-wrap"><table class="responsive-table"><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Credited score</th><th class="numeric">Index</th><th>Credit</th></tr></thead><tbody>
      ${(data.players || []).map(row => `<tr><td class="rank-cell">#${Number(row.rank)}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>S${Number(row.serverId || 0)}</small></td><td class="numeric score">${format(row.creditedScore)}</td><td class="numeric">${Number(row.normalizedIndex || 0).toFixed(1)}</td><td>${row.creditSource === 'leaderboard' ? '<span class="badge badge-green">Leaderboard</span>' : '<span class="badge badge-amber">Attendance · 2.25M</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
    panel.dataset.v069RulerKey = key;
  } catch (error) {
    console.warn('Could not refresh State Ruler:', error);
  } finally {
    const panel = document.getElementById('main')?.querySelector('.state-ruler-panel') || panelBefore;
    if (panel) panel.dataset.v069RulerLoading = '0';
  }
}

function enhanceGloryWar() {
  const main = document.getElementById('main');
  const pageTitle = main?.querySelector('.page-head h1');
  if (!pageTitle?.textContent.startsWith('Glory War')) return;
  main.querySelectorAll('.page-head .badge').forEach(node => { if (/discovery/i.test(node.textContent || '')) node.remove(); });
}

async function enhanceAdminOverview() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim();
  if (title !== 'Administrator') return;
  if (!document.getElementById('absence-bye-overview')) mountAdminOverview(main);
  if (!adminOverview) await loadAdminOverview(adminOverviewCycle);
}

function mountAdminOverview(main) {
  const section = document.createElement('section');
  section.id = 'absence-bye-overview';
  section.className = 'section panel context-overview-panel';
  section.innerHTML = `
    <div class="panel-head"><div><div class="panel-title">Absences & Bye Weeks</div><div class="muted">One place to review weekly leave, reduced-weight weeks, and event matchups.</div></div><select class="select" id="context-cycle" style="min-width:220px"></select></div>
    <div class="context-overview-grid">
      <div class="context-summary-card"><h3>Player absences</h3><div id="context-leaves" class="context-list"><span class="muted">Loading…</span></div></div>
      <div class="context-summary-card"><h3>Bye weeks</h3><div id="context-byes" class="context-list"><span class="muted">Loading…</span></div></div>
      <div class="context-summary-card"><h3>Matchups</h3><div id="context-matchups" class="context-list"><span class="muted">Loading…</span></div></div>
    </div>
    <div class="context-matchup-editor">
      <div><strong>State Ruler opponent</strong><div class="muted">Store the opposing state for each SVS week.</div></div>
      <select class="select" id="context-ruler-week">${[1,2,3,4].map(w => `<option value="${w}">Week ${w}</option>`).join('')}</select>
      <input class="input" id="context-ruler-state" type="number" min="1" max="99999" placeholder="Opponent state">
      <button class="btn btn-primary" id="context-ruler-save">Save opponent</button>
      <span id="context-ruler-status" class="duel-admin-status"></span>
    </div>`;
  main.appendChild(section);
  section.querySelector('#context-cycle').addEventListener('change', event => {
    adminOverview = null;
    adminOverviewCycle = event.target.value;
    loadAdminOverview(adminOverviewCycle);
  });
  section.querySelector('#context-ruler-week').addEventListener('change', fillRulerOpponentEditor);
  section.querySelector('#context-ruler-save').addEventListener('click', saveRulerOpponent);
}

async function loadAdminOverview(preferredCycle = '') {
  try {
    const suffix = preferredCycle ? `?cycle=${encodeURIComponent(preferredCycle)}` : '';
    adminOverview = await api(`/api/admin/event-overview${suffix}`);
    adminOverviewCycle = adminOverview.cycleId || preferredCycle || '';
    const cycle = document.getElementById('context-cycle');
    if (!cycle) return;
    cycle.innerHTML = (adminOverview.cycles || []).map(row => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('');
    if (adminOverviewCycle) cycle.value = adminOverviewCycle;
    renderAdminOverview();
  } catch (error) {
    console.warn('Could not load absence/bye overview:', error);
  }
}

function renderAdminOverview() {
  if (!adminOverview) return;
  const leaves = document.getElementById('context-leaves');
  const byes = document.getElementById('context-byes');
  const matchups = document.getElementById('context-matchups');
  if (leaves) leaves.innerHTML = (adminOverview.leaves || []).length
    ? adminOverview.leaves.map(row => `<div class="context-row"><span><strong>${esc(row.name)}</strong><small>Week ${Number(row.cycleWeek)} · S${Number(row.serverId || 0)}</small></span><span class="badge badge-amber">On Leave</span>${row.note ? `<small class="context-note">${esc(row.note)}</small>` : ''}</div>`).join('')
    : '<span class="muted">No players are marked On Leave in this cycle.</span>';

  const byeRows = (adminOverview.policies || []).filter(row => row.isBye);
  if (byes) byes.innerHTML = byeRows.length
    ? byeRows.map(row => `<div class="context-row"><span><strong>${esc(eventLabel(row.eventType))}</strong><small>Week ${Number(row.cycleWeek)}</small></span><span class="badge badge-amber">${Math.round(Number(row.weightMultiplier || 0) * 100)}% weight</span>${row.note ? `<small class="context-note">${esc(row.note)}</small>` : ''}</div>`).join('')
    : '<span class="muted">No Bye weeks are set in this cycle.</span>';

  const matchupRows = [
    ...(adminOverview.duelMatchups || []).map(row => ({ week: row.cycleWeek, label: 'Alliance Duel', value: row.opponentAbbr ? `WDZ vs ${row.opponentAbbr}` : 'Not set' })),
    ...(adminOverview.stateRulerMatchups || []).map(row => ({ week: row.cycleWeek, label: 'State Ruler', value: row.opponentState ? `305 vs ${row.opponentState}` : 'Not set' })),
  ].sort((a, b) => a.week - b.week || a.label.localeCompare(b.label));
  if (matchups) matchups.innerHTML = matchupRows.length
    ? matchupRows.map(row => `<div class="context-row"><span><strong>${esc(row.label)}</strong><small>Week ${Number(row.week)}</small></span><span>${esc(row.value)}</span></div>`).join('')
    : '<span class="muted">No matchup context is stored yet.</span>';
  fillRulerOpponentEditor();
}

function fillRulerOpponentEditor() {
  if (!adminOverview) return;
  const week = Number(document.getElementById('context-ruler-week')?.value || 1);
  const row = (adminOverview.stateRulerMatchups || []).find(item => Number(item.cycleWeek) === week);
  const input = document.getElementById('context-ruler-state');
  if (input) input.value = row?.opponentState || '';
  setContextStatus(row?.opponentState ? `305 vs ${row.opponentState}` : 'No State Ruler opponent stored for this week.');
}

async function saveRulerOpponent() {
  const cycleId = document.getElementById('context-cycle')?.value || adminOverviewCycle;
  const cycleWeek = Number(document.getElementById('context-ruler-week')?.value || 1);
  const opponentState = Number(document.getElementById('context-ruler-state')?.value || 0);
  try {
    await api('/api/admin/state-ruler-context', { method: 'POST', body: JSON.stringify({ cycleId, cycleWeek, opponentState }) });
    setContextStatus('State Ruler opponent saved.', true);
    adminOverview = null;
    await loadAdminOverview(cycleId);
  } catch (error) {
    setContextStatus(error.message, false, true);
  }
}

function setContextStatus(message, success = false, error = false) {
  const node = document.getElementById('context-ruler-status');
  if (!node) return;
  setText(node, message || '');
  node.classList.toggle('success', success && !error);
  node.classList.toggle('error', error);
}

function selectedDuelOpponent(data) {
  return (data.weeks || []).find(row => Number(row.cycleWeek) === Number(data.cycleWeek))?.opponent || null;
}
function eventLabel(value) {
  return ({ alliance_duel: 'Alliance Duel', state_ruler: 'State Ruler', glory_war: 'Glory War' })[value] || value;
}
function metric(label, value) {
  return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div></article>`;
}
function format(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
