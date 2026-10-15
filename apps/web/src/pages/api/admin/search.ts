import type { APIRoute } from 'astro';
import { parseBggMatches } from '@rogue/core';
import { searchEnabled, webSearch } from '../../../lib/search';

/** GET ?q=...  Admin token only. Checks the search provider from inside the pod and shows the pick list it would build. */
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  if (!searchEnabled()) return Response.json({ enabled: false });
  try {
    const hits = await webSearch(url.searchParams.get('raw') ? q : `site:boardgamegeek.com/boardgame ${q}`, 25);
    return Response.json({ enabled: true, hits: hits.length, matches: parseBggMatches(hits) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ enabled: true, error: (e as Error).message }, { status: 502 }); }
};
