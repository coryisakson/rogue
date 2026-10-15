import type { APIRoute } from 'astro';
import { getPool, ensureMigrated } from '../../../lib/services';
import { indexSource } from '../../../lib/rules-index';

/** POST /api/admin/index-rules[?source=ID] indexes one source, or every source with text. */
export const POST: APIRoute = async ({ url }) => {
  const pool = getPool(); if (!pool) return Response.json({ error: 'no db' }, { status: 503 });
  await ensureMigrated();
  const one = url.searchParams.get('source');
  const ids = one ? [Number(one)] : (await pool.query("SELECT id FROM sources WHERE text_path IS NOT NULL ORDER BY id")).rows.map((r) => Number(r.id));
  const out = [];
  for (const id of ids) { try { out.push({ id, ...(await indexSource(id)) }); } catch (e) { out.push({ id, error: (e as Error).message }); } }
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
};
