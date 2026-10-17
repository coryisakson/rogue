import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalStorageProvider, createBackup, pruneBackups, listBackupDates, verifyBackup, DEFAULT_RETENTION, encryptBytes, decryptBytes, newBackupKey,
} from '@rogue/core';
import { services, getPool } from './services';
import { VERSION } from './version';
import { alertOperator } from './notify';

/**
 * Encryption key: env ROGUE_BACKUP_KEY, else a file in the data volume (created on first use). The key lives on a DIFFERENT
 * volume path than the backups, so copying /app/backups off-box does not copy the key. Keep a copy of the key somewhere safe:
 * without it the backups cannot be read.
 */
export function backupKey(): string {
  const env = process.env['ROGUE_BACKUP_KEY']; if (env) return env;
  const path = join(services.dataDir, 'backup-key');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const k = newBackupKey(); writeFileSync(path, k, { mode: 0o600 });
  void alertOperator('A new backup encryption key was created at data/backup-key. Store a copy off-box, or backups cannot be restored if this volume is lost.');
  return k;
}

const backupStore = new LocalStorageProvider(process.env['ROGUE_BACKUP_DIR'] || '/app/backups');
const APP_VERSION = VERSION;

export interface RunStatus { at: string; ok: boolean; detail: string }
const state: { lastBackup?: RunStatus; lastRestoreTest?: RunStatus; running: boolean } = { running: false };
export const getBackupState = () => state;

/** Run a command, return stdout bytes. Rejects with stderr text on non-zero exit. */
function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => out.push(c));
    p.stderr.on('data', (c: Buffer) => (err += c.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 300)}`))));
  });
}

async function schemaVersion(): Promise<string> {
  const r = await getPool()!.query('SELECT max(name) AS v FROM schema_migrations');
  return String(r.rows[0]?.v ?? 'none');
}

/** Dump the KB database (custom format), write it with a manifest, verify, then prune per retention. */
export async function runBackup(): Promise<RunStatus> {
  if (!services.databaseUrl) return { at: new Date().toISOString(), ok: false, detail: 'DATABASE_URL not set' };
  if (state.running) return { at: new Date().toISOString(), ok: false, detail: 'another backup/test is running' };
  state.running = true;
  try {
    const key = backupKey();
    const dump = await run('pg_dump', ['-Fc', '--no-owner', services.databaseUrl]);
    // The data directory holds private rulebook copies plus secrets (oauth.json, admin token), so everything is encrypted.
    // The key file itself is excluded from the archive.
    const files = await run('tar', ['-cf', '-', '-C', services.dataDir, '--exclude=./backup-key', '.']);
    const manifest = await createBackup(backupStore, 'kb', [
      { name: 'kb.dump.enc', data: encryptBytes(dump, key) },
      { name: 'files.tar.enc', data: encryptBytes(files, key) },
    ], {
      appVersion: APP_VERSION, schemaVersion: await schemaVersion(),
    });
    const pruned = await pruneBackups(backupStore, 'kb', DEFAULT_RETENTION);
    state.lastBackup = { at: manifest.createdAt, ok: true, detail: `db ${dump.byteLength} B + files ${files.byteLength} B (encrypted), pruned ${pruned.length}` };
  } catch (e) {
    state.lastBackup = { at: new Date().toISOString(), ok: false, detail: (e as Error).message };
    void alertOperator(`BACKUP FAILED: ${state.lastBackup.detail}`);
  } finally {
    state.running = false;
  }
  return state.lastBackup!;
}

/** Restore the newest backup into a throwaway database and compare table counts with the live schema. */
export async function runRestoreTest(): Promise<RunStatus> {
  const at = new Date().toISOString();
  if (!services.databaseUrl) return { at, ok: false, detail: 'DATABASE_URL not set' };
  if (state.running) return { at, ok: false, detail: 'another backup/test is running' };
  state.running = true;
  const scratch = `rogue_restore_test`;
  const pool = getPool()!;
  try {
    const dates = await listBackupDates(backupStore, 'kb');
    const latest = dates[dates.length - 1];
    if (!latest) throw new Error('no backups to test');
    const bad = await verifyBackup(backupStore, 'kb', latest);
    if (bad.length) throw new Error(`backup ${latest} fails verification: ${bad.join(', ')}`);
    // Older backups (before encryption) are plain kb.dump; newer ones are kb.dump.enc.
    const encrypted = await backupStore.get(`backups/kb/${latest}/kb.dump.enc`);
    const dump = encrypted ? decryptBytes(encrypted, backupKey()) : await backupStore.get(`backups/kb/${latest}/kb.dump`);
    const filesEnc = await backupStore.get(`backups/kb/${latest}/files.tar.enc`);
    let fileCount = 0;
    if (filesEnc) {
      await backupStore.put('tmp/restore-test.tar', decryptBytes(filesEnc, backupKey()));
      fileCount = (await run('tar', ['-tf', `${process.env['ROGUE_BACKUP_DIR'] || '/app/backups'}/tmp/restore-test.tar`])).toString().split('\n').filter(Boolean).length;
    }
    await pool.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await pool.query(`CREATE DATABASE ${scratch}`);
    const scratchUrl = new URL(services.databaseUrl);
    scratchUrl.pathname = `/${scratch}`;
    // pg_restore reads the archive from a file; stage it in the backup dir's scratch area.
    await backupStore.put('tmp/restore-test.dump', dump!);
    const file = `${process.env['ROGUE_BACKUP_DIR'] || '/app/backups'}/tmp/restore-test.dump`;
    await run('pg_restore', ['--no-owner', '-d', scratchUrl.toString(), file]);
    const count = async (url: string) => {
      const out = await run('psql', [url, '-Atc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"]);
      return Number(out.toString().trim());
    };
    const [live, restored] = [await count(services.databaseUrl), await count(scratchUrl.toString())];
    if (live !== restored) throw new Error(`table count mismatch: live ${live}, restored ${restored}`);
    state.lastRestoreTest = { at, ok: true, detail: `restored ${latest}: ${restored} tables match${filesEnc ? `, files archive readable (${fileCount} entries)` : ''}` };
  } catch (e) {
    state.lastRestoreTest = { at, ok: false, detail: (e as Error).message };
    void alertOperator(`RESTORE TEST FAILED: ${state.lastRestoreTest.detail}`);
  } finally {
    await pool.query(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => {});
    await backupStore.delete('tmp/restore-test.dump').catch(() => {});
    await backupStore.delete('tmp/restore-test.tar').catch(() => {});
    state.running = false;
  }
  return state.lastRestoreTest!;
}

let started = false;
/** Hourly tick: first tick on/after 03:00 UTC without a backup today runs one; Sundays also run a restore test. */
export function startBackupScheduler(): void {
  if (started || !services.databaseUrl) return;
  started = true;
  const tick = async () => {
    const now = new Date();
    if (now.getUTCHours() < 3) return;
    const today = now.toISOString().slice(0, 10);
    const dates: string[] = await listBackupDates(backupStore, 'kb').catch(() => [] as string[]);
    if (!dates.includes(today)) {
      await runBackup();
      if (now.getUTCDay() === 0) await runRestoreTest();
    }
  };
  setInterval(() => void tick(), 60 * 60 * 1000).unref();
  setTimeout(() => void tick(), 60 * 1000).unref(); // catch up shortly after a restart
}

export interface BackupRow { date: string; createdAt: string; appVersion: string; schemaVersion: string; files: { name: string; size: number }[]; problems: string[] }

/** Every complete backup on disk, newest first, each re-verified against its checksums (for the admin Backups page). */
export async function listBackups(): Promise<BackupRow[]> {
  const dates = await listBackupDates(backupStore, 'kb').catch(() => [] as string[]);
  const rows: BackupRow[] = [];
  for (const date of dates.slice().reverse()) {
    const raw = await backupStore.get(`backups/kb/${date}/manifest.json`); if (!raw) continue;
    const m = JSON.parse(new TextDecoder().decode(raw));
    rows.push({ date, createdAt: m.createdAt, appVersion: m.appVersion, schemaVersion: m.schemaVersion, files: m.items.map((i: { name: string; size: number }) => ({ name: i.name, size: i.size })), problems: await verifyBackup(backupStore, 'kb', date) });
  }
  return rows;
}
