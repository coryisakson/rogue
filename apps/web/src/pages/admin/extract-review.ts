import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { startExtractReview } from '../../lib/extractor-run';
import { sourceInGame } from '../../lib/source-delete';

/**
 * POST from /admin/games/<slug>/extracts?source=<id>: "Review unsure pages with the Extractor" queues an extract_review job
 * (Reviewer agent, skill extract_review). Admin session + same-origin only. Redirects back with a fixed result code, so
 * nothing typed by a user is reflected through the URL. With the agents off nothing happens and the page says so.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = Object.fromEntries((await request.formData()).entries());
  const game = typeof form['game'] === 'string' && /^[a-z0-9-]{1,80}$/.test(form['game']) ? form['game'] : '';
  const id = typeof form['source'] === 'string' && /^[1-9][0-9]{0,15}$/.test(form['source']) ? Number(form['source']) : 0;
  if (!game || !id) return new Response(null, { status: 303, headers: { location: '/admin/games', 'cache-control': 'no-store' } });
  const back = (code: string, job = 0) => new Response(null, {
    status: 303,
    headers: { location: `/admin/games/${encodeURIComponent(game)}/extracts?source=${id}&review=${code}${job ? `&job=${job}` : ''}#review`, 'cache-control': 'no-store' },
  });
  if (!(await sourceInGame(game, id))) return back('missing');
  const r = await startExtractReview(id);
  if ('error' in r) return back('error');
  if (r.mode === 'agent') return back('queued', r.jobId);
  return back(r.mode);
};
