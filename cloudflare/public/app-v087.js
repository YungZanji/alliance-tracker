import './app-v086.js?v=117';

const MAX_PLAN_BYTES = 1_900_000;
const DIRECT_GW_MAP = location.pathname.replace(/\/+$/, '') === '/gw-map';
let scheduled = false;
let busy = false;
let mode = DIRECT_GW_MAP ? 'plan' : (sessionStorage.getItem('glory-war-view') || 'plan');
let blobUrl = '';

if (DIRECT_GW_MAP) {
  sessionStorage.setItem('glory-war-view', 'plan');
  if (location.hash !== '#glory-war') location.hash = '#glory-war';
}

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('popstate', schedule);
window.addEventListener('alliance-route-change', event => {
  if (event.detail?.route === 'glory-war') schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    if (location.hash !== '#glory-war') {
      const main = document.getElementById('main');
      if (main) delete main.dataset.gloryPlanV118;
      releaseBlob();
      return;
    }
    await enhanceGloryWarPage();
  }, 95));
}

async function enhanceGloryWarPage() {
  if (busy) return;
  const main = document.getElementById('main');
  if (!main) return;

  if (mode === 'archive') {
    if (main.dataset.gloryWarV114 !== '1') return;
    mountArchiveTabs(main);
    return;
  }

  if (main.dataset.gloryPlanV118 === 'plan') return;
  busy = true;
  try {
    const data = await apiJson('/api/glory-war-plan');
    if (location.hash !== '#glory-war') return;
    paintPlan(main, data);
  } catch (error) {
    if (location.hash !== '#glory-war') return;
    main.dataset.gloryWarV114 = '1';
    main.dataset.gloryPlanV118 = 'plan';
    main.innerHTML = `${pageHead()}${tabs('plan')}<div class="empty">${esc(error.message)}</div>`;
    bindTabs(main);
  } finally {
    busy = false;
  }
}

function paintPlan(main, data) {
  main.dataset.gloryWarV114 = '1';
  main.dataset.gloryPlanV118 = 'plan';
  const active = data.active;
  const viewer = data.viewer || {};
  const viewerTone = viewer.status === 'assigned' ? 'green' : 'amber';

  main.innerHTML = `
    ${pageHead(active)}
    ${tabs('plan')}
    ${active ? `
      <section class="glory-plan-summary">
        <div class="glory-plan-status badge badge-${viewerTone}">${esc(viewer.message || (viewer.status === 'assigned' ? 'Position assigned' : 'Attendance unknown'))}</div>
        <div class="glory-plan-meta">
          <span>${fmt(active.placementCount)} deployed</span>
          <span>${fmt(active.rosterCount)} roster records</span>
          <span>${active.state ? `State ${fmt(active.state)}` : 'State not specified'}</span>
          ${active.planUpdatedAt ? `<span>Map updated ${esc(when(active.planUpdatedAt))}</span>` : ''}
          <span>Uploaded ${esc(when(active.uploadedAt))}</span>
        </div>
      </section>
      <section class="glory-plan-frame-card">
        <div class="glory-plan-frame-head">
          <div><strong>${esc(active.title || 'Glory War battle plan')}</strong><small>${esc(active.filename || '')}</small></div>
          <button class="btn btn-secondary" id="reload-glory-plan" type="button">Reload map</button>
        </div>
        <div class="glory-plan-frame-loading" id="glory-plan-loading">Loading battle map…</div>
        <iframe id="glory-plan-frame" class="glory-plan-frame" title="Glory War battle plan" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer"></iframe>
      </section>` : `
      <section class="coming glory-plan-empty">
        <h2>No active Glory War battle plan</h2>
        <p>${data.canManage ? 'Upload this week’s exported Glory War HTML file below.' : 'An administrator has not uploaded this week’s battle plan yet.'}</p>
      </section>`}
    ${data.canManage ? adminControls(data) : ''}
  `;

  bindTabs(main);
  if (active) {
    document.getElementById('reload-glory-plan')?.addEventListener('click', loadPlanFrame);
    loadPlanFrame();
  }
  if (data.canManage) bindAdminControls(main);
}

function pageHead(active = null) {
  return `<section class="page-head"><div><div class="eyebrow">GLORY WAR COMMAND</div><h1>Glory War</h1><p>${active ? 'Your weekly battle plan, personalized to the Alliance Tracker account you used to sign in.' : 'Weekly command map and completed battle history.'}</p></div></section>`;
}

function tabs(selected) {
  return `<section class="glory-plan-tabs" role="tablist" aria-label="Glory War views">
    <button type="button" class="${selected === 'plan' ? 'active' : ''}" data-glory-tab="plan" role="tab" aria-selected="${selected === 'plan'}">Battle Plan</button>
    <button type="button" class="${selected === 'archive' ? 'active' : ''}" data-glory-tab="archive" role="tab" aria-selected="${selected === 'archive'}">Results Archive</button>
  </section>`;
}

function mountArchiveTabs(main) {
  if (main.querySelector('.glory-plan-tabs')) {
    main.dataset.gloryPlanV118 = 'archive';
    return;
  }
  const head = main.querySelector('.page-head');
  if (!head) return;
  head.insertAdjacentHTML('afterend', tabs('archive'));
  main.dataset.gloryPlanV118 = 'archive';
  bindTabs(main);
}

function bindTabs(main) {
  main.querySelectorAll('[data-glory-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.gloryTab;
      if (!next || next === mode) return;
      mode = next;
      sessionStorage.setItem('glory-war-view', mode);
      if (next === 'plan') {
        main.dataset.gloryPlanV118 = '';
        paintLoading(main);
        schedule();
      } else {
        releaseBlob();
        main.dataset.gloryPlanV118 = 'archive-wait';
        main.dataset.gloryWarV114 = '';
        main.innerHTML = `${pageHead()}${tabs('archive')}<div class="empty">Loading results archive…</div>`;
        setTimeout(() => {
          main.querySelector('.glory-plan-tabs')?.remove();
          main.dataset.gloryPlanV118 = '';
          main.dataset.gloryWarV114 = '';
          main.innerHTML = '<section class="page-head"><div><div class="eyebrow">GLORY WAR</div><h1>Glory War</h1><p>Loading completed battle history…</p></div></section><div class="empty">Loading…</div>';
        }, 0);
      }
    });
  });
}

function paintLoading(main) {
  main.dataset.gloryWarV114 = '1';
  main.innerHTML = `${pageHead()}${tabs('plan')}<div class="empty">Loading battle plan…</div>`;
  bindTabs(main);
}

async function loadPlanFrame() {
  const frame = document.getElementById('glory-plan-frame');
  const loading = document.getElementById('glory-plan-loading');
  if (!frame) return;
  if (loading) {
    loading.style.display = 'grid';
    loading.textContent = 'Loading battle map…';
  }
  try {
    const response = await fetch('/api/glory-war-plan/view', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const text = await response.text();
    if (!response.ok) throw new Error(readError(text) || `Map request failed (${response.status})`);
    releaseBlob();
    blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
    frame.onload = () => { if (loading) loading.style.display = 'none'; };
    frame.src = blobUrl;
  } catch (error) {
    if (loading) {
      loading.style.display = 'grid';
      loading.textContent = error.message;
    }
  }
}

function adminControls(data) {
  const history = Array.isArray(data.history) ? data.history : [];
  return `
    <section class="section panel glory-plan-admin">
      <div class="panel-head"><div><div class="panel-title">Weekly plan upload</div><div class="muted">Administrator only · upload the self-contained HTML exported by the Glory War map tool. The previous active file stays in history.</div></div></div>
      <div class="glory-plan-upload-row">
        <input class="input" id="glory-plan-file" type="file" accept=".html,text/html">
        <button class="btn btn-primary" id="upload-glory-plan" type="button">Upload & make active</button>
      </div>
      <div class="muted glory-plan-upload-status" id="glory-plan-upload-status"></div>
      ${history.length ? `<details class="glory-plan-history"><summary>Recent plan uploads (${history.length})</summary><div class="glory-plan-history-list">${history.map(row => `
        <div class="glory-plan-history-row">
          <div><strong>${esc(row.title || row.filename)}</strong><small>${esc(row.filename)} · ${esc(when(row.uploadedAt))} · ${fmtBytes(row.byteSize)}</small></div>
          ${row.isActive ? '<span class="badge badge-green">Active</span>' : `<button class="btn btn-secondary" type="button" data-activate-plan="${esc(row.planId)}">Make active</button>`}
        </div>`).join('')}</div></details>` : ''}
    </section>`;
}

function bindAdminControls(main) {
  document.getElementById('upload-glory-plan')?.addEventListener('click', uploadPlan);
  main.querySelectorAll('[data-activate-plan]').forEach(button => button.addEventListener('click', () => activatePlan(button.dataset.activatePlan, button)));
}

async function uploadPlan() {
  const input = document.getElementById('glory-plan-file');
  const button = document.getElementById('upload-glory-plan');
  const status = document.getElementById('glory-plan-upload-status');
  const file = input?.files?.[0];
  if (!file) {
    if (status) status.textContent = 'Choose an HTML file first.';
    return;
  }
  if (!/\.html?$/i.test(file.name)) {
    if (status) status.textContent = 'Choose a .html Glory War plan export.';
    return;
  }

  if (button) button.disabled = true;
  if (status) status.textContent = `Uploading ${file.name}…`;
  try {
    const response = await fetch('/api/admin/glory-war-plan', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-plan-filename': encodeURIComponent(file.name)
      },
      body: await file.text()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Upload failed (${response.status})`);
    if (status) status.textContent = 'Uploaded. This plan is now active.';
    const main = document.getElementById('main');
    if (main) paintPlan(main, data);
  } catch (error) {
    if (status) status.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function activatePlan(planId, button) {
  if (!planId) return;
  const original = button?.textContent || 'Make active';
  if (button) {
    button.disabled = true;
    button.textContent = 'Activating…';
  }
  try {
    const data = await apiJson('/api/admin/glory-war-plan/activate', {
      method: 'POST',
      body: JSON.stringify({ planId })
    });
    const main = document.getElementById('main');
    if (main) paintPlan(main, data);
  } catch (error) {
    if (button) {
      button.textContent = error.message;
      setTimeout(() => {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = original;
        }
      }, 1800);
    }
  }
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function releaseBlob() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = '';
}

function readError(value) {
  try { return JSON.parse(value)?.error || ''; } catch (_) { return ''; }
}

function when(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
function fmt(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}
function fmtBytes(value) {
  const n = Number(value || 0);
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}
