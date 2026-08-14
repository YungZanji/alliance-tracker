import './app-v083.js';

const root = document.getElementById('app');
let scheduled = false;
let page = 'home';

const observer = new MutationObserver(schedule);
observer.observe(root, { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
schedule();

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => setTimeout(() => {
    scheduled = false;
    if (location.hash === '#preview') return mountPreview();
    document.body.classList.remove('public-preview-mode');
    mountPreviewEntry();
  }, 45));
}

function mountPreviewEntry() {
  const card = document.querySelector('.login-card');
  if (!card || card.querySelector('.public-preview-entry')) return;
  const box = document.createElement('div');
  box.className = 'public-preview-entry';
  box.innerHTML = `<div class="preview-login-divider"><span>Want to look around first?</span></div><button class="preview-login-button" id="public-preview-button" type="button"><span class="preview-login-icon">◫</span><span class="preview-login-copy"><b>Preview the Alliance Tracker</b><small>Explore a read-only demo with fictional data. No account needed.</small></span><strong>Explore</strong></button>`;
  card.appendChild(box);
  box.querySelector('#public-preview-button')?.addEventListener('click', () => {
    page = 'home';
    location.hash = '#preview';
    mountPreview();
  });
}

function mountPreview() {
  document.body.classList.add('public-preview-mode');
  if (root.querySelector('.public-preview-shell')) return;
  root.innerHTML = shell();
  bindShell();
  render();
}

function shell() {
  return `<div class="public-preview-shell"><header class="preview-topbar"><div class="preview-brand"><span class="preview-brand-mark">WDZ</span><span class="preview-brand-copy"><strong>Alliance Tracker</strong><small>State 305 · Public Preview</small></span></div><div class="preview-top-actions"><span class="preview-demo-pill">DEMO DATA</span><button class="preview-back" id="preview-back" type="button">Back to sign in</button></div></header><div class="preview-layout"><aside class="preview-sidebar"><div class="preview-side-title"><span>PUBLIC PREVIEW</span><p>Fictional scores and players only. No private alliance data is loaded.</p></div><nav class="preview-nav">${nav('home','Home')}${nav('leaderboards','Alliance Leaderboards')}${nav('duel','Alliance Duel')}${nav('ruler','State Ruler')}${nav('glory','Glory War')}${nav('polls','Polls')}${nav('activity','Activity')}${nav('guide','Guide')}${nav('admin','Admin')}</nav></aside><main class="preview-main" id="preview-main"></main></div></div>`;
}

function nav(key, label) { return `<button type="button" data-preview-page="${key}">${label}</button>`; }
function bindShell() {
  root.querySelectorAll('[data-preview-page]').forEach(button => button.addEventListener('click', () => { page = button.dataset.previewPage || 'home'; render(); }));
  document.getElementById('preview-back')?.addEventListener('click', () => { location.hash = ''; location.reload(); });
}
function render() {
  root.querySelectorAll('[data-preview-page]').forEach(button => button.classList.toggle('active', button.dataset.previewPage === page));
  const host = document.getElementById('preview-main');
  if (!host) return;
  const pages = { home, leaderboards, duel, ruler, glory, polls, activity, guide, admin };
  host.innerHTML = (pages[page] || home)();
}

function head(eyebrow, title, text, chips = []) { return `<section class="preview-page-head"><div><span class="preview-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${text}</p></div><div class="preview-chip-row">${chips.map(x => `<span class="preview-chip">${x}</span>`).join('')}</div></section>`; }
function metric(value, label, detail) { return `<article class="preview-metric"><strong>${value}</strong><span>${label}</span><small>${detail}</small></article>`; }
function feature(title, text) { return `<article class="preview-feature"><strong>${title}</strong><p>${text}</p></article>`; }
function list(rows) { return `<div class="preview-list">${rows.map(row => `<div class="preview-list-row"><div><strong>${row[0]}</strong><span>${row[1]}</span></div><div><strong>${row[2]}</strong><span>${row[3]}</span></div></div>`).join('')}</div>`; }

function home() {
  return `${head('WDZ · PUBLIC PREVIEW','One place to understand the alliance.','The real tracker turns synchronized game data into rankings, event history, participation context, polls and leadership tools. Everything shown here is fictional demo data.',['Read-only demo','No account needed','No live records'])}<section class="preview-metrics">${metric('99','Alliance members','Example roster size')}${metric('92.4%','Event participation','Season-wide example')}${metric('18','Tracked event weeks','Across multiple Duel Leagues')}${metric('7','Days with clean syncs','Example pipeline health')}</section><section class="preview-grid"><article class="preview-card"><div class="preview-card-head"><div><span class="preview-eyebrow">ACTIVE SEASON</span><h2>Season 4 · Summer Push</h2></div><span class="preview-score">LIVE</span></div>${list([['Current Duel League','Week 3 of 4','Score cutoff','Sep 2'],['State Ruler','76 participants','Glory War','Saturday']])}</article><article class="preview-card"><div class="preview-card-head"><div><span class="preview-eyebrow">THIS WEEK</span><h2>Event pulse</h2></div><span class="preview-chip">DEMO</span></div>${list([['Alliance Duel','Hero Day','83 participating','On pace'],['Alliance Poll','Weekend rally time','71 / 99 voted','Open']])}</article></section><section class="preview-card"><div class="preview-card-head"><div><span class="preview-eyebrow">WHAT IT DOES</span><h2>Built for leadership decisions, not just scoreboards.</h2></div></div><div class="preview-feature-grid">${feature('Combined contribution','Compare Alliance Duel, State Ruler and Glory War across a season.')}${feature('Event drill-downs','Inspect daily and weekly performance without rebuilding screenshots.')}${feature('Participation context','Pair scores with leave and last-seen context before judging attendance.')}${feature('Poll intelligence','Archive votes, filter by answer and identify non-voters.')}${feature('Season history','Freeze completed seasons while preserving permanent rankings.')}${feature('Administrative controls','Manage seasons, guest access, leave, event availability and audit history.')}</div></section>`;
}

function leaderboards() {
  const rows = [['#1','Nova Prime','94.8','97.1','91.6','93.4'],['#2','IronFox','92.3','90.8','95.2','91.0'],['#3','Skyline','89.7','93.0','84.5','90.2'],['#4','Maverick','87.9','86.7','88.4','89.1'],['#5','Echo Seven','86.2','84.2','90.6','83.7']];
  return `${head('SEASON PERFORMANCE','Alliance Leaderboards','Combined contribution across every tracked event in the selected season.',['Season 4','99 players','Fictional ranking'])}<section class="preview-card"><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>Rank</th><th>Player</th><th>Overall</th><th>Alliance Duel</th><th>State Ruler</th><th>Glory War</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong></td><td><strong>${r[1]}</strong><small>WDZ · S305</small></td><td><span class="preview-score">${r[2]}</span></td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function duel() {
  return `${head('EVENT DETAIL','Alliance Duel','Track the matchup day by day, weekly totals and individual contribution.',['Week 3','WDZ vs VTR','Hero Day'])}<section class="preview-metrics">${metric('4.82B','WDZ weekly total','Example')}${metric('4.47B','Opponent total','Example')}${metric('83','Today participants','Out of 99')}${metric('3–1','Daily record','Through Thursday')}</section><section class="preview-grid"><article class="preview-card"><span class="preview-eyebrow">DAILY RESULTS</span>${list([['Monday · Tank Day','Won','1.08B','88% active'],['Tuesday · Build Day','Won','1.21B','93% active'],['Wednesday · Science Day','Lost','1.16B','79% active'],['Thursday · Hero Day','Live','1.37B','84% active']])}</article><article class="preview-card"><span class="preview-eyebrow">TOP CONTRIBUTORS</span>${list([['Nova Prime','6 / 6 days','42.8M','#1'],['Skyline','6 / 6 days','39.6M','#2'],['IronFox','5 / 6 days','37.2M','#3'],['Night Owl','4 / 6 days','18.4M','#27']])}</article></section>`;
}

function ruler() {
  const rows = [['Nova Prime','182.4M','Scored','Online at capture','Credited'],['IronFox','147.8M','Scored','Seen 22m ago','Credited'],['Night Owl','—','No score','Seen 13h ago','Review'],['Pinecone','—','No score','Approved leave','Neutral'],['Solaris','—','No score','Seen 4d ago','Likely missed']];
  return `${head('STATE VS STATE','State Ruler','Review SVS performance alongside activity context instead of treating every missing score the same.',['State 305 vs 411','76 scored','Demo activity'])}<section class="preview-card"><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>Player</th><th>SVS score</th><th>Participation</th><th>Activity context</th><th>Review</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td><span class="preview-score">${r[4]}</span></td></tr>`).join('')}</tbody></table></div></section>`;
}

function glory() {
  return `${head('ALLIANCE EVENT','Glory War','Keep Glory War scoring and participation inside the same season history.',['Saturday','Formation pending','Demo'])}<section class="preview-grid"><article class="preview-card"><span class="preview-eyebrow">LAST EVENT</span><h2>WDZ · 3rd place</h2>${list([['Alliance score','Example result','2.18B','91.7 index'],['Participants','Example attendance','68 / 99','Tracked'],['Top contributor','Nova Prime','71.2M','#1']])}</article><article class="preview-card"><span class="preview-eyebrow">FORMATION READINESS</span><h2>Future team context</h2>${list([['High-power roster','Identified','24','players'],['Confirmed available','Ready','19','players'],['Needs confirmation','Review','5','players']])}</article></section>`;
}

function polls() {
  return `${head('ALLIANCE DECISIONS','Polls','Archive important votes, preserve response coverage and review answer-level participation.',['71 / 99 voted','1 open poll','Demo'])}<section class="preview-grid"><article class="preview-card"><span class="preview-eyebrow">RECENT POLLS</span>${list([['Weekend rally time','Open','71 responses','Current'],['Glory War availability','Closed','84 responses','Archived'],['Season target','Closed','77 responses','Archived']])}</article><article class="preview-card"><span class="preview-eyebrow">WEEKEND RALLY TIME</span><h2>Which window works best?</h2><div class="preview-poll-options"><div class="preview-poll-option"><strong>19:00 UTC</strong><span>31 votes · 44%</span></div><div class="preview-poll-option"><strong>20:00 UTC</strong><span>24 votes · 34%</span></div><div class="preview-poll-option"><strong>21:00 UTC</strong><span>16 votes · 22%</span></div></div></article></section>`;
}

function activity() {
  return `${head('ADMIN VISIBILITY','Activity History','Authorized administrators can review access history separately from synchronized-data audit history.',['Admin-only in real portal','Demo records'])}<section class="preview-grid"><article class="preview-card"><span class="preview-eyebrow">ACCESS</span><h2>Login History</h2>${list([['Commander Demo','Successful login','2 minutes ago','Vancouver'],['Partner Preview','Guest login','48 minutes ago','Read-only'],['Unknown browser','Failed password','3 hours ago','Blocked']])}</article><article class="preview-card"><span class="preview-eyebrow">DATA UPDATES</span><h2>Audit History</h2>${list([['Alliance Duel Sync','Hero Day updated','12 minutes ago','Complete'],['Poll Archive','71 votes saved','1 hour ago','Complete'],['State Ruler','Activity context synced','Yesterday','Complete']])}</article></section>`;
}

function guide() {
  return `${head('TRANSPARENT SCORING','Guide','Members can see what counts, what does not, and why.',['Season scoring','Leave rules','Event definitions'])}<section class="preview-rule-grid">${rule('BYE','Reduced weight','The event happened, but a resource-saving week counts less.')}${rule('NO EVENT','Excluded entirely','If the event did not happen, it is not converted into a zero.')}${rule('MISSED','Zero','If the event happened and there was no approved leave, it is a miss.')}${rule('ON LEAVE','Neutral','Approved leave removes that player/week from the applicable denominator.')}${rule('SEASON','Long-term view','Multiple Duel Leagues can contribute to one season leaderboard.')}${rule('ARCHIVE','Permanent history','Completed seasons can be frozen so final rankings never drift.')}</section>`;
}
function rule(code,title,text) { return `<article class="preview-rule"><span>${code}</span><strong>${title}</strong><p>${text}</p></article>`; }

function admin() {
  return `${head('LEADERSHIP TOOLS','Administrator Preview','A non-functional look at management tools. No real controls are exposed here.',['No write actions','No credentials','Fictional data'])}<section class="preview-admin-grid">${adminCard('Season management','Set scoring windows, archive completed seasons and start the next one.')}${adminCard('Guest access','Create temporary read-only logins for trusted outsiders.')}${adminCard('Event availability','Mark No Event weeks so missing events do not become false zeros.')}${adminCard('Leave management','Distinguish approved absence from an unexcused miss.')}${adminCard('Poll archive','Preserve alliance decisions after the in-game notice disappears.')}${adminCard('Data audit','Review synchronized updates and access history.')}</section><div class="preview-security"><strong>Public preview boundary.</strong> This demo is deliberately disconnected from authentication, private APIs and write controls.</div>`;
}
function adminCard(title,text) { return `<article class="preview-admin-card"><span class="preview-eyebrow">DEMO CONTROL</span><strong>${title}</strong><p>${text}</p><button class="preview-placeholder-button" type="button" disabled>Preview only</button></article>`; }
