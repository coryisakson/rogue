import type { APIRoute } from 'astro';
import { ensureMigrated, getPool } from '../../lib/services';

/** Public read-only list of games in the KB. */
export const GET: APIRoute = async () => {
  const pool = getPool();
  if (!pool) return Response.json({ error: 'database not configured' }, { status: 503 });
  await ensureMigrated();
  const r = await pool.query('SELECT slug, name, bgg_id, publisher, year, min_players, max_players FROM games ORDER BY name');
  return Response.json({ games: r.rows }, { headers: { 'cache-control': 'public, max-age=60' } });
};
