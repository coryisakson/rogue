import type { APIRoute } from 'astro';
import { RateLimiter, parseAnswerVote, safeNext, sameOrigin } from '@rogue/core';
import { ensureMigrated, getPool } from '../lib/services';

const perUser = new RateLimiter(30, 60_000);

/** POST answer=<id>&vote=up|down&next=/games/x/ask?q=... Signed-in users only; one vote per user per answer (re-vote replaces). */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  const user = locals.user;
  if (!user) return new Response(null, { status: 303, headers: { location: `/login?next=${encodeURIComponent(next)}` } });
  if (!perUser.allow(String(user.id))) return new Response('Too many votes, slow down', { status: 429, headers: { 'retry-after': '60' } });
  const v = parseAnswerVote(form);
  const pool = getPool();
  if (!v || !pool) return new Response('Bad request', { status: 400 });
  await ensureMigrated();
  const ok = await pool.query(
    `INSERT INTO chat_answer_ratings(answer_id, user_id, helpful) SELECT a.id, $2::bigint, $3 FROM chat_answers a WHERE a.id=$1
     ON CONFLICT (answer_id, user_id) DO UPDATE SET helpful=EXCLUDED.helpful, created_at=now()`, [v.answerId, user.id, v.helpful]);
  if (!ok.rowCount) return new Response('Answer not found', { status: 404 });
  const sep = next.includes('?') ? '&' : '?';
  return new Response(null, { status: 303, headers: { location: `${next.split('#')[0]}${sep}voted=${v.helpful ? 'up' : 'down'}#answer`, 'cache-control': 'no-store' } });
};
