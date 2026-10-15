import type { APIRoute } from 'astro';
import { ensureMigrated, getPool } from '../../../lib/services';

/** GET: list users (id, name, providers) so the owner can pick admin ids. Admin token required (middleware). */
export const GET: APIRoute = async () => {
  const pool = getPool(); if (!pool) return Response.json({ error: 'no database' }, { status: 503 });
  await ensureMigrated();
  const r = await pool.query("SELECT u.id, u.display_name, (SELECT string_agg(provider, ',') FROM identities i WHERE i.user_id=u.id) providers, u.last_login FROM users u ORDER BY u.id");
  return Response.json(r.rows, { headers: { 'cache-control': 'no-store' } });
};
