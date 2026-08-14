import './app-v067.js';

let scheduled = false;
const duelCache = new Map();
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    await Promise.allSettled([
      enhanceDuelScoreScopes(),
      enhanceGloryWarPersistence(),
      enhanceHomeGloryWar(),
    ]);
  }, 35);
}

async function api(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'content-type': 'application/json' } });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function enhanceDuelScoreScopes() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent || '';
  const cycle = document.getElementById('cycle-select')?.value || '';
  const week = Number(document.getElementById('week-select')?.value || 0);
  const table = document.querySelector('#duel-table table');
  if (!title.startsWith('Alliance Duel') || !cycle || !week || !table) return;

  const key = `${cycle}|${week}`;
  let data = duelCache.get(key);
  if (!data) {
    try {
      data = await api(`/api/duel?cycle=${encodeURIComponent(cycle)}&week=${week}`);
      duelCache.set(key, data);
    } catch (error) {
      console.warn('Could not load Duel score scopes:', error);
      return;
    }
  }
  if (document.getElementById('cycle-select')?.value !== cycle || Number(document.getElementById('week-select')?.value || 0) !== week) return;

  const playerMap = new Map((data.players || []).map(row => [String(row.publicId || ''), row]));
  const headRow = table.querySelector('thead tr');
  if (headRow && !headRow.querySelector('[data-duel-league-total]')) {
    const th = document.createElement('th');
    th.className = 'numeric';
    th.dataset.duelLeagueTotal = '1';
    th.textContent = 'Duel League total';
    th.title = 'Cumulative score across the active four-week Alliance Duel league.';
    headRow.appendChild(th);
  }

  table.querySelectorAll('tbody tr[data-player]').forEach(row => {
    const player = playerMap.get(String(row.dataset.player || ''));
    let cell = row.querySelector('[data-duel-league-total]');
    if (!cell) {
      cell = document.createElement('td');
      cell.className = 'numeric';
      cell.dataset.duelLeagueTotal = '1';
      row.appendChild(cell);
    }
    cell.textContent = format(player?.duelLeagueTotal || 0);
    cell.dataset.label = 'Duel League total';
    cell.title = 'Cumulative score across all Alliance Duel weeks played in this four-week league.';
  });

  // Clarify the two totals at the summary level too.
  const metrics = [...main.querySelectorAll('.section.metrics .metric')];
  const weekMetric = metrics.find(node => /week total/i.test(node.querySelector('.metric-label')?.textContent || ''));
  if (weekMetric) {
    setText(weekMetric.querySelector('.metric-label'), 'Week total');
    setText(weekMetric.querySelector('.metric-note'), 'Current selected week only');
  }
  const metricsPanel = weekMetric?.parentElement;
  if (metricsPanel && !metricsPanel.querySelector('[data-duel-league-metric]')) {
    const article = document.createElement('article');
    article.className = 'metric';
    article.dataset.duelLeagueMetric = '1';
    article.innerHTML = `<div class="metric-label">Duel League total</div><div class="metric-value">${format(data.summary?.duelLeagueTotal || 0)}</div><div class="metric-note">Cumulative across the active four-week league</div>`;
    metricsPanel.appendChild(article);
  } else if (metricsPanel) {
    setText(metricsPanel.querySelector('[data-duel-league-metric] .metric-value'), format(data.summary?.duelLeagueTotal || 0));
  }
}

async function enhanceHomeGloryWar() {
  const main = document.getElementById('main');
  if (!main?.querySelector('.hero')) return;
  const card = [...main.querySelectorAll('.feature-card')].find(node =>
    (node.querySelector('h2')?.textContent || '').trim().startsWith('Glory War')
  );
  if (!card || card.dataset.v070GloryLoading === '1') return;
  card.dataset.v070GloryLoading = '1';
  try {
    const data = await api('/api/glory-war');
    if (!(data.players || []).length) return;
    const leader = data.players[0];
    setText(card.querySelector('p'), `Latest leader: ${leader?.name || 'Awaiting results'}`);
    const badge = card.querySelector('.badge');
    if (badge) {
      setText(badge, 'Latest results');
      badge.className = 'badge badge-purple';
    }
    card.dataset.v070GloryLoaded = '1';
  } catch (_) {
  } finally {
    card.dataset.v070GloryLoading = '0';
  }
}

async function enhanceGloryWarPersistence() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1');
  if (!title?.textContent.startsWith('Glory War')) return;
  const panel = main.querySelector('.coming') || main.querySelector('.panel');
  if (!panel || panel.dataset.v070GloryLoading === '1') return;
  panel.dataset.v070GloryLoading = '1';
  try {
    const data = await api('/api/glory-war');
    if (!(data.players || []).length) return;
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="panel-head"><div><div class="panel-title">Glory War · Latest captured results</div></div></div>
      <div class="table-wrap"><table class="responsive-table"><thead><tr><th>Rank</th><th>Player</th><th class="numeric">Score</th></tr></thead><tbody>
      ${(data.players || []).map(row => `<tr><td class="rank-cell">#${Number(row.rank || 0)}</td><td class="player-cell"><strong>${esc(row.name)}</strong><small>S${Number(row.serverId || 0)}</small></td><td class="numeric score">${format(row.creditedScore)}</td></tr>`).join('')}
      </tbody></table></div>`;
    panel.dataset.v070GloryLoaded = '1';
  } catch (error) {
    console.warn('Could not load persistent Glory War results:', error);
  } finally {
    panel.dataset.v070GloryLoading = '0';
  }
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}
function format(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
