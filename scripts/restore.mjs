#!/usr/bin/env node
// Rogue restore CLI. Standalone on purpose: needs only Node, the backup files and the key (plus pg_restore/tar for the restore commands).
//   node scripts/restore.mjs list    <backupsDir>
//   node scripts/restore.mjs verify  <backupsDir> <YYYY-MM-DD>            checksums + decryption, nothing written
//   node scripts/restore.mjs decrypt <file.enc> <out>                     decrypt one file
//   node scripts/restore.mjs db      <backupsDir> <date> <targetDatabaseUrl> [--force-prod]
//   node scripts/restore.mjs files   <backupsDir> <date> <targetDir>      unpack the data-directory archive
// Key: env ROGUE_BACKUP_KEY (base64) or ROGUE_BACKUP_KEY_FILE.
import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const die = (m) => { console.error('error: ' + m); process.exit(1); };
const key = () => {
  const raw = process.env.ROGUE_BACKUP_KEY ?? (process.env.ROGUE_BACKUP_KEY_FILE ? readFileSync(process.env.ROGUE_BACKUP_KEY_FILE, 'utf8') : '');
  const k = Buffer.from(raw.trim(), 'base64'); if (k.length !== 32) die('set ROGUE_BACKUP_KEY (or ROGUE_BACKUP_KEY_FILE): 32 bytes, base64'); return k;
};
function decrypt(blob) {
  if (blob.length < 32 || blob.subarray(0, 4).toString() !== 'RGE1') die('not an encrypted Rogue backup');
  const d = createDecipheriv('aes-256-gcm', key(), blob.subarray(4, 16)); d.setAuthTag(blob.subarray(blob.length - 16));
  try { return Buffer.concat([d.update(blob.subarray(16, blob.length - 16)), d.final()]); } catch { die('decryption failed: wrong key or damaged backup'); }
}
const dirFor = (root, date) => { const d = join(root, 'backups', 'kb', date); if (!existsSync(join(d, 'manifest.json'))) die(`no complete backup for ${date} under ${root}`); return d; };
const manifestOf = (d) => JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
const checkSums = (d, m) => { for (const i of m.items) { const got = createHash('sha256').update(readFileSync(join(d, i.name))).digest('hex'); if (got !== i.sha256) die(`checksum mismatch: ${i.name}`); } };
const plain = (d, name) => { const raw = readFileSync(join(d, name)); return name.endsWith('.enc') ? decrypt(raw) : raw; };

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'list') {
  const base = join(a[0] ?? die('usage: list <backupsDir>'), 'backups', 'kb');
  for (const date of existsSync(base) ? readdirSync(base).sort() : []) { const p = join(base, date, 'manifest.json'); if (existsSync(p)) { const m = manifestOf(join(base, date)); console.log(date, 'v' + m.appVersion, m.items.map((i) => `${i.name}(${i.size})`).join(' ')); } }
} else if (cmd === 'verify') {
  const d = dirFor(a[0], a[1] ?? die('usage: verify <backupsDir> <date>')); const m = manifestOf(d); checkSums(d, m);
  for (const i of m.items) if (i.name.endsWith('.enc')) decrypt(readFileSync(join(d, i.name)));
  console.log(`OK ${a[1]}: ${m.items.length} file(s), checksums match, decryption works`);
} else if (cmd === 'decrypt') {
  writeFileSync(a[1] ?? die('usage: decrypt <file.enc> <out>'), decrypt(readFileSync(a[0]))); 
} else if (cmd === 'db') {
  const [root, date, target] = a; if (!target) die('usage: db <backupsDir> <date> <targetDatabaseUrl> [--force-prod]');
  // Guard: restoring over the live database is a staged, approved action (design plan 1a), never an accident.
  if (process.env.DATABASE_URL && sameDb(process.env.DATABASE_URL, target) && !a.includes('--force-prod')) die('target is the live DATABASE_URL; refusing without --force-prod (needs Cory\'s approval)');
  const d = dirFor(root, date); const m = manifestOf(d); checkSums(d, m);
  const name = m.items.find((i) => i.name.startsWith('kb.dump'))?.name ?? die('no kb.dump in backup');
  const tmp = join(process.env.TMPDIR ?? '/tmp', `rogue-restore-${process.pid}.dump`); writeFileSync(tmp, plain(d, name), { mode: 0o600 });
  try { execFileSync('pg_restore', ['--no-owner', '--clean', '--if-exists', '-d', target, tmp], { stdio: 'inherit' }); } finally { rmSync(tmp, { force: true }); }
  console.log('database restored from ' + date);
} else if (cmd === 'files') {
  const [root, date, out] = a; if (!out) die('usage: files <backupsDir> <date> <targetDir>');
  const d = dirFor(root, date); const m = manifestOf(d); checkSums(d, m);
  const name = m.items.find((i) => i.name.startsWith('files.tar'))?.name ?? die('this backup has no files archive');
  mkdirSync(out, { recursive: true }); const tmp = join(process.env.TMPDIR ?? '/tmp', `rogue-files-${process.pid}.tar`); writeFileSync(tmp, plain(d, name), { mode: 0o600 });
  try { execFileSync('tar', ['-xf', tmp, '-C', out], { stdio: 'inherit' }); } finally { rmSync(tmp, { force: true }); }
  console.log('files restored to ' + out);
} else die('commands: list | verify | decrypt | db | files (see header of this file)');

function sameDb(x, y) { try { const u = new URL(x), v = new URL(y); return u.host === v.host && u.pathname === v.pathname; } catch { return false; } }
