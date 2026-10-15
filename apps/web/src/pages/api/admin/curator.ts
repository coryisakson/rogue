import type { APIRoute } from 'astro';
import { resolveNeedsReview } from '../../../lib/curator';

/** POST ?action=resolve[&dry=1]  Curator settles needs_review claims by rule (see lib/curator.ts). Admin token only. */
export const POST: APIRoute = async ({ url }) => {
  try {
    if (url.searchParams.get('action') !== 'resolve') return Response.json({ error: 'action=resolve' }, { status: 400 });
    return Response.json(await resolveNeedsReview(url.searchParams.get('dry') === '1'), { headers: { 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
};
