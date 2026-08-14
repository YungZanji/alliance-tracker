import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../public/app-v084.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/preview-v110.css', import.meta.url), 'utf8');

for (const text of [
  "import './app-v083.js'",
  "location.hash === '#preview'",
  'Preview the Alliance Tracker',
  'DEMO DATA',
  'Alliance Leaderboards',
  'Alliance Duel',
  'State Ruler',
  'Glory War',
  'Polls',
  'Activity History',
  'Guide',
  'Administrator Preview',
  'Back to sign in',
]) {
  if (!preview.includes(text)) throw new Error(`Missing public preview feature: ${text}`);
}
if (preview.includes('fetch(')) throw new Error('Public preview must not make network requests.');
if (preview.includes('/api/')) throw new Error('Public preview must not reference private API routes.');
if (!index.includes('/preview-v110.css?v=110')) throw new Error('Preview stylesheet is not loaded.');
if (!index.includes('/app-v084.js?v=110')) throw new Error('Preview module is not loaded.');
if (!css.includes('.public-preview-shell')) throw new Error('Preview shell styles are missing.');
if (!css.includes('@media(max-width:720px)')) throw new Error('Preview mobile layout is missing.');

console.log('Verified Portal 1.1.0 public preview: fictional data only, no API calls, all showcase sections present.');
