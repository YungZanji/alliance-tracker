import './app-v065.js';

let wired = false;
const observer = new MutationObserver(() => wire());
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
wire();

async function wire() {
  const cycle = document.getElementById('score-cycle');
  if (!cycle || wired) return;
  wired = true;
  try {
    const response = await fetch('/api/admin/duel-context', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    const current = cycle.value || data.cycleId || '';
    cycle.innerHTML = (data.cycles || []).map(row => `<option value="${esc(row.id)}">${esc(row.id)}</option>`).join('');
    if (current && [...cycle.options].some(option => option.value === current)) cycle.value = current;
    else if (data.cycleId) cycle.value = data.cycleId;
    await refreshPolicy();
  } catch (error) {
    console.warn('Could not initialize 1.3 scoring cycles:', error);
  }
  ['score-cycle', 'score-event', 'score-week'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => setTimeout(refreshPolicy, 0));
  });
}

async function refreshPolicy() {
  const cycleId = document.getElementById('score-cycle')?.value || '';
  const eventType = document.getElementById('score-event')?.value || 'alliance_duel';
  const cycleWeek = Number(document.getElementById('score-week')?.value || 1);
  if (!cycleId) return;
  try {
    const response = await fetch(`/api/event-week-policy?cycle=${encodeURIComponent(cycleId)}&week=${cycleWeek}&eventType=${encodeURIComponent(eventType)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    const row = (data.policies || []).find(item => Number(item.cycleWeek) === cycleWeek) || {};
    const bye = document.getElementById('score-bye');
    const multiplier = document.getElementById('score-multiplier');
    const note = document.getElementById('score-note');
    if (bye) bye.checked = Boolean(row.isBye);
    if (multiplier) multiplier.value = String(row.weightMultiplier ?? 1);
    if (note) note.value = row.note || '';
  } catch (error) {
    console.warn('Could not load selected event-week policy:', error);
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
