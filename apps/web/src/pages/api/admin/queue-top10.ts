import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { adminIds, isAdmin } from '../../../lib/admin';
import { queueTopGames } from '../../../lib/intake';

/**
 * POST /api/admin/queue-top10 puts the admin-approved BGG top 10 (packages/core BGG_TOP10) into the intake queue:
 * one approved 'pick' request per game not yet in the library or requested. Answers {queued, skipped}; safe to run again.
 * The middleware already requires the admin token for /api/admin/*. A browser call must also be same-origin, and a signed-in
 * user who is not an admin gets 404. A token-only call (Hermes) is recorded as the first configured admin.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (locals.user && !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if ((h.has('origin') || h.has('referer')) && !sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const adminId = locals.user?.id ?? adminIds()[0];
  if (!adminId) return Response.json({ error: 'no admin user configured (ROGUE_ADMIN_USER_IDS)' }, { status: 409 });
  const r = await queueTopGames(adminId);
  return Response.json(r, { status: 'error' in r ? 503 : 200, headers: { 'cache-control': 'no-store' } });
};
