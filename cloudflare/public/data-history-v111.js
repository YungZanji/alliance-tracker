let duelHistoryScheduled = false;
let duelHistoryBusy = false;

const duelHistoryObserver = new MutationObserver(scheduleDuelHistory);
duelHistoryObserver.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleDuelHistory);
scheduleDuelHistory();

function scheduleDuelHistory() {
  if (duelHistoryScheduled) return;
  duelHistoryScheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    duelHistoryScheduled = false;
    await mountDuelHistory();
  }, 90));
}

async function mountDuelHistory() {
  if (duelHistoryBusy) return;
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (!main || title !== 'Administrator' || main.querySelector('#duel-data-history')) return;

  duelHistoryBusy = true;
  try {
    const data = await historyApi('/api/admin/duel-restore-points');
    if (main !== document.getElementById('main')) return;

    const panel = document.createElement('section');
    panel.id = 'duel-data-history';
    panel.className = 'section panel duel-history-panel';
    panel.innerHTML = duelHistoryMarkup(data);
    main.appendChild(panel);
    bindDuelHistory(panel);
  } catch (error) {
    if (!/401|403|not authorized|admin/i.test(String(error?.message || ''))) {
      console.warn('Duel data history could not be loaded:', error);
    }
  } finally {
    duelHistoryBusy = false;
  }
}

function duelHistoryMarkup(data) {
  const weeks = data.weeks || [];
  const points = data.restorePoints || [];
  const defaultWeek = weeks[0] || {};
  return `
    <div class="panel-head duel-history-head">
      <div>
        <div class="eyebrow">ALLIANCE DUEL DATA</div>
        <div class="panel-title">Restore points</div>
        <div class="muted">A restore point is saved when Duel data changes. Preview an older state before restoring it.</div>
      </div>
      <div class="duel-history-actions">
        <select class="select" id="duel-history-week">
          ${weeks.map(row => `<option value="${escapeHistory(`${row.cycleId}|${row.cycleWeek}`)}">${escapeHistory(row.cycleId)} · Week ${Number(row.cycleWeek || 0)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" id="duel-history-save" type="button" ${defaultWeek.cycleId ? '' : 'disabled'}>Save current state</button>
        <button class="btn btn-secondary" id="duel-history-refresh" type="button">Refresh</button>
      </div>
    </div>
    <div id="duel-history-status" class="duel-history-status"></div>
    <div id="duel-history-preview"></div>
    <div id="duel-history-list">${renderRestorePoints(points)}</div>
  `;
}

function renderRestorePoints(points) {
  if (!points.length) {
    return '<div class="empty duel-history-empty">No restore points yet. The first one will be saved automatically the next time Alliance Duel data changes.</div>';
  }
  return `<div class="duel-history-list">${points.map(point => {
    const s = point.summary || {};
    const days = Array.isArray(s.dailyTotals) ? s.dailyTotals : [];
    return `<article class="duel-history-row" data-restore-id="${escapeHistory(point.restoreId)}">
      <div class="duel-history-row-main">
        <div class="duel-history-row-title">
          <strong>${escapeHistory(point.cycleId)} · Week ${Number(point.cycleWeek || 0)}</strong>
          <span>${escapeHistory(reasonLabel(point.reason))}</span>
        </div>
        <div class="duel-history-row-meta">
          <span>${escapeHistory(dateTime(point.createdAt))}</span>
          <span>Week ${compactHistory(s.weeklyTotal)}</span>
          <span>League ${compactHistory(s.duelLeagueTotal)}</span>
          <span>${Number(s.weeklyPlayers || 0)} players</span>
        </div>
        <div class="duel-history-days">${days.map((value, index) => `<span>D${index + 1} <b>${compactHistory(value)}</b></span>`).join('')}</div>
      </div>
      <div class="duel-history-row-actions">
        <button class="btn btn-secondary duel-history-preview-button" type="button">Preview</button>
        <button class="btn duel-history-restore-button" type="button">Restore</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function bindDuelHistory(panel) {
  panel.querySelector('#duel-history-refresh')?.addEventListener('click', () => reloadDuelHistory(panel));
  panel.querySelector('#duel-history-save')?.addEventListener('click', async () => {
    const select = panel.querySelector('#duel-history-week');
    const [cycleId, weekValue] = String(select?.value || '').split('|');
    const cycleWeek = Number(weekValue || 0);
    if (!cycleId || cycleWeek < 1 || cycleWeek > 4) return;
    setHistoryStatus(panel, 'Saving current state…');
    try {
      const result = await historyApi('/api/admin/duel-restore-points', {
        method: 'POST',
        body: JSON.stringify({ cycleId, cycleWeek }),
      });
      setHistoryStatus(panel, result.created ? 'Restore point saved.' : 'Current state is already saved.', true);
      await reloadDuelHistory(panel, false);
    } catch (error) {
      setHistoryStatus(panel, error.message, false, true);
    }
  });

  bindDuelHistoryRows(panel);
}

async function reloadDuelHistory(panel, showLoading = true) {
  if (showLoading) setHistoryStatus(panel, 'Refreshing…');
  const data = await historyApi('/api/admin/duel-restore-points');
  const list = panel.querySelector('#duel-history-list');
  if (list) list.innerHTML = renderRestorePoints(data.restorePoints || []);

  const select = panel.querySelector('#duel-history-week');
  const selected = select?.value || '';
  if (select) {
    select.innerHTML = (data.weeks || []).map(row =>
      `<option value="${escapeHistory(`${row.cycleId}|${row.cycleWeek}`)}">${escapeHistory(row.cycleId)} · Week ${Number(row.cycleWeek || 0)}</option>`
    ).join('');
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }
  panel.querySelector('#duel-history-save').disabled = !(data.weeks || []).length;
  bindDuelHistoryRows(panel);
  if (showLoading) setHistoryStatus(panel, '');
}

function bindDuelHistoryRows(panel) {
  panel.querySelectorAll('.duel-history-preview-button').forEach(button => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const restoreId = button.closest('[data-restore-id]')?.dataset.restoreId || '';
      if (!restoreId) return;
      button.disabled = true;
      try {
        const result = await historyApi(`/api/admin/duel-restore-points/${encodeURIComponent(restoreId)}`);
        showRestorePreview(panel, result.restorePoint);
      } catch (error) {
        setHistoryStatus(panel, error.message, false, true);
      } finally { button.disabled = false; }
    });
  });

  panel.querySelectorAll('.duel-history-restore-button').forEach(button => {
    if (button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const row = button.closest('[data-restore-id]');
      const restoreId = row?.dataset.restoreId || '';
      const title = row?.querySelector('.duel-history-row-title strong')?.textContent || 'this restore point';
      if (!restoreId || !confirm(`Restore ${title} to this saved state?\n\nThe current state will be saved first, so this restore can be undone.`)) return;
      button.disabled = true;
      button.textContent = 'Restoring…';
      setHistoryStatus(panel, 'Saving the current state and restoring the selected version…');
      try {
        await historyApi(`/api/admin/duel-restore-points/${encodeURIComponent(restoreId)}/restore`, { method: 'POST', body: '{}' });
        setHistoryStatus(panel, 'Alliance Duel data restored. Reload the Duel page to see the restored scores.', true);
        await reloadDuelHistory(panel, false);
      } catch (error) {
        setHistoryStatus(panel, error.message, false, true);
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = 'Restore';
        }
      }
    });
  });
}

function showRestorePreview(panel, point) {
  const host = panel.querySelector('#duel-history-preview');
  if (!host || !point) return;
  const s = point.summary || {};
  const days = Array.isArray(s.dailyTotals) ? s.dailyTotals : [];
  const leaders = [...(point.weekly || [])]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 8);

  host.innerHTML = `<div class="duel-history-preview">
    <div class="duel-history-preview-head">
      <div>
        <div class="eyebrow">PREVIEW</div>
        <strong>${escapeHistory(point.cycleId)} · Week ${Number(point.cycleWeek || 0)}</strong>
        <span>${escapeHistory(dateTime(point.createdAt))} · ${escapeHistory(reasonLabel(point.reason))}</span>
      </div>
      <button type="button" class="duel-history-preview-close" aria-label="Close preview">×</button>
    </div>
    <div class="duel-history-preview-metrics">
      <span><small>Week total</small><b>${compactHistory(s.weeklyTotal)}</b></span>
      <span><small>Duel league total</small><b>${compactHistory(s.duelLeagueTotal)}</b></span>
      <span><small>Players</small><b>${Number(s.weeklyPlayers || 0)}</b></span>
      <span><small>Last capture</small><b>${escapeHistory(dateTime(s.latestCapture))}</b></span>
    </div>
    <div class="duel-history-preview-days">${days.map((value, index) => `<span><small>Day ${index + 1}</small><b>${compactHistory(value)}</b></span>`).join('')}</div>
    ${leaders.length ? `<div class="duel-history-preview-leaders"><strong>Top weekly scores in this state</strong>${leaders.map((row, index) => `<span><b>#${index + 1} ${escapeHistory(row.name_at_capture || row.uid || '')}</b><em>${compactHistory(row.score)}</em></span>`).join('')}</div>` : ''}
  </div>`;
  host.querySelector('.duel-history-preview-close')?.addEventListener('click', () => { host.innerHTML = ''; });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function historyApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setHistoryStatus(panel, text, success = false, error = false) {
  const host = panel.querySelector('#duel-history-status');
  if (!host) return;
  host.textContent = text || '';
  host.classList.toggle('success', Boolean(success));
  host.classList.toggle('error', Boolean(error));
}

function reasonLabel(reason) {
  return ({
    before_sync: 'Before sync',
    after_sync: 'After sync',
    manual: 'Manual save',
    before_restore: 'Before restore',
    after_restore: 'Restored state',
  })[String(reason || '')] || String(reason || 'Saved state').replaceAll('_', ' ');
}

function compactHistory(value) {
  const number = Number(value || 0);
  const abs = Math.abs(number);
  if (abs >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
}

function dateTime(value) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return String(value || '—');
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHistory(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}
