import type { APIRoute } from 'astro';
import { parseFaqAction, parseUnansweredAction, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { decideFaq } from '../../lib/faq';
import { decideUnanswered } from '../../lib/unanswered';

/** POST from /admin/faq (low-rated answers, or kind=no_answer for unanswered questions). Admin session + same-origin only. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  if (form.get('kind') === 'no_answer') {
    const u = parseUnansweredAction(form);
    if ('error' in u) return new Response(u.error, { status: 400 });
    await decideUnanswered(u.game, u.qnorm, u.action, locals.user.id);
  } else {
    const p = parseFaqAction(form);
    if ('error' in p) return new Response(p.error, { status: 400 });
    await decideFaq(p.game, p.qnorm, p.action, p.reason, locals.user.id);
  }
  return new Response(null, { status: 303, headers: { location: '/admin/faq', 'cache-control': 'no-store' } });
};
