import './app-v072.js';

let pollsBusy = false;
let pollsRendered = false;
let selectedPollId = '';
let scheduled = false;

const observer = new MutationObserver(schedule);
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
window.addEventListener('hashchange', () => {
  pollsRendered = false;
  selectedPollId = '';
  schedule();
});
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(async () => {
    scheduled = false;
    ensurePollsNav();
    if (location.hash === '#polls' && !pollsBusy && (!pollsRendered || !document.querySelector('.polls-page'))) {
      await renderPollArchive();
    }
  }, 45));
}

function ensurePollsNav() {
  const links = document.querySelector('.nav-links');
  if (!links || links.querySelector('.polls-nav')) return;
  const admin = [...links.querySelectorAll('.nav-link')].find(node => node.textContent.trim() === 'Admin');
  if (!admin) return; // Admin-only navigation.
  const button = document.createElement('button');
  button.className = 'nav-link polls-nav';
  button.textContent = 'Polls';
  button.type = 'button';
  button.addEventListener('click', () => {
    history.pushState(null, '', '#polls');
    pollsRendered = false;
    selectedPollId = '';
    renderPollArchive();
  });
  links.insertBefore(button, admin);
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

async function renderPollArchive() {
  const main = document.getElementById('main');
  if (!main || pollsBusy) return;
  pollsBusy = true;
  document.querySelectorAll('.nav-link').forEach(node => node.classList.remove('active'));
  document.querySelector('.polls-nav')?.classList.add('active');
  main.innerHTML = '<div class="empty">Loading archived polls…</div>';
  try {
    const data = await api('/api/admin/polls');
    if (location.hash !== '#polls') return;
    const polls = data.polls || [];
    main.innerHTML = archiveMarkup(polls);
    pollsRendered = true;
    bindArchive(polls);
    if (polls.length) await selectPoll(selectedPollId || polls[0].pollId);
  } catch (error) {
    if (location.hash !== '#polls') return;
    main.innerHTML = `<div class="empty"><strong>Could not load Poll Archive.</strong><span>${esc(error.message)}</span></div>`;
  } finally {
    pollsBusy = false;
  }
}

function archiveMarkup(polls) {
  return `
    <div class="polls-page">
      <section class="page-head polls-head">
        <div><div class="eyebrow">WDZ · ADMIN ARCHIVE</div><h1>Alliance Polls</h1><p>Permanent copies of Alliance notice polls, including each vote and the roster members who did not vote.</p></div>
        <div class="polls-count">${polls.length}<small>archived polls</small></div>
      </section>
      <section class="polls-layout">
        <aside class="polls-list-panel panel">
          <div class="polls-toolbar"><input class="input" id="poll-search" placeholder="Search polls"></div>
          <div id="polls-list" class="polls-list">${pollListMarkup(polls)}</div>
        </aside>
        <section id="polls-detail" class="polls-detail panel"><div class="empty">Select a poll.</div></section>
      </section>
    </div>`;
}

function pollListMarkup(polls) {
  if (!polls.length) return '<div class="empty compact">No polls have been archived yet.</div>';
  return polls.map(poll => `
    <button class="poll-list-item" data-poll-id="${esc(poll.pollId)}" data-search="${esc(`${poll.question} ${poll.publisherName}`.toLowerCase())}">
      <strong>${esc(poll.question)}</strong>
      <span>${esc(poll.publisherName || 'Unknown')} · ${dateShort(poll.createdAt || poll.capturedAt)}</span>
      <div><b>${Number(poll.voteCount || 0)} voted</b><em>${Number(poll.didNotVote || 0)} did not</em></div>
    </button>`).join('');
}

function bindArchive(polls) {
  document.querySelectorAll('.poll-list-item').forEach(button => {
    button.addEventListener('click', () => selectPoll(button.dataset.pollId || ''));
  });
  document.getElementById('poll-search')?.addEventListener('input', event => {
    const q = String(event.target.value || '').trim().toLowerCase();
    document.querySelectorAll('.poll-list-item').forEach(button => {
      button.hidden = Boolean(q && !String(button.dataset.search || '').includes(q));
    });
  });
}

async function selectPoll(pollId) {
  if (!pollId) return;
  selectedPollId = pollId;
  document.querySelectorAll('.poll-list-item').forEach(button => button.classList.toggle('active', button.dataset.pollId === pollId));
  const host = document.getElementById('polls-detail');
  if (!host) return;
  host.innerHTML = '<div class="empty">Loading poll details…</div>';
  try {
    const data = await api(`/api/admin/polls/${encodeURIComponent(pollId)}`);
    if (selectedPollId !== pollId || !document.getElementById('polls-detail')) return;
    host.innerHTML = detailMarkup(data);
    bindDetailFilters();
  } catch (error) {
    host.innerHTML = `<div class="empty"><strong>Could not load this poll.</strong><span>${esc(error.message)}</span></div>`;
  }
}

function detailMarkup(data) {
  const poll = data.poll || {};
  const options = data.options || [];
  const participants = data.participants || [];
  const roster = participants.filter(row => row.rosterMember);
  const votedRoster = roster.filter(row => row.voted).length;
  const didNotVote = Math.max(0, roster.length - votedRoster);
  const turnout = roster.length ? votedRoster * 100 / roster.length : 0;
  const optionCards = options.map(option => {
    const pct = poll.voteCount ? Number(option.voteCount || 0) * 100 / Number(poll.voteCount) : 0;
    return `<article class="poll-option-card"><div><strong>${esc(option.text)}</strong><span>${Number(option.voteCount || 0)} vote${Number(option.voteCount || 0) === 1 ? '' : 's'}</span></div><b>${pct.toFixed(1)}%</b><div class="poll-option-bar"><i style="width:${Math.min(100,pct)}%"></i></div></article>`;
  }).join('');
  const participantRows = participants.map(row => {
    const choice = row.voted ? (row.optionTexts || []).join(', ') : 'Did not vote';
    return `<tr data-vote-state="${row.voted ? 'voted' : 'missing'}" data-search="${esc(`${row.playerName} ${row.uid} ${choice}`.toLowerCase())}">
      <td><strong>${esc(row.playerName || 'Unknown player')}</strong><small>${esc(row.uid)}${row.rosterMember ? '' : ' · historical voter'}</small></td>
      <td><span class="poll-choice ${row.voted ? 'voted' : 'missing'}">${esc(choice)}</span></td>
    </tr>`;
  }).join('');
  return `
    <div class="poll-detail-head">
      <div><div class="eyebrow">ALLIANCE POLL</div><h2>${esc(poll.question)}</h2><p>Created by ${esc(poll.publisherName || 'Unknown')} · ${dateLong(poll.createdAt)}${poll.endsAt ? ` · ends ${dateLong(poll.endsAt)}` : ''}</p></div>
      <span class="poll-status">${pollState(poll)}</span>
    </div>
    <div class="poll-summary-grid">
      ${metric('Roster snapshot', poll.rosterSize || roster.length)}
      ${metric('Voted', poll.voteCount || votedRoster)}
      ${metric('Did not vote', didNotVote)}
      ${metric('Turnout', `${turnout.toFixed(1)}%`)}
    </div>
    <div class="poll-option-grid">${optionCards}</div>
    <div class="poll-participant-head"><div><h3>Player responses</h3><p>The roster is frozen when this poll is archived, so non-voters stay historically accurate.</p></div><div class="poll-filter-row"><button class="poll-filter active" data-filter="all">All</button><button class="poll-filter" data-filter="voted">Voted</button><button class="poll-filter" data-filter="missing">Did not vote</button><input class="input" id="poll-player-search" placeholder="Search player"></div></div>
    <div class="poll-table-wrap"><table class="responsive-table poll-participant-table"><thead><tr><th>Player</th><th>Response</th></tr></thead><tbody>${participantRows}</tbody></table></div>
    <div class="poll-archive-meta">Poll ID ${esc(poll.pollId)} · captured ${dateLong(poll.capturedAt)} · archived ${dateLong(poll.firstArchivedAt)}</div>`;
}

function bindDetailFilters() {
  let filter = 'all';
  let query = '';
  const apply = () => {
    document.querySelectorAll('.poll-participant-table tbody tr').forEach(row => {
      const stateOk = filter === 'all' || row.dataset.voteState === filter;
      const searchOk = !query || String(row.dataset.search || '').includes(query);
      row.hidden = !(stateOk && searchOk);
    });
  };
  document.querySelectorAll('.poll-filter').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter || 'all';
    document.querySelectorAll('.poll-filter').forEach(node => node.classList.toggle('active', node === button));
    apply();
  }));
  document.getElementById('poll-player-search')?.addEventListener('input', event => {
    query = String(event.target.value || '').trim().toLowerCase();
    apply();
  });
}

function metric(label, value) { return `<article class="poll-metric"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></article>`; }
function pollState(poll) {
  const end = Date.parse(String(poll.endsAt || ''));
  if (end && end <= Date.now()) return 'Ended';
  return Number(poll.status || 0) === 1 ? 'Ended' : 'Open / captured';
}
function dateShort(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date);
}
function dateLong(value) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? 'unknown time' : new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
