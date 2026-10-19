import type { APIRoute } from 'astro';
import { parseGameDeleteForm, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { deleteGame } from '../../lib/game-delete';

/**
 * POST from "Delete game" on /admin/games/<slug>/sources (GameDeleteCard): permanently delete a game that has no source,
 * no document and no published fact (lib/game-delete.ts). Admin session + same-origin only; the form must repeat the slug
 * and tick the confirm box. Redirects with a status or error code only, so nothing typed is reflected through the URL.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = Object.fromEntries((await request.formData()).entries());
  const go = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
  const p = parseGameDeleteForm(form);
  // A refusal goes back to the game's sources page (where the card is); without a valid slug, to the games list.
  const back = (code: string) => {
    const game = typeof form['game'] === 'string' && /^[a-z0-9-]{1,80}$/.test(form['game']) ? form['game'] : '';
    return go(game && code !== 'missing' ? `/admin/games/${encodeURIComponent(game)}/sources?gamedel_err=${code}#delete-game` : `/admin/games?err=${code}`);
  };
  if (!p.ok) return back(p.code);
  const r = await deleteGame(p.value.game, `admin:${locals.user.id}`);
  if (!r.ok) return back(r.code);
  return go('/admin/games?deleted=1');
};
