import type { APIRoute } from 'astro';
import { RateLimiter, groupCitations, pageList, sameOrigin } from '@rogue/core';
import { getGame } from '../../lib/kb';
import { askRules } from '../../lib/chat';
import { recordAsk } from '../../lib/unanswered';

// Same budget as the middleware's chat limit, but per signed-in user: this JSON route is not under /games/.
const perUser = new RateLimiter(Number(process.env['ROGUE_CHAT_RATE_LIMIT'] ?? 8), 60_000);
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });

/** POST {"game":"pandemic","q":"What is the hand limit?"} -> one cited answer for the game-page chat thread. Signed-in users only. */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return json({ error: 'bad origin' }, 403);
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to ask the rules assistant.' }, 401);
  if (!perUser.allow(String(user.id))) return json({ error: 'Too many questions; try again in a minute.' }, 429, { 'retry-after': '60' });
  const body = (await request.json().catch(() => null)) as { game?: unknown; q?: unknown } | null;
  const slug = typeof body?.game === 'string' ? body.game : '';
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 300) : '';
  if (q.length < 3) return json({ error: 'Ask a question of at least 3 characters.' }, 400);
  if (!/^[a-z0-9-]+$/.test(slug) || !(await getGame(slug))) return json({ error: 'Unknown game.' }, 404);
  try {
    const res = await askRules(slug, q);
    recordAsk(slug, q, 'web', res);
    const docs = groupCitations(res.sources).map((d) => ({ ...d, cite: pageList(d.pages) }));
    return json({ q, id: res.id ?? null, answer: res.answer, warning: res.warning ?? null, docs });
  } catch (e) {
    console.warn('[api/ask]', (e as Error).message);
    recordAsk(slug, q, 'web', { error: e });
    return json({ error: 'The rules assistant is busy or offline. Please try again in a minute.' }, 503);
  }
};
