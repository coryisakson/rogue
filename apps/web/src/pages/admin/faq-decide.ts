import type { APIRoute } from 'astro';
import { parseFaqAction, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { decideFaq } from '../../lib/faq';

/** POST from /admin/faq. Admin session + same-origin only. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const p = parseFaqAction(await request.formData());
  if ('error' in p) return new Response(p.error, { status: 400 });
  await decideFaq(p.game, p.qnorm, p.action, p.reason, locals.user.id);
  return new Response(null, { status: 303, headers: { location: '/admin/faq', 'cache-control': 'no-store' } });
};
