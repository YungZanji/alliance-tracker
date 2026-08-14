import fs from 'node:fs';

const databaseId = process.argv[2];
if (!databaseId) {
  console.error('Usage: node scripts/render-wrangler.mjs <database-id>');
  process.exit(1);
}

const template = fs.readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8');
if (!template.includes('__D1_DATABASE_ID__')) {
  console.error('D1 placeholder was not found in wrangler.template.jsonc');
  process.exit(1);
}

fs.writeFileSync(
  new URL('../wrangler.generated.jsonc', import.meta.url),
  template.replace('__D1_DATABASE_ID__', databaseId),
  'utf8'
);
console.log(`Rendered wrangler.generated.jsonc for D1 ${databaseId}`);
