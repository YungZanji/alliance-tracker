import './app-v073.js';

let scheduled = false;
let mountBusy = false;
const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    if (location.hash === '#polls') await maybeMountStateRulerBackfill();
  }, 60));
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

async function maybeMountStateRulerBackfill() {
  if (mountBusy) return;
  const host = document.getElementById('polls-detail');
  const active = document.querySelector('.poll-list-item.active');
  const pollId = String(active?.dataset.pollId || '');
  if (!host || !pollId || !host.querySelector('.poll-option-grid')) return;
  if (host.querySelector(`[data-state-ruler-poll="${cssEsc(pollId)}"]`)) return;

  mountBusy = true;
  try {
    const [detail, context] = await Promise.all([
      api(`/api/admin/polls/${encodeURIComponent(pollId)}`),
      api('/api/admin/scoring-context'),
    ]);
    if (location.hash !== '#polls' || String(document.querySelector('.poll-list-item.active')?.dataset.pollId || '') !== pollId) return;
    mountStateRulerPanel(host, detail, context);
  } catch (error) {
    console.warn('Could not mount State Ruler poll backfill:', error);
  } finally {
    mountBusy = false;
  }
}

function mountStateRulerPanel(host, detail, context) {
  const poll = detail.poll || {};
  const options = detail.options || [];
  const applications = detail.stateRulerApplications || [];
  const cycles = context.cycles || [];
  if (!options.length || !cycles.length) return;

  const panel = document.createElement('section');
  panel.className = 'poll-state-ruler-panel';
  panel.dataset.stateRulerPoll = String(poll.pollId || '');

  const suggestedCycle = String(context.cycleId || cycles[0]?.id || '');
  const suggestedWeek = suggestWeek(suggestedCycle, poll.createdAt || poll.capturedAt);
  const yesOption = options.find(option => /^yes\b/i.test(String(option.text || '').trim())) || options[0];
  const applicationMarkup = applications.length ? `
    <div class="poll-backfill-history">
      <strong>Previous State Ruler applications</strong>
      ${applications.map(row => `<span>${esc(row.cycleId)} · Week ${Number(row.cycleWeek)} · ${esc(row.attendanceOptionText || row.attendanceOptionId)} · ${Number(row.yesCount)} attendance votes · ${dateShort(row.appliedAt)}</span>`).join('')}
    </div>` : '';

  panel.innerHTML = `
    <div class="poll-backfill-copy">
      <div class="eyebrow">STATE RULER ATTENDANCE</div>
      <h3>Use this poll as attendance evidence</h3>
      <p>Choose the option that means the player intended to participate. Those voters receive the State Ruler attendance floor unless a real leaderboard score already exists.</p>
    </div>
    <div class="poll-backfill-controls">
      <label><span>Cycle</span><select class="select" id="poll-svs-cycle">${cycles.map(row => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('')}</select></label>
      <label><span>Week</span><select class="select" id="poll-svs-week">${[1,2,3,4].map(week => `<option value="${week}">Week ${week}</option>`).join('')}</select></label>
      <label><span>Attendance option</span><select class="select" id="poll-svs-option">${options.map(option => `<option value="${esc(option.id)}">${esc(option.text)} · ${Number(option.voteCount || 0)} votes</option>`).join('')}</select></label>
      <button class="btn btn-primary" id="poll-apply-svs">Apply to State Ruler</button>
    </div>
    <div class="poll-backfill-note">Real captured leaderboard scores are always preserved. A poll attendance floor only fills players who do not already have a real State Ruler score.</div>
    <div class="poll-backfill-status" id="poll-svs-status"></div>
    ${applicationMarkup}`;

  const optionGrid = host.querySelector('.poll-option-grid');
  optionGrid.insertAdjacentElement('afterend', panel);

  const cycleSelect = panel.querySelector('#poll-svs-cycle');
  const weekSelect = panel.querySelector('#poll-svs-week');
  const optionSelect = panel.querySelector('#poll-svs-option');
  if ([...cycleSelect.options].some(option => option.value === suggestedCycle)) cycleSelect.value = suggestedCycle;
  weekSelect.value = String(suggestedWeek);
  optionSelect.value = String(yesOption?.id || options[0]?.id || '');
  cycleSelect.addEventListener('change', () => {
    weekSelect.value = String(suggestWeek(cycleSelect.value, poll.createdAt || poll.capturedAt));
  });
  panel.querySelector('#poll-apply-svs')?.addEventListener('click', () => applyStateRulerBackfill(panel, poll));
}

async function applyStateRulerBackfill(panel, poll) {
  const cycleId = String(panel.querySelector('#poll-svs-cycle')?.value || '');
  const cycleWeek = Number(panel.querySelector('#poll-svs-week')?.value || 0);
  const attendanceOptionId = String(panel.querySelector('#poll-svs-option')?.value || '');
  const optionText = String(panel.querySelector('#poll-svs-option')?.selectedOptions?.[0]?.textContent || '').replace(/\s+·\s+\d+\s+votes?$/i, '').trim();
  if (!cycleId || !cycleWeek || !attendanceOptionId) return;

  const message = `Apply “${optionText}” voters from this poll to State Ruler ${cycleId}, Week ${cycleWeek}?\n\nPlayers without a real State Ruler leaderboard score will receive the attendance minimum. Existing real scores will not be overwritten.`;
  if (!window.confirm(message)) return;

  const button = panel.querySelector('#poll-apply-svs');
  const status = panel.querySelector('#poll-svs-status');
  button.disabled = true;
  status.className = 'poll-backfill-status';
  status.textContent = 'Applying attendance credit…';
  try {
    const result = await api(`/api/admin/polls/${encodeURIComponent(poll.pollId)}/apply-state-ruler`, {
      method: 'POST',
      body: JSON.stringify({ cycleId, cycleWeek, attendanceOptionId }),
    });
    status.className = 'poll-backfill-status success';
    status.innerHTML = `<strong>State Ruler backfill complete.</strong><span>${Number(result.yesVoters || 0)} attendance votes · ${Number(result.floorCreditsAdded || 0)} minimum credits · ${Number(result.realScoresPreserved || 0)} real scores preserved · ${Number(result.explicitOtherVotes || 0)} other votes${Number(result.unknownPlayers || 0) ? ` · ${Number(result.unknownPlayers)} unknown UID(s)` : ''}.</span>`;
  } catch (error) {
    status.className = 'poll-backfill-status error';
    status.innerHTML = `<strong>Backfill failed.</strong><span>${esc(error.message)}</span>`;
  } finally {
    button.disabled = false;
  }
}

function suggestWeek(cycleId, timestamp) {
  const start = Date.parse(`${String(cycleId || '').slice(0,10)}T00:00:00Z`);
  const captured = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(start) || !Number.isFinite(captured)) return 1;
  return Math.max(1, Math.min(4, Math.floor((captured - start) / (7 * 86_400_000)) + 1));
}
function dateShort(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 'unknown date' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date);
}
function cssEsc(value) {
  return String(value || '').replace(/(["\\])/g, '\\$1');
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
}
