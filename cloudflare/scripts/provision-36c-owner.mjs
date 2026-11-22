import { createHash } from 'node:crypto';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const db = '06149f7a-3efc-48c9-af66-f91ea4144465';
if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) throw Error('Missing Cloudflare credentials');
async function query(batch) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch })
  });
  const data = await r.json();
  if (!r.ok || !data.success || !Array.isArray(data.result) || data.result.some(x => !x.success)) {
    throw Error(`36C D1 operation failed (HTTP ${r.status}, codes ${data.errors?.map(e => Number(e.code)).join(',') || 'none'})`);
  }
  return data.result;
}
const target = "login_enabled=1 AND alliance_abbr='36C' AND server_id=261";
const [lookup] = await query([{ sql: `SELECT uid FROM players WHERE ${target} AND lower(trim(current_name))='mr zanji'` }]);
const uid = lookup.results?.[0]?.uid;
const check = createHash('sha256').update('36c-owner-provision:v1:' + uid).digest('hex');
if (lookup.results?.length !== 1 || !/^\d{6,24}$/.test(uid || '') || check !== '468eb84004b2f2d6dcd7862a2ca8bc7606c97a0a69bdc38b81b3508388c23901') {
  throw Error('36C owner record did not uniquely match the verified roster account.');
}
const only = 'NOT EXISTS (SELECT 1 FROM players WHERE is_admin=1 AND uid<>?)';
const results = await query([
  { sql: `UPDATE players SET is_admin=1 WHERE uid=? AND ${target} AND ${only}`, params: [uid,uid] },
  { sql: `INSERT INTO admin_credentials(uid,password_salt,password_hash,iterations,created_at,updated_at)
    SELECT uid,'','36c-worker-secret',1,datetime('now'),datetime('now')
    FROM players WHERE uid=? AND is_admin=1 AND ${target} AND ${only}
    ON CONFLICT(uid) DO UPDATE SET password_salt='',password_hash=excluded.password_hash,
      iterations=1,updated_at=excluded.updated_at
    WHERE admin_credentials.password_hash<>excluded.password_hash`, params: [uid,uid] },
  { sql: `SELECT COUNT(*) ready FROM players JOIN admin_credentials USING(uid)
    WHERE uid=? AND is_admin=1 AND password_hash='36c-worker-secret' AND ${target} AND ${only}`, params: [uid,uid] }
]);
if (Number(results[2].results?.[0]?.ready) !== 1) throw Error('36C owner setup did not verify; check existing admin roles.');
console.log('Verified sole 36C owner credential for Mr Zanji.');
