import type { APIRoute } from 'astro';
import { parseReview, sameOrigin } from '@rogue/core';
import { isAdmin } from '../../lib/admin';
import { applyReview } from '../../lib/claim-review';

/** POST from the claim review queue. Admin session + same-origin only (middleware also guards /admin). */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!locals.user || !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  const parsed = parseReview(form);
  if ('error' in parsed) return new Response(parsed.error, { status: 400 });
  await applyReview(parsed, locals.user.id);
  // Stay on the same filter/page; only allow local relative paths.
  const next = String(form.get('next') ?? '');
  const safe = next.startsWith('/admin/claims') ? next : '/admin/claims';
  return new Response(null, { status: 303, headers: { location: safe, 'cache-control': 'no-store' } });
};
