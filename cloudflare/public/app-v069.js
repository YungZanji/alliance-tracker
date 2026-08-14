import './app-v068.js';

let scheduled = false;
let overviewCache = null;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => { overviewCache = null; schedule(); });
window.addEventListener('resize', schedule, { passive: true });
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(async () => {
    scheduled = false;
    enhanceNumberInputs();
    await Promise.allSettled([
      enhanceByeWeightDefaults(),
      enhanceWeekPolicyControls(),
      enhanceAdminSummaryColumn(),
    ]);
  });
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

async function enhanceByeWeightDefaults() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator') return;
  const form = document.getElementById('weights-form');
  if (!form || document.getElementById('global-bye-weights')) return;

  const block = document.createElement('div');
  block.id = 'global-bye-weights';
  block.className = 'global-bye-weights';
  block.innerHTML = `
    <div class="global-bye-head">
      <div><strong>Global Bye-week weights</strong><div class="muted">Defaults used by Bye weeks unless that specific week has an override.</div></div>
    </div>
    ${byeWeightRow('Alliance Duel Bye', 'alliance_duel')}
    ${byeWeightRow('State Ruler Bye', 'state_ruler')}
    ${byeWeightRow('Glory War Bye', 'glory_war')}
    <button class="btn btn-secondary" type="button" id="save-global-bye-weights">Save Bye defaults</button>
    <div class="duel-admin-status" id="global-bye-status"></div>`;
  form.insertAdjacentElement('afterend', block);
  block.querySelector('#save-global-bye-weights').addEventListener('click', saveGlobalByeWeights);
  enhanceNumberInputs();

  try {
    const data = await api('/api/admin/bye-weights');
    for (const [eventType, value] of Object.entries(data.weights || {})) {
      const input = document.getElementById(`global-bye-${eventType}`);
      if (input) input.value = String(value);
    }
  } catch (error) {
    status('global-bye-status', error.message, true);
  }
}

function byeWeightRow(label, eventType) {
  return `<div class="weight-row bye-weight-row"><div><strong>${esc(label)}</strong><div class="muted" style="font-size:12px">Default multiplier</div></div><input class="input" id="global-bye-${eventType}" type="number" min="0" max="2" step="0.05" value="0.35"></div>`;
}

async function saveGlobalByeWeights() {
  const weights = {
    alliance_duel: Number(document.getElementById('global-bye-alliance_duel')?.value || 0),
    state_ruler: Number(document.getElementById('global-bye-state_ruler')?.value || 0),
    glory_war: Number(document.getElementById('global-bye-glory_war')?.value || 0),
  };
  try {
    const data = await api('/api/admin/bye-weights', { method: 'POST', body: JSON.stringify({ weights }) });
    for (const [eventType, value] of Object.entries(data.weights || {})) {
      const input = document.getElementById(`global-bye-${eventType}`);
      if (input) input.value = String(value);
    }
    status('global-bye-status', 'Global Bye-week defaults saved.', false, true);
    await refreshWeekPolicyControls();
  } catch (error) {
    status('global-bye-status', error.message, true);
  }
}

async function enhanceWeekPolicyControls() {
  const panel = document.getElementById('scoring-admin-v130');
  if (!panel) return;
  const multiplier = document.getElementById('score-multiplier');
  if (!multiplier) return;

  if (!document.getElementById('score-use-global-bye')) {
    const label = document.createElement('label');
    label.className = 'score-check global-bye-toggle';
    label.innerHTML = `<input type="checkbox" id="score-use-global-bye"> Use global Bye weight <span class="muted" id="score-global-bye-value"></span>`;
    const note = multiplier.nextElementSibling;
    (note || multiplier).insertAdjacentElement('afterend', label);
    label.querySelector('input').addEventListener('change', syncWeekMultiplierEnabled);
  }

  if (panel.dataset.v071PolicyWired !== '1') {
    panel.dataset.v071PolicyWired = '1';
    ['score-cycle', 'score-event', 'score-week', 'score-bye'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => setTimeout(refreshWeekPolicyControls, 0));
    });

    const oldButton = document.getElementById('score-save-policy');
    if (oldButton) {
      const replacement = oldButton.cloneNode(true);
      oldButton.replaceWith(replacement);
      replacement.addEventListener('click', saveWeekPolicyV071);
    }
  }
  await refreshWeekPolicyControls();
}

async function refreshWeekPolicyControls() {
  const cycleId = document.getElementById('score-cycle')?.value || '';
  const eventType = document.getElementById('score-event')?.value || 'alliance_duel';
  const cycleWeek = Number(document.getElementById('score-week')?.value || 1);
  if (!cycleId || !document.getElementById('score-use-global-bye')) return;
  try {
    const data = await api(`/api/event-week-policy?cycle=${encodeURIComponent(cycleId)}&week=${cycleWeek}&eventType=${encodeURIComponent(eventType)}`);
    const row = (data.policies || []).find(item => item.eventType === eventType && Number(item.cycleWeek) === cycleWeek) || {};
    const globalValue = Number(data.globalByeWeights?.[eventType] ?? row.globalByeWeight ?? 0.35);
    const useGlobal = Boolean(row.useDefaultByeWeight);
    document.getElementById('score-use-global-bye').checked = useGlobal;
    const valueLabel = document.getElementById('score-global-bye-value');
    if (valueLabel) valueLabel.textContent = `(current default ${globalValue.toFixed(2)})`;
    if (useGlobal && document.getElementById('score-bye')?.checked) {
      document.getElementById('score-multiplier').value = String(globalValue);
    }
    syncWeekMultiplierEnabled();
  } catch (error) {
    console.warn('Could not refresh global Bye-week policy control:', error);
  }
}

function syncWeekMultiplierEnabled() {
  const useGlobal = Boolean(document.getElementById('score-use-global-bye')?.checked);
  const isBye = Boolean(document.getElementById('score-bye')?.checked);
  const input = document.getElementById('score-multiplier');
  if (!input) return;
  input.disabled = isBye && useGlobal;
  input.closest('.number-stepper')?.classList.toggle('disabled', input.disabled);
}

async function saveWeekPolicyV071() {
  const cycleId = document.getElementById('score-cycle')?.value || '';
  const eventType = document.getElementById('score-event')?.value || '';
  const cycleWeek = Number(document.getElementById('score-week')?.value || 1);
  const isBye = Boolean(document.getElementById('score-bye')?.checked);
  const useDefaultByeWeight = isBye && Boolean(document.getElementById('score-use-global-bye')?.checked);
  const weightMultiplier = Number(document.getElementById('score-multiplier')?.value || 1);
  const note = document.getElementById('score-note')?.value.trim() || '';
  try {
    const data = await api('/api/admin/event-week-policy', {
      method: 'POST',
      body: JSON.stringify({ cycleId, eventType, cycleWeek, isBye, useDefaultByeWeight, weightMultiplier, note }),
    });
    const row = data.policy || {};
    document.getElementById('score-multiplier').value = String(row.weightMultiplier ?? 1);
    document.getElementById('score-use-global-bye').checked = Boolean(row.useDefaultByeWeight);
    syncWeekMultiplierEnabled();
    status('score-policy-status', row.isBye
      ? `Bye week saved · ${Number(row.weightMultiplier || 0).toFixed(2)} weight${row.useDefaultByeWeight ? ' · global default' : ' · week override'}`
      : 'Normal week saved · full weight', false, true);
    overviewCache = null;
  } catch (error) {
    status('score-policy-status', error.message, true);
  }
}

async function enhanceAdminSummaryColumn() {
  const main = document.getElementById('main');
  if (main?.querySelector('.page-head h1')?.textContent?.trim() !== 'Administrator') return;
  const grid = main.querySelector('.admin-grid');
  if (!grid || document.getElementById('admin-absence-bye-card')) return;

  const card = document.createElement('div');
  card.id = 'admin-absence-bye-card';
  card.className = 'card admin-context-quick-card';
  card.innerHTML = `<h3>Absences & Bye Weeks</h3><p class="muted">Current cycle overview.</p><div id="admin-context-quick"><span class="muted">Loading…</span></div>`;
  grid.appendChild(card);
  try {
    overviewCache = overviewCache || await api('/api/admin/event-overview');
    renderQuickOverview(overviewCache);
  } catch (error) {
    card.querySelector('#admin-context-quick').innerHTML = `<span class="muted">${esc(error.message)}</span>`;
  }
}

function renderQuickOverview(data) {
  const node = document.getElementById('admin-context-quick');
  if (!node) return;
  const leaves = data.leaves || [];
  const byes = (data.policies || []).filter(row => row.isBye);
  node.innerHTML = `
    <div class="context-quick-group"><div class="metric-label">On Leave</div>${leaves.length
      ? leaves.slice(0, 8).map(row => `<div class="context-quick-row"><strong>${esc(row.name)}</strong><span>W${Number(row.cycleWeek)}</span></div>`).join('')
      : '<div class="muted">No players marked On Leave.</div>'}</div>
    <div class="context-quick-group"><div class="metric-label">Bye weeks</div>${byes.length
      ? byes.slice(0, 8).map(row => `<div class="context-quick-row"><strong>${esc(eventLabel(row.eventType))}</strong><span>W${Number(row.cycleWeek)} · ${Number(row.weightMultiplier || 0).toFixed(2)}</span></div>`).join('')
      : '<div class="muted">No Bye weeks in this cycle.</div>'}</div>`;
}

function enhanceNumberInputs() {
  document.querySelectorAll('input[type="number"]:not([data-themed-number])').forEach(input => {
    input.dataset.themedNumber = '1';
    const wrapper = document.createElement('span');
    wrapper.className = 'number-stepper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const buttons = document.createElement('span');
    buttons.className = 'number-stepper-buttons';
    buttons.innerHTML = `<button type="button" aria-label="Increase value">⌃</button><button type="button" aria-label="Decrease value">⌄</button>`;
    wrapper.appendChild(buttons);
    const [up, down] = buttons.querySelectorAll('button');
    up.addEventListener('click', () => stepNumber(input, 1));
    down.addEventListener('click', () => stepNumber(input, -1));
  });
}

function stepNumber(input, direction) {
  if (input.disabled) return;
  const step = Number(input.step && input.step !== 'any' ? input.step : 1) || 1;
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  let value = Number(input.value || 0) + direction * step;
  value = Math.min(max, Math.max(min, value));
  const decimals = (String(step).split('.')[1] || '').length;
  input.value = decimals ? value.toFixed(decimals) : String(Math.round(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function eventLabel(type) {
  return type === 'alliance_duel' ? 'Alliance Duel' : type === 'state_ruler' ? 'State Ruler' : 'Glory War';
}
function status(id, message, error = false, success = false) {
  const node = document.getElementById(id); if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error', error);
  node.classList.toggle('success', success && !error);
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
