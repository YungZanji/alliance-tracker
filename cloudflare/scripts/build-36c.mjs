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
fs.cpSync(path.join(root, 'deployments/36c/migrations'), path.join(out, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(root, 'deployments/36c/entry.js'), path.join(out, 'entry.js'));
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
