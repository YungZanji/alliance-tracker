const appRoot = document.getElementById('app');
let scheduled = false;
let cachedUser = null;
let cachedAt = 0;
let userPromise = null;

const EVENT_WEIGHTS = [
  { key: 'alliance_duel', label: 'Alliance Duel' },
  { key: 'state_ruler', label: 'State Ruler' },
  { key: 'glory_war', label: 'Glory War' }
];

const observer = new MutationObserver(schedule);
observer.observe(appRoot, { childList: true, subtree: true });
window.addEventListener('hashchange', () => { cachedAt = 0; schedule(); });
window.addEventListener('popstate', () => { cachedAt = 0; schedule(); });
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    if (document.querySelector('.login-page')) {
      cachedUser = null;
      cachedAt = 0;
      sessionStorage.removeItem('admin-unlock-seen');
      closeAdminUnlock();
      return;
    }
    const user = await currentUser().catch(() => null);
    if (!user) return;
    mountAdminUnlockEntry(user);
    if (user.isAdmin) {
      stabilizeWeightEditor();
      mountPasswordPanel();
    }
  }, 70));
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('content-type') && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', headers });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function currentUser(force = false) {
  if (!force && cachedUser && Date.now() - cachedAt < 2000) return cachedUser;
  if (!userPromise) {
    userPromise = api('/api/auth/me').then(data => {
      cachedUser = data.user || null;
      cachedAt = Date.now();
      return cachedUser;
    }).finally(() => { userPromise = null; });
  }
  return userPromise;
}

function mountAdminUnlockEntry(user) {
  const navActions = document.querySelector('.nav-actions');
  if (!navActions) return;
  const existing = navActions.querySelector('.admin-unlock-nav');
  if (!user.adminEligible || user.isAdmin) {
    existing?.remove();
    return;
  }

  if (!existing) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-unlock-nav';
    button.innerHTML = '<span class="admin-unlock-shield">◆</span><span>Admin login</span>';
    button.addEventListener('click', openAdminUnlock);
    navActions.insertBefore(button, navActions.firstChild);
  }

  if (sessionStorage.getItem('admin-unlock-seen') !== '1') {
    sessionStorage.setItem('admin-unlock-seen', '1');
    openAdminUnlock();
  }
}

function openAdminUnlock() {
  if (document.getElementById('admin-unlock-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'admin-unlock-modal';
  modal.className = 'admin-unlock-backdrop';
  modal.innerHTML = `
    <section class="admin-unlock-card" role="dialog" aria-modal="true" aria-labelledby="admin-unlock-title">
      <div class="admin-unlock-icon">◆</div>
      <div class="eyebrow">ADMINISTRATOR VERIFICATION</div>
      <h2 id="admin-unlock-title">Unlock administrator access</h2>
      <p>Your player UID only opens normal member access. Administrator tools require the separate password for this account.</p>
      <form id="admin-unlock-form">
        <label class="field"><span>Administrator password</span><input class="input" id="admin-unlock-password" type="password" autocomplete="current-password" minlength="1" required autofocus></label>
        <div class="admin-unlock-error" id="admin-unlock-error" role="alert"></div>
        <button class="btn btn-primary" id="admin-unlock-submit" type="submit">Unlock Admin</button>
        <button class="btn btn-secondary" id="admin-unlock-cancel" type="button">Continue as member</button>
      </form>
    </section>`;
  document.body.appendChild(modal);
  modal.querySelector('#admin-unlock-form').addEventListener('submit', unlockAdmin);
  modal.querySelector('#admin-unlock-cancel').addEventListener('click', closeAdminUnlock);
  setTimeout(() => modal.querySelector('#admin-unlock-password')?.focus(), 50);
}

function closeAdminUnlock() {
  document.getElementById('admin-unlock-modal')?.remove();
}

async function unlockAdmin(event) {
  event.preventDefault();
  const password = document.getElementById('admin-unlock-password')?.value || '';
  const button = document.getElementById('admin-unlock-submit');
  const error = document.getElementById('admin-unlock-error');
  if (button) { button.disabled = true; button.textContent = 'Verifying…'; }
  if (error) error.textContent = '';
  try {
    await api('/api/auth/admin-login', { method: 'POST', body: JSON.stringify({ password }) });
    cachedUser = null;
    cachedAt = 0;
    location.reload();
  } catch (err) {
    if (error) error.textContent = err.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Unlock Admin'; }
  }
}

function stabilizeWeightEditor() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim();
  if (title !== 'Administrator') return;
  const form = document.getElementById('weights-form');
  if (!form || form.dataset.weightEditorV123 === '1') return;
  if (!form.classList.contains('contribution-weight-form')) return;
  if (!document.getElementById('contribution-scale-settings')) return;

  const initial = {};
  EVENT_WEIGHTS.forEach(row => {
    initial[row.key] = Number(form.querySelector(`input[name="${row.key}"]`)?.value || 0);
  });

  const replacement = document.createElement('form');
  replacement.id = 'weights-form';
  replacement.className = 'contribution-weight-form stable-weight-editor';
  replacement.dataset.weightEditorV123 = '1';
  replacement.innerHTML = `
    ${EVENT_WEIGHTS.map(row => stableWeightRow(row.label, row.key, initial[row.key])).join('')}
    <div class="contribution-weight-total stable-weight-total"><span>Total allocation</span><strong id="stable-weight-total">0%</strong></div>
    <div class="stable-weight-actions">
      <button class="btn btn-primary" id="stable-weight-save" type="submit">Save contribution weights</button>
      <button class="btn btn-secondary" id="stable-weight-reset" type="button">Reset to saved</button>
    </div>
    <div class="stable-weight-help">Edit as many fields as you want. Values will not reset while you work. The three weights only need to total 100% when you press Save.</div>
    <span class="contribution-admin-status" id="stable-weight-status" role="status" aria-live="polite"></span>`;
  form.replaceWith(replacement);

  replacement.querySelectorAll('input[name]').forEach(input => input.addEventListener('input', renderStableWeightTotal));
  replacement.addEventListener('submit', saveStableWeights);
  replacement.querySelector('#stable-weight-reset')?.addEventListener('click', resetStableWeights);
  renderStableWeightTotal();
}

function stableWeightRow(label, name, value) {
  return `<label class="contribution-weight-row"><span><strong>${escapeHtml(label)}</strong><small>Share of the final Overall Contribution score.</small></span><div class="percent-input"><input class="input" type="number" min="0" max="100" step="0.1" name="${escapeHtml(name)}" value="${Number(value || 0)}"><b>%</b></div></label>`;
}

function readStableWeights() {
  const form = document.getElementById('weights-form');
  if (!form) return {};
  return Object.fromEntries(EVENT_WEIGHTS.map(row => [row.key, Number(form.querySelector(`input[name="${row.key}"]`)?.value || 0)]));
}

function renderStableWeightTotal() {
  const form = document.getElementById('weights-form');
  if (!form?.dataset.weightEditorV123) return;
  const weights = readStableWeights();
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const host = document.getElementById('stable-weight-total');
  if (host) host.textContent = `${Number(total.toFixed(1))}%`;
  const valid = Math.abs(total - 100) < 0.001;
  form.classList.toggle('weight-total-warning', !valid);
  const save = document.getElementById('stable-weight-save');
  if (save) save.disabled = !valid;
  const status = document.getElementById('stable-weight-status');
  if (status && !valid) status.textContent = `Draft total is ${Number(total.toFixed(1))}%. Keep editing until the total is 100%.`;
  else if (status && /^Draft total/.test(status.textContent || '')) status.textContent = 'Ready to save.';
}

async function saveStableWeights(event) {
  event.preventDefault();
  const button = document.getElementById('stable-weight-save');
  const status = document.getElementById('stable-weight-status');
  const percentages = readStableWeights();
  const total = Object.values(percentages).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) >= 0.001) {
    if (status) status.textContent = 'Weights must total 100% before saving. Your draft has been preserved.';
    return;
  }
  const weights = Object.fromEntries(Object.entries(percentages).map(([key, value]) => [key, value / 100]));
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    await api('/api/admin/weights', { method: 'POST', body: JSON.stringify({ weights }) });
    if (status) status.textContent = 'Saved. The leaderboard will use these weights immediately.';
  } catch (err) {
    if (status) status.textContent = err.message;
  } finally {
    if (button) { button.textContent = 'Save contribution weights'; button.disabled = false; }
    renderStableWeightTotal();
  }
}

async function resetStableWeights() {
  const status = document.getElementById('stable-weight-status');
  try {
    if (status) status.textContent = 'Reloading saved weights…';
    const data = await api('/api/admin/contribution-model');
    const weights = data.weights || {};
    EVENT_WEIGHTS.forEach(row => {
      const input = document.querySelector(`#weights-form input[name="${row.key}"]`);
      if (input) input.value = String(Number(weights[row.key] || 0) * 100);
    });
    renderStableWeightTotal();
    if (status) status.textContent = 'Saved values restored.';
  } catch (err) {
    if (status) status.textContent = err.message;
  }
}

function mountPasswordPanel() {
  const main = document.getElementById('main');
  const title = main?.querySelector('.page-head h1')?.textContent?.trim();
  if (title !== 'Administrator' || document.getElementById('admin-password-panel')) return;
  const panel = document.createElement('section');
  panel.id = 'admin-password-panel';
  panel.className = 'section panel admin-password-panel';
  panel.innerHTML = `
    <div class="panel-head"><div><div class="panel-title">Administrator security</div><div class="muted">Your UID grants member access only. This password is the separate key for administrator tools.</div></div><button class="btn btn-secondary" id="lock-admin-session" type="button">Lock Admin</button></div>
    <form id="admin-password-form" class="admin-password-grid">
      <label><span>Current password</span><input class="input" id="admin-current-password" type="password" autocomplete="current-password" required></label>
      <label><span>New password</span><input class="input" id="admin-new-password" type="password" autocomplete="new-password" minlength="14" required></label>
      <label><span>Confirm new password</span><input class="input" id="admin-confirm-password" type="password" autocomplete="new-password" minlength="14" required></label>
      <div class="admin-password-actions"><button class="btn btn-primary" id="admin-password-save" type="submit">Change admin password</button><span id="admin-password-status" role="status" aria-live="polite"></span></div>
    </form>`;
  main.appendChild(panel);
  panel.querySelector('#admin-password-form').addEventListener('submit', changeAdminPassword);
  panel.querySelector('#lock-admin-session').addEventListener('click', lockAdminSession);
}

async function changeAdminPassword(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('admin-current-password')?.value || '';
  const newPassword = document.getElementById('admin-new-password')?.value || '';
  const confirm = document.getElementById('admin-confirm-password')?.value || '';
  const status = document.getElementById('admin-password-status');
  const button = document.getElementById('admin-password-save');
  if (newPassword !== confirm) {
    if (status) status.textContent = 'New passwords do not match.';
    return;
  }
  if (newPassword.length < 14) {
    if (status) status.textContent = 'Use at least 14 characters.';
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Changing…'; }
  try {
    await api('/api/auth/admin-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    event.currentTarget.reset();
    if (status) status.textContent = 'Administrator password changed. Your current Admin session remains unlocked.';
  } catch (err) {
    if (status) status.textContent = err.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Change admin password'; }
  }
}

async function lockAdminSession() {
  const button = document.getElementById('lock-admin-session');
  if (button) button.disabled = true;
  try {
    await api('/api/auth/admin-logout', { method: 'POST', body: '{}' });
    cachedUser = null;
    cachedAt = 0;
    sessionStorage.removeItem('admin-unlock-seen');
    location.reload();
  } catch (_) {
    if (button) button.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}
