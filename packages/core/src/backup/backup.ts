import { createHash } from 'node:crypto';
import type { StorageProvider } from '../storage/types.js';

export interface BackupItem {
  name: string; // e.g. "kb.dump"
  data: Uint8Array;
}

export interface BackupManifest {
  kind: string; // "kb" | "files" | "private"
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  items: { name: string; size: number; sha256: string }[];
}

const sha = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');
const day = (iso: string) => iso.slice(0, 10);

export const backupPrefix = (kind: string, createdAt: string) => `backups/${kind}/${day(createdAt)}`;

/** Write items plus a manifest, then verify by re-reading and comparing checksums. Throws if verification fails. */
export async function createBackup(
  store: StorageProvider,
  kind: string,
  items: BackupItem[],
  meta: { appVersion: string; schemaVersion: string; now?: Date },
): Promise<BackupManifest> {
  const createdAt = (meta.now ?? new Date()).toISOString();
  const prefix = backupPrefix(kind, createdAt);
  const manifest: BackupManifest = {
    kind,
    createdAt,
    appVersion: meta.appVersion,
    schemaVersion: meta.schemaVersion,
    items: items.map((i) => ({ name: i.name, size: i.data.byteLength, sha256: sha(i.data) })),
  };
  // A second backup on the same day replaces the first: drop leftovers (e.g. an older unencrypted dump) that the new manifest does not list.
  const wanted = new Set([...items.map((i) => i.name), 'manifest.json']);
  for (const o of await store.list(`${prefix}/`)) if (!wanted.has(o.key.slice(prefix.length + 1))) await store.delete(o.key);
  for (const item of items) await store.put(`${prefix}/${item.name}`, item.data);
  // Manifest last: a backup without a manifest is incomplete and ignored by retention/restore.
  await store.put(`${prefix}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  const problems = await verifyBackup(store, kind, day(createdAt));
  if (problems.length) throw new Error(`backup verification failed: ${problems.join('; ')}`);
  return manifest;
}

/** Returns a list of problems; empty means the backup matches its manifest. */
export async function verifyBackup(store: StorageProvider, kind: string, date: string): Promise<string[]> {
  const prefix = `backups/${kind}/${date}`;
  const raw = await store.get(`${prefix}/manifest.json`);
  if (!raw) return ['manifest missing'];
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as BackupManifest;
  const problems: string[] = [];
  for (const item of manifest.items) {
    const head = await store.head(`${prefix}/${item.name}`);
    if (!head) problems.push(`${item.name} missing`);
    else if (head.sha256 !== item.sha256 || head.size !== item.size) problems.push(`${item.name} checksum mismatch`);
  }
  return problems;
}

/** Dates (YYYY-MM-DD) of complete backups (those with a manifest), oldest first. */
export async function listBackupDates(store: StorageProvider, kind: string): Promise<string[]> {
  const objs = await store.list(`backups/${kind}/`);
  const dates = new Set<string>();
  for (const o of objs) {
    const m = /^backups\/[^/]+\/(\d{4}-\d{2}-\d{2})\/manifest\.json$/.exec(o.key);
    if (m) dates.add(m[1]!);
  }
  return [...dates].sort();
}

export interface Retention {
  daily: number;
  weekly: number;
  monthly: number;
}
export const DEFAULT_RETENTION: Retention = { daily: 7, weekly: 4, monthly: 6 };

function isoWeekKey(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - dow + 3); // Thursday of this week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}

/** Pure function: which dates to keep. Newest N days, newest per week for N weeks, newest per month for N months. */
export function selectKeep(dates: string[], r: Retention = DEFAULT_RETENTION): Set<string> {
  const desc = [...dates].sort().reverse();
  const keep = new Set<string>(desc.slice(0, r.daily));
  const weeks = new Set<string>();
  const months = new Set<string>();
  for (const d of desc) {
    const wk = isoWeekKey(d);
    if (!weeks.has(wk) && weeks.size < r.weekly) {
      weeks.add(wk);
      keep.add(d);
    }
    const mo = d.slice(0, 7);
    if (!months.has(mo) && months.size < r.monthly) {
      months.add(mo);
      keep.add(d);
    }
  }
  return keep;
}

/**
 * Delete backups outside retention, but ONLY if the newest backup verifies (never prune on top of a bad backup).
 * Returns deleted dates.
 */
export async function pruneBackups(store: StorageProvider, kind: string, r: Retention = DEFAULT_RETENTION): Promise<string[]> {
  const dates = await listBackupDates(store, kind);
  const newest = dates[dates.length - 1];
  if (!newest) return [];
  if ((await verifyBackup(store, kind, newest)).length) throw new Error('newest backup does not verify; refusing to prune');
  const keep = selectKeep(dates, r);
  const deleted: string[] = [];
  for (const d of dates) {
    if (keep.has(d)) continue;
    for (const o of await store.list(`backups/${kind}/${d}/`)) await store.delete(o.key);
    deleted.push(d);
  }
  return deleted;
}
