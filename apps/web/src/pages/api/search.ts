import type { APIRoute } from 'astro';
import { searchClaims } from '../../lib/kb';

/** Public read-only text search across published claims. ?q=research station */
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return Response.json({ error: 'use ?q=<at least 2 chars>' }, { status: 400 });
  return Response.json({ q, results: await searchClaims(q) }, { headers: { 'cache-control': 'public, max-age=60' } });
};
