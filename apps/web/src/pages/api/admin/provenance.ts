import type { APIRoute } from 'astro';
import { ensureMigrated, getPool } from '../../../lib/services';

/** GET: the provenance audit. `violations` must be empty; counts show how much is covered. Admin token required (middleware). */
export const GET: APIRoute = async () => {
  const pool = getPool(); if (!pool) return Response.json({ error: 'no database' }, { status: 503 });
  await ensureMigrated();
  const v = (await pool.query('SELECT problem, kind, ref FROM provenance_violations ORDER BY problem, ref LIMIT 200')).rows;
  const n = async (sql: string) => Number((await pool.query(sql)).rows[0].n);
  const counts = {
    publishedClaims: await n("SELECT count(*) n FROM claims WHERE status='published'"),
    sources: await n('SELECT count(*) n FROM sources'),
    chunks: await n('SELECT count(*) n FROM chunks'),
    documents: await n('SELECT count(*) n FROM documents'),
  };
  return Response.json({ ok: v.length === 0, violations: v, counts }, { headers: { 'cache-control': 'no-store' } });
};
