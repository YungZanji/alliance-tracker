let scheduled = false;
let busy = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    await mount();
  }, 90));
}

async function mount() {
  if (busy) return;
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (!main || title !== 'Administrator' || main.querySelector('#duel-data-history')) return;

  busy = true;
  try {
    const data = await api('/api/admin/duel-restore-points');
    if (main !== document.getElementById('main')) return;
    const weeks = data.weeks || [];
    const selected = weeks[0] || {};

    const panel = document.createElement('section');
    panel.id = 'duel-data-history';
    panel.className = 'section panel duel-history-panel';
    panel.innerHTML = `
      <div class="panel-head duel-history-head">
        <div>
          <div class="eyebrow">ALLIANCE DUEL DATA</div>
          <div class="panel-title">Data history & restore</div>
          <div class="muted">Automatic restore points protect new changes. Historical sync checkpoints let you preview and rewind older score states that existed before this feature was added.</div>
        </div>
        <div class="duel-history-actions">
          <select class="select" id="duel-history-week">
            ${weeks.map(row => `<option value="${esc(`${row.cycleId}|${row.cycleWeek}`)}">${esc(row.cycleId)} · Week ${Number(row.cycleWeek || 0)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary" id="duel-history-save" type="button" ${selected.cycleId ? '' : 'disabled'}>Snapshot current state</button>
          <button class="btn btn-secondary" id="duel-history-refresh" type="button">Refresh</button>
        </div>
      </div>
      <div id="duel-history-status" class="duel-history-status"></div>
      <div id="duel-history-preview"></div>
      <div class="duel-history-list">
        <div>
          <div class="eyebrow">SAVED RESTORE POINTS</div>
          <div class="muted">Full saved states. Restoring one also saves the current state first.</div>
        </div>
      </div>
      <div id="duel-history-list"></div>
      <div class="duel-history-list">
        <div>
          <div class="eyebrow">HISTORICAL SYNC CHECKPOINTS</div>
          <div class="muted">Built from the existing capture and score-change history, including scans from before restore points existed.</div>
        </div>
      </div>
      <div id="duel-history-checkpoints"></div>
    `;
    main.appendChild(panel);
    bind(panel);
    await reload(panel, false);
  } catch (error) {
    if (!/401|403|not authorized|admin/i.test(String(error?.message || ''))) {
      console.warn('Duel data history could not be loaded:', error);
    }
  } finally {
    busy = false;
  }
}

function bind(panel) {
  panel.querySelector('#duel-history-refresh')?.addEventListener('click', () => reload(panel));
  panel.querySelector('#duel-history-week')?.addEventListener('change', () => reload(panel));

  panel.querySelector('#duel-history-save')?.addEventListener('click', async () => {
    const target = selectedWeek(panel);
    if (!target.cycleId) return;
    status(panel, 'Saving a full snapshot of the current state…');
    try {
      const result = await api('/api/admin/duel-restore-points', {
        method: 'POST',
        body: JSON.stringify(target),
      });
      status(panel, result.created ? 'Current state saved.' : 'This exact current state was already saved.', true);
      await reload(panel, false);
    } catch (error) {
      status(panel, error.message, false, true);
    }
  });
}

async function reload(panel, showLoading = true) {
  const target = selectedWeek(panel);
  if (!target.cycleId) return;
  if (showLoading) status(panel, 'Loading data history…');

  const [restoreData, historyData] = await Promise.all([
    api(`/api/admin/duel-restore-points?cycle=${encodeURIComponent(target.cycleId)}&week=${target.cycleWeek}`),
    api(`/api/admin/duel-history-checkpoints?cycle=${encodeURIComponent(target.cycleId)}&week=${target.cycleWeek}`),
  ]);

  const list = panel.querySelector('#duel-history-list');
  if (list) list.innerHTML = renderRestorePoints(restoreData.restorePoints || []);

  const history = panel.querySelector('#duel-history-checkpoints');
  if (history) history.innerHTML = renderHistory(historyData.checkpoints || []);

  const selector = panel.querySelector('#duel-history-week');
  const selectedValue = selector?.value || '';
  if (selector) {
    selector.innerHTML = (restoreData.weeks || []).map(row =>
      `<option value="${esc(`${row.cycleId}|${row.cycleWeek}`)}">${esc(row.cycleId)} · Week ${Number(row.cycleWeek || 0)}</option>`
    ).join('');
    if ([...selector.options].some(option => option.value === selectedValue)) selector.value = selectedValue;
  }
  bindRows(panel);
  if (showLoading) status(panel, '');
}

function renderRestorePoints(points) {
  if (!points.length) {
    return '<div class="empty duel-history-empty">No full restore point exists for this week yet. Use “Snapshot current state”, or use the historical sync checkpoints below.</div>';
  }
  return `<div class="duel-history-list">${points.map(point => {
    const s = point.summary || {};
    const days = Array.isArray(s.dailyTotals) ? s.dailyTotals : [];
    return `<article class="duel-history-row" data-restore-id="${esc(point.restoreId)}">
      <div class="duel-history-row-main">
        <div class="duel-history-row-title">
          <strong>${esc(point.cycleId)} · Week ${Number(point.cycleWeek || 0)}</strong>
          <span>${esc(reason(point.reason))}</span>
        </div>
        <div class="duel-history-row-meta">
          <span>${esc(dateTime(point.createdAt))}</span>
          <span>Week ${compact(s.weeklyTotal)}</span>
          <span>League ${compact(s.duelLeagueTotal)}</span>
          <span>${Number(s.weeklyPlayers || 0)} players</span>
        </div>
        <div class="duel-history-days">${days.map((value, index) => `<span>D${index + 1} <b>${compact(value)}</b></span>`).join('')}</div>
      </div>
      <div class="duel-history-row-actions">
        <button class="btn btn-secondary saved-preview" type="button">Preview</button>
        <button class="btn duel-history-restore-button saved-restore" type="button">Restore</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderHistory(points) {
  if (!points.length) {
    return '<div class="empty duel-history-empty">No synchronized capture checkpoints were found for this week.</div>';
  }
  return `<div class="duel-history-list">${points.map(point => `
    <article class="duel-history-row" data-history-at="${esc(point.capturedAt)}">
      <div class="duel-history-row-main">
        <div class="duel-history-row-title">
          <strong>${esc(dateTime(point.capturedAt))}</strong>
          <span>Captured sync</span>
        </div>
        <div class="duel-history-row-meta">
          <span>${Number(point.snapshotCount || 0)} snapshots</span>
          <span>${esc((point.datasets || []).join(' · '))}</span>
        </div>
      </div>
      <div class="duel-history-row-actions">
        <button class="btn btn-secondary history-preview" type="button">Preview scores</button>
        <button class="btn duel-history-restore-button history-restore" type="button">Rewind scores</button>
      </div>
    </article>
  `).join('')}</div>`;
}

function bindRows(panel) {
  panel.querySelectorAll('.saved-preview').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const restoreId = button.closest('[data-restore-id]')?.dataset.restoreId || '';
      if (!restoreId) return;
      button.disabled = true;
      try {
        const result = await api(`/api/admin/duel-restore-points/${encodeURIComponent(restoreId)}`);
        showSavedPreview(panel, result.restorePoint);
      } catch (error) {
        status(panel, error.message, false, true);
      } finally { button.disabled = false; }
    });
  });

  panel.querySelectorAll('.saved-restore').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const row = button.closest('[data-restore-id]');
      const restoreId = row?.dataset.restoreId || '';
      const title = row?.querySelector('.duel-history-row-title strong')?.textContent || 'this restore point';
      if (!restoreId || !confirm(`Restore ${title} to this full saved state?\n\nThe current state will be saved first, so this can be undone.`)) return;
      button.disabled = true;
      button.textContent = 'Restoring…';
      try {
        await api(`/api/admin/duel-restore-points/${encodeURIComponent(restoreId)}/restore`, { method: 'POST', body: '{}' });
        status(panel, 'Full Alliance Duel state restored.', true);
        await reload(panel, false);
      } catch (error) {
        status(panel, error.message, false, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Restore';
      }
    });
  });

  panel.querySelectorAll('.history-preview').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const at = button.closest('[data-history-at]')?.dataset.historyAt || '';
      const target = selectedWeek(panel);
      if (!at || !target.cycleId) return;
      button.disabled = true;
      try {
        const result = await api('/api/admin/duel-history-checkpoints/preview', {
          method: 'POST',
          body: JSON.stringify({ ...target, capturedAt: at }),
        });
        showHistoryPreview(panel, result.checkpoint);
      } catch (error) {
        status(panel, error.message, false, true);
      } finally { button.disabled = false; }
    });
  });

  panel.querySelectorAll('.history-restore').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const row = button.closest('[data-history-at]');
      const at = row?.dataset.historyAt || '';
      const target = selectedWeek(panel);
      if (!at || !target.cycleId) return;
      if (!confirm(`Rewind Week ${target.cycleWeek} player scores to the ${dateTime(at)} sync?\n\nA full snapshot of the current state will be saved first. Matchup outcomes remain ranking-derived.`)) return;
      button.disabled = true;
      button.textContent = 'Rewinding…';
      try {
        const result = await api('/api/admin/duel-history-checkpoints/restore', {
          method: 'POST',
          body: JSON.stringify({ ...target, capturedAt: at }),
        });
        status(panel, `Rewound ${Number(result.changedRows || 0)} score rows. Your previous current state is saved as a full restore point.`, true);
        await reload(panel, false);
      } catch (error) {
        status(panel, error.message, false, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Rewind scores';
      }
    });
  });
}

function showSavedPreview(panel, point) {
  if (!point) return;
  const s = point.summary || {};
  const days = Array.isArray(s.dailyTotals) ? s.dailyTotals : [];
  const leaders = [...(point.weekly || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
  preview(panel, {
    eyebrow: 'FULL RESTORE POINT',
    title: `${point.cycleId} · Week ${point.cycleWeek}`,
    subtitle: `${dateTime(point.createdAt)} · ${reason(point.reason)}`,
    weeklyTotal: s.weeklyTotal,
    dailyTotal: days.reduce((sum, value) => sum + Number(value || 0), 0),
    dailyTotals: days,
    players: s.weeklyPlayers,
    leaders: leaders.map((row, index) => ({ rank: index + 1, name: row.name_at_capture || row.uid || '', score: row.score })),
  });
}

function showHistoryPreview(panel, point) {
  if (!point) return;
  const s = point.summary || {};
  preview(panel, {
    eyebrow: 'HISTORICAL SCORE CHECKPOINT',
    title: `${point.cycleId} · Week ${point.cycleWeek}`,
    subtitle: dateTime(point.capturedAt),
    weeklyTotal: s.weeklyTotal,
    dailyTotal: s.dailyTotal,
    dailyTotals: s.dailyTotals || [],
    players: s.players,
    leaders: point.leaders || [],
  });
}

function preview(panel, data) {
  const host = panel.querySelector('#duel-history-preview');
  if (!host) return;
  host.innerHTML = `<div class="duel-history-preview">
    <div class="duel-history-preview-head">
      <div>
        <div class="eyebrow">${esc(data.eyebrow)}</div>
        <strong>${esc(data.title)}</strong>
        <span>${esc(data.subtitle)}</span>
      </div>
      <button type="button" class="duel-history-preview-close" aria-label="Close preview">×</button>
    </div>
    <div class="duel-history-preview-metrics">
      <span><small>Week total</small><b>${compact(data.weeklyTotal)}</b></span>
      <span><small>Daily total</small><b>${compact(data.dailyTotal)}</b></span>
      <span><small>Players</small><b>${Number(data.players || 0)}</b></span>
      <span><small>State time</small><b>${esc(data.subtitle)}</b></span>
    </div>
    <div class="duel-history-preview-days">${(data.dailyTotals || []).map((value, index) => `<span><small>Day ${index + 1}</small><b>${compact(value)}</b></span>`).join('')}</div>
    ${(data.leaders || []).length ? `<div class="duel-history-preview-leaders"><strong>Top weekly scores</strong>${data.leaders.map(row => `<span><b>#${Number(row.rank || 0)} ${esc(row.name || row.uid || '')}</b><em>${compact(row.score)}</em></span>`).join('')}</div>` : ''}
  </div>`;
  host.querySelector('.duel-history-preview-close')?.addEventListener('click', () => { host.innerHTML = ''; });
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectedWeek(panel) {
  const [cycleId, week] = String(panel.querySelector('#duel-history-week')?.value || '').split('|');
  return { cycleId, cycleWeek: Number(week || 0) };
}

async function api(url, options = {}) {
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

function status(panel, text, success = false, error = false) {
  const host = panel.querySelector('#duel-history-status');
  if (!host) return;
  host.textContent = text || '';
  host.classList.toggle('success', Boolean(success));
  host.classList.toggle('error', Boolean(error));
}

function reason(value) {
  return ({
    before_sync: 'Before sync',
    after_sync: 'After sync',
    manual: 'Manual snapshot',
    before_restore: 'Before restore',
    after_restore: 'Restored state',
    after_outcome_reconcile: 'After ranking reconciliation',
    before_history_rewind: 'Before history rewind',
    history_rewind: 'Historical rewind',
  })[String(value || '')] || String(value || 'Saved state').replaceAll('_', ' ');
}

function compact(value) {
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

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}
