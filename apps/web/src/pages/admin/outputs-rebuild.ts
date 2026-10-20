import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { sourcesChanged } from '../../lib/derived-outputs';

/**
 * POST from "Rebuild one-pager and player aid" on /admin/games/<slug>/sources (OutputsRebuildCard, ADR 0008): queue the
 * Librarian for an undrafted new rulebook, recompute the basis and bump the version if it changed. Admin session +
 * same-origin only. Redirects with the version number or an error code only.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const game = String((await request.formData()).get('game') ?? '');
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return new Response(null, { status: 303, headers: { location: '/admin/games', 'cache-control': 'no-store' } });
  const stamp = await sourcesChanged(game, `admin_rebuild:admin:${locals.user.id}`);
  const location = `/admin/games/${encodeURIComponent(game)}/sources?outputs=${stamp ? stamp.version : 'err'}#outputs-rebuild`;
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
};
