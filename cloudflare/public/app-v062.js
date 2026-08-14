import './app-v061.js';

const DUEL_DAILY_TARGET = 6_000_000;
const duelRankCache = new Map();
let scheduled = false;

const observer = new MutationObserver(scheduleEnhancements);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleEnhancements);
window.addEventListener('resize', scheduleEnhancements, { passive: true });
scheduleEnhancements();

function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceTables();
    enhanceAllianceDuel();
  });
}

function enhanceTables() {
  document.querySelectorAll('.table-wrap table').forEach(table => {
    table.classList.add('responsive-table');
    const headers = [...table.querySelectorAll('thead th')].map(header => header.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (headers[index]) cell.dataset.label = headers[index];
      });
    });
  });
}

function enhanceAllianceDuel() {
  const table = document.querySelector('#duel-table table');
  if (!table) return;
  markDailyScores(table);
  applyStableDuelRanks(table);
}

function markDailyScores(table) {
  const headers = [...table.querySelectorAll('thead th')].map(header => header.textContent.trim());
  const dailyIndexes = headers
    .map((label, index) => ({ label, index }))
    .filter(item => /^D[1-6]\b/i.test(item.label));

  table.querySelectorAll('tbody tr').forEach(row => {
    dailyIndexes.forEach(({ index }) => {
      const cell = row.children[index];
      if (!cell) return;
      const score = Number(cell.textContent.replace(/[^0-9.-]/g, '')) || 0;
      cell.classList.add('duel-daily-score');
      cell.classList.toggle('duel-daily-low', score < DUEL_DAILY_TARGET);
      cell.classList.toggle('duel-daily-met', score >= DUEL_DAILY_TARGET);
      cell.title = score < DUEL_DAILY_TARGET
        ? `${cell.textContent.trim()} · below 6,000,000`
        : `${cell.textContent.trim()} · 6,000,000+`;
    });
  });
}

async function applyStableDuelRanks(table) {
  const cycle = document.getElementById('cycle-select')?.value || '';
  const week = Number(document.getElementById('week-select')?.value || 1);
  const metric = document.getElementById('duel-metric')?.value || 'weekly';
  if (!cycle) return;

  const key = `${cycle}|${week}|${metric}`;
  const cached = duelRankCache.get(key);
  if (cached) {
    paintStableRanks(table, cached);
    return;
  }

  duelRankCache.set(key, null);
  try {
    const response = await fetch(`/api/duel?cycle=${encodeURIComponent(cycle)}&week=${week}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Could not load rank data');

    const metricValue = row => metric === 'weekly'
      ? Number(row.weeklyScore || 0)
      : Number(row.dayScores?.[Number(metric.slice(3)) - 1] || 0);

    const ranked = [...(data.players || [])].sort((a, b) =>
      metricValue(b) - metricValue(a)
      || Number(b.weeklyScore || 0) - Number(a.weeklyScore || 0)
      || String(a.name || '').localeCompare(String(b.name || ''))
    );

    const rankMap = new Map(ranked.map((row, index) => [String(row.publicId), index + 1]));
    duelRankCache.set(key, rankMap);

    const currentKey = `${document.getElementById('cycle-select')?.value || ''}|${Number(document.getElementById('week-select')?.value || 1)}|${document.getElementById('duel-metric')?.value || 'weekly'}`;
    if (currentKey === key) {
      const currentTable = document.querySelector('#duel-table table');
      if (currentTable) paintStableRanks(currentTable, rankMap);
    }
  } catch (error) {
    duelRankCache.delete(key);
    console.warn('Could not preserve Alliance Duel ranks:', error);
  }
}

function paintStableRanks(table, rankMap) {
  table.querySelectorAll('tbody tr[data-player]').forEach(row => {
    const rank = rankMap.get(String(row.dataset.player));
    const cell = row.querySelector('.rank-cell');
    if (!cell || !rank) return;
    const label = `#${rank}`;
    if (cell.textContent.trim() !== label) cell.textContent = label;
    cell.dataset.stableRank = String(rank);
  });
}
