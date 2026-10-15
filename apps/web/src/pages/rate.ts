import type { APIRoute } from 'astro';
import { RateLimiter, parseRating, safeNext, sameOrigin } from '@rogue/core';
import { ensureMigrated, getPool } from '../lib/services';

const perUser = new RateLimiter(30, 60_000);

/** POST claim=<id>&stars=1..5&next=/games/x. Signed-in users only; one rating per user per claim (re-rating replaces). */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  const user = locals.user;
  if (!user) return new Response(null, { status: 303, headers: { location: `/login?next=${encodeURIComponent(next)}` } });
  if (!perUser.allow(String(user.id))) return new Response('Too many ratings, slow down', { status: 429, headers: { 'retry-after': '60' } });
  const r = parseRating(form);
  const pool = getPool();
  if (!r || !pool) return new Response('Bad request', { status: 400 });
  await ensureMigrated();
  // Only published claims can be rated.
  const ok = await pool.query(
    `INSERT INTO claim_ratings(claim_id, user_id, stars) SELECT c.id, $2::bigint, $3 FROM claims c WHERE c.id=$1 AND c.status='published'
     ON CONFLICT (claim_id, user_id) DO UPDATE SET stars=EXCLUDED.stars, created_at=now()`, [r.claimId, user.id, r.stars]);
  if (!ok.rowCount) return new Response('Claim not found', { status: 404 });
  return new Response(null, { status: 303, headers: { location: `${next.split('#')[0]}#c${r.claimId}`, 'cache-control': 'no-store' } });
};
