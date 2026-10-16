import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../../lib/admin';
import { getGame } from '../../../lib/kb';
import { createQaFacts } from '../../../lib/qa-facts';

/**
 * POST /api/admin/qa-facts?game=pandemic turns well-rated, cited chat answers into 'qa' claims waiting for review
 * (status needs_review, never published here). Answers {created, skipped, reasons}; safe to run again.
 * The middleware already requires the admin token for /api/admin/*. A browser call must also be same-origin, and a signed-in
 * user who is not an admin gets 404.
 */
export const POST: APIRoute = async ({ url, request, locals }) => {
  const h = request.headers;
  if (locals.user && !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if ((h.has('origin') || h.has('referer')) && !sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const game = url.searchParams.get('game') ?? '';
  if (!/^[a-z0-9-]+$/.test(game)) return Response.json({ error: 'use ?game=<slug>' }, { status: 400 });
  if (!(await getGame(game))) return Response.json({ error: 'unknown game' }, { status: 404 });
  return Response.json(await createQaFacts(game), { headers: { 'cache-control': 'no-store' } });
};
