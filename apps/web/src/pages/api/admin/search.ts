import type { APIRoute } from 'astro';
import { bggSearchNote, isBggGameUrl, parseBggMatches } from '@rogue/core';
import { searchEnabled, searchGameOutcome, webSearch } from '../../../lib/search';

/**
 * GET ?q=...  Admin token only. Checks the search provider from inside the pod and shows the pick list it would build
 * (the same query phrases as the admin title search). ?raw=1 sends q as typed and also counts the BGG game pages.
 */
export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  if (!searchEnabled()) return Response.json({ enabled: false });
  const headers = { 'cache-control': 'no-store' };
  try {
    if (url.searchParams.get('raw')) {
      const hits = await webSearch(q, 25);
      return Response.json({ enabled: true, hits: hits.length, bggPages: hits.filter((h) => isBggGameUrl(h.url)).length, matches: parseBggMatches(hits) }, { headers });
    }
    const o = await searchGameOutcome(q);
    if (o.kind === 'error') return Response.json({ enabled: true, error: o.message }, { status: 502 });
    if (o.kind === 'off') return Response.json({ enabled: false });
    return Response.json({ enabled: true, hits: o.rawHits, queries: o.queries, matches: o.matches, note: bggSearchNote(o, q) }, { headers });
  } catch (e) { return Response.json({ enabled: true, error: (e as Error).message }, { status: 502 }); }
};
