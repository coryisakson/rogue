import type { APIRoute } from 'astro';
import { ingestGame } from '../../../lib/ingest';

/** Admin only (private Olares entrance for now). POST /api/admin/ingest?game=pandemic */
export const POST: APIRoute = async ({ url }) => {
  const game = url.searchParams.get('game');
  if (!game) return Response.json({ error: 'use ?game=<slug>' }, { status: 400 });
  return Response.json({ results: await ingestGame(game) }, { headers: { 'cache-control': 'no-store' } });
};
