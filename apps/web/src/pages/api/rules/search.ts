import type { APIRoute } from 'astro';
import { searchRules } from '../../../lib/rules-index';

/** GET /api/rules/search?q=...&game=pandemic : retrieval over whole rulebooks, page-cited, snippets only. */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return Response.json({ error: 'use ?q=' }, { status: 400 });
  const opts: { game?: string; limit?: number } = {};
  const lim = Number(url.searchParams.get('limit')); if (lim > 0) opts.limit = lim;
  const g = url.searchParams.get('game'); if (g) opts.game = g;
  return Response.json({ q, hits: await searchRules(q, opts) }, { headers: { 'cache-control': 'public, max-age=60' } });
};
