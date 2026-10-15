import type { APIRoute } from 'astro';
import { getClaims, getGame } from '../../../../lib/kb';

/** Public read-only KB query: published claims for a game, with citations. ?topic=setup&q=cubes */
export const GET: APIRoute = async ({ params, url }) => {
  const game = await getGame(params.slug!);
  if (!game) return Response.json({ error: 'unknown game' }, { status: 404 });
  const opts: { topic?: string; q?: string } = {};
  const t = url.searchParams.get('topic'), q = url.searchParams.get('q');
  if (t) opts.topic = t;
  if (q) opts.q = q;
  return Response.json({ game, claims: await getClaims(params.slug!, opts) }, { headers: { 'cache-control': 'public, max-age=60' } });
};
