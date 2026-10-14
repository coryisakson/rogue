import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, type Queryable } from './migrate.js';

function fakeDb(failOn?: string) {
  const applied = new Set<string>();
  const log: string[] = [];
  const db: Queryable = {
    async query(sql, params) {
      log.push(sql.trim().split('\n')[0]!.slice(0, 40));
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      if (sql.startsWith('SELECT name')) return { rows: [...applied].map((name) => ({ name })) };
      if (sql.startsWith('INSERT INTO schema_migrations')) applied.add(String(params?.[0]));
      return { rows: [] };
    },
  };
  return { db, log, applied };
}

describe('migrate', () => {
  it('applies new files once, in order, and skips applied ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rogue-mig-'));
    await writeFile(join(dir, '0002_b.sql'), 'SELECT 2;');
    await writeFile(join(dir, '0001_a.sql'), 'SELECT 1;');
    const { db } = fakeDb();
    expect((await migrate(db, dir)).applied).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(await migrate(db, dir)).toEqual({ applied: [], skipped: ['0001_a.sql', '0002_b.sql'] });
    await rm(dir, { recursive: true });
  });

  it('rolls back and reports a failing migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rogue-mig-'));
    await writeFile(join(dir, '0001_bad.sql'), 'BAD STATEMENT;');
    const { db, log } = fakeDb('BAD STATEMENT');
    await expect(migrate(db, dir)).rejects.toThrow(/0001_bad.sql failed/);
    expect(log).toContain('ROLLBACK');
    await rm(dir, { recursive: true });
  });
});
