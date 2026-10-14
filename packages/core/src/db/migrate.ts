import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The tiny slice of a Postgres client the migrator needs (satisfied by pg.Client and by test fakes). */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Apply *.sql files in name order, once each, each inside a transaction. */
export async function migrate(db: Queryable, dir: string): Promise<MigrationResult> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
    result.applied.push(file);
  }
  return result;
}
