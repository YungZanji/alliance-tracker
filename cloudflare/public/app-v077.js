import './app-v076.js';

let scheduled = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(() => {
    scheduled = false;
    restoreCombinedRendererIfNeeded();
  }, 75));
}

function restoreCombinedRendererIfNeeded() {
  if (location.hash !== '#leaderboards') return;
  const host = document.getElementById('participation-table');
  if (!host || host.dataset.combinedV100 !== '1' || host.querySelector('.combined-contribution-table')) return;

  // A legacy async Duel-only enhancement finished after the combined renderer.
  // Clear the combined marker and create one harmless child-list mutation so app-v076
  // re-fetches /api/participation and restores the authoritative combined table.
  host.dataset.combinedV100 = '';
  const pulse = document.createComment('restore-combined-contribution');
  host.appendChild(pulse);
  pulse.remove();
}
