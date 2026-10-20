import type { APIRoute } from 'astro';
import { parseUpdateSteps, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { startGameUpdate, stopGameUpdate } from '../../lib/game-update';

/**
 * POST from the "Review and update" card on /admin/games/<slug>/sources (GameUpdateCard): start a run (steps "all" or
 * single steps, optional "redraft") or stop the running one. Admin session + same-origin only. Redirects back with a
 * short status code only.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  const game = String(form.get('game') ?? '');
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return new Response(null, { status: 303, headers: { location: '/admin/games', 'cache-control': 'no-store' } });
  const back = (code: string) => new Response(null, { status: 303, headers: { location: `/admin/games/${encodeURIComponent(game)}/sources?update=${code}#game-update`, 'cache-control': 'no-store' } });
  if (form.get('action') === 'stop') return back((await stopGameUpdate(game, locals.user.id)) ? 'stopped' : 'notrunning');
  const steps = parseUpdateSteps(form.getAll('steps').map(String));
  if (!steps.ok) return back('nosteps');
  const r = await startGameUpdate(game, steps.steps, form.get('redraft') === 'yes', locals.user.id);
  return back(r.ok ? 'started' : /already running/.test(r.error) ? 'running' : 'err');
};
