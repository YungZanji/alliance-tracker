import './app-v061.js';

const DUEL_DAILY_TARGET = 6_000_000;
const DUEL_RANK_CACHE_MS = 5_000;
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
  if (cached && Date.now() - Number(cached.fetchedAt || 0) < DUEL_RANK_CACHE_MS) {
    paintStableRanks(table, cached.rankMap);
    paintDuelContext(cached.matchup);
    return;
  }

  if (cached?.loading) return;
  duelRankCache.set(key, { ...(cached || {}), loading: true, fetchedAt: Number(cached?.fetchedAt || 0) });
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

    const dayIndex = metric === 'weekly' ? -1 : Number(metric.slice(3)) - 1;
    const rankMap = new Map(ranked.map((row, index) => {
      const fallbackAllianceRank = index + 1;
      const allianceRank = metric === 'weekly'
        ? Number(row.weeklyAlliancePosition || row.weeklyPosition || fallbackAllianceRank)
        : Number(row.dayAlliancePositions?.[dayIndex] || fallbackAllianceRank);
      const overallRank = metric === 'weekly'
        ? Number(row.weeklyOverallPosition || 0)
        : Number(row.dayOverallPositions?.[dayIndex] || 0);
      return [String(row.publicId), { allianceRank, overallRank }];
    }));

    const cacheValue = { rankMap, matchup: data.matchup || null, fetchedAt: Date.now(), loading: false };
    duelRankCache.set(key, cacheValue);
    paintDuelContext(data.matchup || null);

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
    if (!cell || !rank?.allianceRank) return;

    const allianceRank = String(rank.allianceRank);
    if (cell.dataset.stableRank === allianceRank && cell.textContent.trim() === allianceRank) return;
    cell.textContent = allianceRank;
    cell.dataset.stableRank = allianceRank;
    delete cell.dataset.overallRank;
    cell.title = `WDZ rank ${allianceRank}`;
  });
}

function paintDuelContext(matchup) {
  const host = document.getElementById('duel-content');
  if (!host) return;
  const existing = host.querySelector('.duel-live-context');
  if (!matchup?.capturedAt) {
    existing?.remove();
    return;
  }

  const captured = `Last synced: ${new Date(matchup.capturedAt).toLocaleString()}`;
  const signature = captured;
  if (existing?.dataset.matchupSignature === signature) return;

  const panel = existing || document.createElement('section');
  panel.className = 'method-box duel-live-context';
  panel.dataset.matchupSignature = signature;
  panel.textContent = captured;
  if (!existing) host.insertAdjacentElement('afterbegin', panel);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}
