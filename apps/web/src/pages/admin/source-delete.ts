import type { APIRoute } from 'astro';
import { parseSourceDeleteForm, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { deleteSource, sourceInGame } from '../../lib/source-delete';

/**
 * POST from /admin/games/<slug>/sources: permanently delete one source and everything derived from it (lib/source-delete.ts).
 * Admin session + same-origin only; the form must repeat the source id and tick the confirm box. Redirects back with
 * numbers or an error code only, so nothing typed by a user is reflected through the URL.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = Object.fromEntries((await request.formData()).entries());
  const game = typeof form['game'] === 'string' && /^[a-z0-9-]{1,80}$/.test(form['game']) ? form['game'] : '';
  // Back to the game's Manage sources page (/admin/games/<slug>/sources); without a valid game, to the games list.
  const back = (q: Record<string, string | number>) => new Response(null, {
    status: 303,
    headers: {
      location: game ? `/admin/games/${encodeURIComponent(game)}/sources?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}` : '/admin/games',
      'cache-control': 'no-store',
    },
  });
  const p = parseSourceDeleteForm(form);
  const id = typeof form['source'] === 'string' && /^[1-9][0-9]{0,15}$/.test(form['source']) ? form['source'] : '';
  if (!p.ok) return back({ ...(id ? { delete: id } : {}), err: p.code });
  if (!(await sourceInGame(p.value.game, p.value.sourceId))) return back({ err: 'missing' });
  const r = await deleteSource(p.value.sourceId, `admin:${locals.user.id}`, p.value.reason, p.value.allowReingest);
  if (!r) return back({ err: 'missing' });
  return back({ deleted: r.id, chunks: r.chunks, rejected: r.claimsRejected, kept: r.claimsKept, files: r.files, reingest: r.tombstoned ? 'no' : 'yes' });
};
