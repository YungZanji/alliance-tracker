import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'deployments/36c/profile.json')));
const databaseId = process.argv[2];
if (!/^[a-f0-9-]{36}$/i.test(databaseId || '')) throw new Error('Supply the NEW 36C D1 UUID.');
const out = path.join(root, '.build-36c');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
// Build a separate branded artifact. The original WDZ source remains untouched.
// Legacy modules contain alliance constants and SQL literals as well as UI copy.
for (const dir of ['src', 'public']) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  for (const file of fs.readdirSync(path.join(out, dir))) {
    if (!/\.(js|html|css|txt|svg)$/.test(file)) continue;
    const target = path.join(out, dir, file);
    let text = fs.readFileSync(target, 'utf8')
      .replaceAll('wdz.state305.cc', profile.hostname)
      .replaceAll('State305', 'State261')
      .replaceAll('WDZ', profile.allianceAbbr)
      .replace(/\b305\b/g, String(profile.stateId));
    // Hide retired photo variants only in the 36C artifact, including direct image requests.
    if (file === 'scoring-entry-v159.js' || file === 'app.js') {
      const declaration = /const CANYON_LANGUAGES = (\[[\s\S]*?\]);/;
      if (!declaration.test(text)) throw new Error('Canyon language declaration changed: ' + file);
      text = text.replace(declaration, (_, list) =>
        'const CANYON_LANGUAGES = ' + list + '.filter(({ code }) => !' +
        JSON.stringify(profile.hiddenCanyonPhotoLanguages) + '.includes(code));');
    }
    if (file === 'app.js') {
      const entry = "async function renderCanyon() {";
      if (!text.includes(entry)) throw new Error('Canyon page entry changed');
      text = "import { renderCanyonGuide } from './canyon-guide.js';\n" +
        text.replace(entry, "function renderCanyon() { renderCanyonGuide(document.getElementById('main')); }\nasync function renderLegacyCanyon() {");
    }
    if (file === 'index.js') {
      text = text.replace('FROM duel_weekly WHERE cycle_id=?', "FROM duel_weekly WHERE cycle_id=? AND alliance_abbr='36C' AND score>0");
      const signature = 'first_seen_at, last_seen_at)\n      VALUES(?,?,?,?,?,?,?,?,?,?)';
      if (!text.includes(signature)) throw new Error('Sync player insert changed');
      text = text.replace(signature, 'first_seen_at, last_seen_at, login_enabled)\n      VALUES(?,?,?,?,?,?,?,?,?,?,0)');
    }
    if (file === 'app.js') {
      const route = "    await api('/api/auth/login', {";
      const readUid = "  const uid = String(uidInput?.value || '').replace(/[^0-9]/g, '');\n  if (uidInput) uidInput.value = uid;";
      if (!text.includes(route) || !text.includes(readUid)) throw new Error('Player sign-in changed');
      text = text
        .replace('inputmode="numeric" autocomplete="off"', 'type="password" autocomplete="off"')
        .replace(readUid, "  const value = String(uidInput?.value || '');\n  const uid = value.trim().replace(/\\s/g, '');\n  const ownerSignIn = !/^\\d+$/.test(uid);")
        .replace(route, "    await api(ownerSignIn ? '/api/auth/owner-login' : '/api/auth/login', {")
        .replace('body: JSON.stringify({ uid })', 'body: JSON.stringify(ownerSignIn ? { password: value } : { uid })')
        .replace('error.textContent = err.message;', "error.textContent = ownerSignIn ? 'Sign-in failed. Check your entry and try again.' : err.message;")
        .replace("    button.disabled = false;\n    button.textContent = 'Open Alliance Tracker';", "    if (ownerSignIn && uidInput) uidInput.value = '';\n    button.disabled = false;\n    button.textContent = 'Open Alliance Tracker';");
    }
    const loginMount = { 'app-v081.js': 'mountGuestLogin', 'app-v084.js': 'mountPreviewEntry' }[file];
    if (dir === 'public' && loginMount) {
      const call = loginMount + '();';
      if (!text.includes(call)) throw new Error('Login shortcut hook changed: ' + file);
      text = text.replace(call, '/* Front page shortcut omitted on 36C. */');
    }
    if (file === 'app.js') {
      text = text.replace('captured in selected duel', '36C members scored in selected duel');
    }
    // Never bootstrap credentials or privileges from a legacy player name.
    if (file === 'entry.js') {
      text = text.replace(/async function bootstrapAdmin\(env\) \{[\s\S]*?\n\}/,
        'async function bootstrapAdmin(env) { /* Explicit admin provisioning required. */ }');
    }
    if (file === 'scoring-entry-v160.js') {
      text = text.replace('if (!credential && allowBootstrap && Number(player.is_admin || 0) === 1)',
        'if (false /* Legacy default password bootstrap disabled for 36C */)');
    }
    fs.writeFileSync(target, text);
  }
}
fs.copyFileSync(path.join(root, 'deployments/36c/canyon-guide.js'), path.join(out, 'public/canyon-guide.js'));
fs.copyFileSync(path.join(root, 'deployments/36c/duel-league.js'), path.join(out, 'public/duel-league.js'));
// Feature visibility is scoped to this deployment; source pages and scoring remain intact.
const appPath = path.join(out,'public/app.js');
let appText = fs.readFileSync(appPath,'utf8');
appText = "import { renderDuelLeague } from './duel-league.js';\n" + appText;
appText = appText.replace("${navButton('duel', 'Alliance Duel')}","${navButton('duel', 'Alliance Duel')}\n            ${navButton('duel-league', 'Duel League')}");
appText = appText.replace("function navigate(route, push = true) {", "function navigate(route, push = true) {\n  if (['state-ruler','glory-war','guide'].includes(route)) { route='home'; history.replaceState(null,'','/'); }");
appText = appText.replace("const allowed = ['home',", "const allowed = ['duel-league', 'home',");
appText = appText.replace("if (route === 'duel') return renderDuelPage();", "if (route === 'duel-league') return renderDuelLeague(document.getElementById('main'));\n  if (route === 'duel') return renderDuelPage();");
appText = appText.replace('Alliance Duel today, with State Ruler, Glory War and the combined seasonal participation leaderboard built into the same identity system.', 'Alliance Duel scores, the Duel League opponent path, and the Canyon Clash battle plan in one place.');
appText = appText.replace("Track Alliance Duel performance now, add State Ruler and Glory War as their game responses are confirmed, and keep a stable player identity through every name change.", "Track Alliance Duel scores, explore the Duel League opponent path, and prepare for Canyon Clash.");
appText = appText.replace("${featureCard('duel',", "${featureCard('duel-league', 'duel', 'Duel League', 'Road to the Final', 'Explore upcoming opponents and their migration power.', 'League', 'amber')}\n        ${featureCard('canyon', 'ruler', 'Canyon Clash', 'Battle plan', 'Team positions and rotations for every phase.', 'Plan', 'amber')}\n        ${featureCard('duel',");
fs.writeFileSync(appPath,appText);
const orderPath=path.join(out,'public/app-v080.js');
fs.writeFileSync(orderPath,fs.readFileSync(orderPath,'utf8').replace("'Alliance Duel','State Ruler'","'Alliance Duel','Duel League','State Ruler'"));
const guidePath=path.join(out,'public/app-v072.js');
let guide=fs.readFileSync(guidePath,'utf8');
// Prevent the retained guide extension from mounting navigation or a direct route.
guide=guide.replace('function ensureGuideNav() {','function ensureGuideNav() { return;');
guide=guide.replace("location.hash !== '#guide'", "true /* Guide paused on 36C */");
fs.writeFileSync(guidePath,guide);

// Keep the supplied alliance identity and theme isolated to the 36C artifact.
fs.cpSync(path.join(root, 'deployments/36c/brand'), path.join(out, 'public/brand'), { recursive: true });
const portalPath = path.join(out, 'public/app.js');
let portal = fs.readFileSync(portalPath, 'utf8');
const headerMark = '<span class="brand-mark">261</span>';
const loginMark = '<div class="login-crest"><small>STATE</small><strong>261</strong></div>';
if (!portal.includes(headerMark) || !portal.includes(loginMark)) throw new Error('36C logo mounts changed');
portal = portal.replace(headerMark, '<span class="brand-mark"><img src="/brand/alliance-36c-icon.svg" alt="36C" width="48" height="52"></span>')
  .replace(loginMark, '<div class="login-crest"><img src="/brand/alliance-36c-crest.svg" alt="36C Alliance" width="156" height="156"></div>');
fs.writeFileSync(portalPath, portal);
const htmlPath = path.join(out, 'public/index.html');
let html = fs.readFileSync(htmlPath, 'utf8')
  .replace('href="/favicon.svg"', 'href="/brand/alliance-36c-icon.svg"')
  .replace('</head>', '<link rel="stylesheet" href="/brand/theme.css?v=1">\n</head>');
fs.writeFileSync(htmlPath, html);

fs.cpSync(path.join(root, 'deployments/36c/migrations'), path.join(out, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(root, 'deployments/36c/entry.js'), path.join(out, 'entry.js'));
fs.copyFileSync(path.join(root, 'deployments/36c/catalog-power.js'), path.join(out, 'catalog-power.js'));
fs.writeFileSync(path.join(out, 'wrangler.jsonc'), JSON.stringify({
  name: profile.workerName, main: './entry.js',
  compatibility_date: '2026-08-07', compatibility_flags: ['nodejs_compat'],
  keep_vars: true, workers_dev: true,
  assets: { directory: './public', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: true },
  d1_databases: [{ binding: 'DB', database_name: profile.databaseName, database_id: databaseId, migrations_dir: './migrations' }],
  triggers: { crons: [] },
  vars: { APP_NAME: '36C Alliance Tracker', PRIMARY_ALLIANCE_ABBR: '36C', PROFILE_ID: profile.profileId, PRIMARY_STATE: '261' },
  observability: { enabled: true }
}, null, 2));
console.log('Prepared isolated 36C artifact. Uploads and administrator bootstrap are disabled.');
