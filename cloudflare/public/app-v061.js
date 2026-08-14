import './app.js';

const observer = new MutationObserver(() => polish());
observer.observe(document.getElementById('app'), { childList: true, subtree: true });
polish();

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function polish() {
  polishLogin();
  polishShell();
  polishCurrentPage();
}

function polishLogin() {
  const page = document.querySelector('.login-page');
  if (!page) return;

  const visual = page.querySelector('.login-visual');
  if (visual) {
    setText(visual.querySelector('.eyebrow'), 'WDZ · ALLIANCE TRACKER');
    setText(visual.querySelector('h1'), 'Alliance Tracker.');
    setText(visual.querySelector('p'), 'WDZ scores and standings in one place.');
  }

  const form = document.getElementById('login-form');
  const uid = document.getElementById('uid');
  if (form && uid) {
    uid.type = 'password';
    uid.name = 'password';
    uid.autocomplete = 'current-password';
    uid.inputMode = 'numeric';
    uid.setAttribute('autocapitalize', 'none');
    uid.setAttribute('spellcheck', 'false');
    uid.setAttribute('aria-label', 'Player UID');
    form.setAttribute('autocomplete', 'on');
  }

  setText(page.querySelector('.login-help'), 'WDZ roster members only.');
}

function polishShell() {
  const footer = document.querySelector('.footer');
  if (footer && footer.textContent.includes('Cloudflare')) {
    setText(footer, 'WDZ Alliance Tracker · State 305');
  }
}

function polishCurrentPage() {
  const main = document.getElementById('main');
  if (!main) return;

  const pageTitle = main.querySelector('.page-head h1')?.textContent?.trim() || '';
  if (main.querySelector('.hero')) polishHome(main);
  if (pageTitle === 'Alliance Leaderboards') polishLeaderboards(main);
  if (pageTitle === 'Alliance Duel') polishDuel(main);
  if (pageTitle === 'State Ruler') polishStateRuler(main);
  if (pageTitle === 'Glory War') polishGloryWar(main);
}

function polishHome(main) {
  const hero = main.querySelector('.hero');
  if (!hero) return;
  setText(hero.querySelector('.eyebrow'), 'WDZ · ALLIANCE TRACKER');
  const paragraph = hero.querySelector(':scope > p');
  if (paragraph) paragraph.remove();

  polishFeature(main, 'State Ruler', 'Awaiting results', 'Awaiting results');
  polishFeature(main, 'Glory War', 'Awaiting season start', 'Awaiting season start');
}

function polishFeature(main, title, copy, status) {
  const card = [...main.querySelectorAll('.feature-card')].find(item => item.querySelector('h2')?.textContent?.trim() === title);
  if (!card) return;
  setText(card.querySelector('p'), copy);
  setText(card.querySelector('.badge'), status);
}

function polishLeaderboards(main) {
  setText(main.querySelector('.page-head p'), 'Season participation standings.');
  main.querySelector('.method-box')?.remove();
  setText(main.querySelector('.panel-head .muted'), 'Current season standings.');
}

function polishDuel(main) {
  setText(main.querySelector('.page-head p'), 'Weekly and daily Alliance Duel standings.');
}

function polishStateRuler(main) {
  setText(main.querySelector('.page-head p'), 'State versus State');
  simplifyComing(main, 'Awaiting results', 'Results will appear here when available.');
}

function polishGloryWar(main) {
  setText(main.querySelector('.page-head p'), 'Glory War');
  simplifyComing(main, 'Awaiting season start', 'Results will appear here when the event begins.');
}

function simplifyComing(main, heading, copy) {
  const coming = main.querySelector('.coming');
  if (!coming) return;
  setText(coming.querySelector('h2'), heading);
  setText(coming.querySelector('p'), copy);
  coming.querySelector('.hero-meta')?.remove();
}
