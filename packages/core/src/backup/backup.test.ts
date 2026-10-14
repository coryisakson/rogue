import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from '../storage/local.js';
import { createBackup, listBackupDates, pruneBackups, selectKeep, verifyBackup } from './backup.js';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});
const enc = (s: string) => new TextEncoder().encode(s);
const meta = (d: string) => ({ appVersion: '0.0.3', schemaVersion: '0001', now: new Date(`${d}T03:00:00Z`) });

describe('backup', () => {
  it('creates a verified backup and detects corruption', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rogue-bk-'));
    const s = new LocalStorageProvider(dir);
    const m = await createBackup(s, 'kb', [{ name: 'kb.dump', data: enc('data') }], meta('2026-10-14'));
    expect(m.items[0]!.sha256).toHaveLength(64);
    expect(await verifyBackup(s, 'kb', '2026-10-14')).toEqual([]);
    await writeFile(join(dir, 'backups/kb/2026-10-14/kb.dump'), 'tampered');
    expect(await verifyBackup(s, 'kb', '2026-10-14')).toEqual(['kb.dump checksum mismatch']);
  });

  it('ignores incomplete backups (no manifest)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rogue-bk-'));
    const s = new LocalStorageProvider(dir);
    await s.put('backups/kb/2026-10-01/kb.dump', enc('x'));
    await createBackup(s, 'kb', [{ name: 'kb.dump', data: enc('y') }], meta('2026-10-02'));
    expect(await listBackupDates(s, 'kb')).toEqual(['2026-10-02']);
  });

  it('selectKeep keeps 7 daily, newest per week and month', () => {
    const dates: string[] = [];
    for (let i = 0; i < 90; i++) dates.push(new Date(Date.UTC(2026, 6, 1) + i * 86400000).toISOString().slice(0, 10));
    const keep = selectKeep(dates);
    const newest7 = dates.slice(-7);
    for (const d of newest7) expect(keep.has(d)).toBe(true);
    expect(keep.size).toBeLessThan(dates.length);
    expect(keep.size).toBeGreaterThanOrEqual(7);
    expect(keep.size).toBeLessThanOrEqual(7 + 4 + 6);
  });

  it('prune deletes old backups but refuses when the newest is corrupt', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rogue-bk-'));
    const s = new LocalStorageProvider(dir);
    for (let i = 1; i <= 12; i++) {
      const d = `2026-09-${String(i).padStart(2, '0')}`;
      await createBackup(s, 'kb', [{ name: 'kb.dump', data: enc(d) }], meta(d));
    }
    const deleted = await pruneBackups(s, 'kb', { daily: 3, weekly: 0, monthly: 0 });
    expect(deleted).toHaveLength(9);
    expect(await listBackupDates(s, 'kb')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    await writeFile(join(dir, 'backups/kb/2026-09-12/kb.dump'), 'bad');
    await expect(pruneBackups(s, 'kb', { daily: 1, weekly: 0, monthly: 0 })).rejects.toThrow(/refusing to prune/);
  });
});
