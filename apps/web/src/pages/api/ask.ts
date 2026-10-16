import type { APIRoute } from 'astro';
import { MAX_THREAD_TURNS, RateLimiter, groupCitations, pageList, parseHistory, sameOrigin } from '@rogue/core';
import { getGame } from '../../lib/kb';
import { askRules, spendChatBudget } from '../../lib/chat';
import { recordAsk } from '../../lib/unanswered';

// Same budget as the middleware's chat limit, but per signed-in user: this JSON route is not under /games/.
const perUser = new RateLimiter(Number(process.env['ROGUE_CHAT_RATE_LIMIT'] ?? 8), 60_000);
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });

/**
 * POST {"game":"pandemic","q":"And the medic?","history":[{"q":"...","a":"..."}]} -> one cited answer for the game-page chat thread.
 * Signed-in users only. `history` is the browser's thread; it is clamped (parseHistory) and only used to understand follow-ups.
 * A thread over MAX_THREAD_TURNS gets 200 {limit:'thread'}; the daily per-user cap gets 429 {limit:'daily'}.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return json({ error: 'bad origin' }, 403);
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to ask the rules assistant.' }, 401);
  if (!perUser.allow(String(user.id))) return json({ error: 'Too many questions; try again in a minute.' }, 429, { 'retry-after': '60' });
  const body = (await request.json().catch(() => null)) as { game?: unknown; q?: unknown; history?: unknown } | null;
  const slug = typeof body?.game === 'string' ? body.game : '';
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 300) : '';
  if (q.length < 3) return json({ error: 'Ask a question of at least 3 characters.' }, 400);
  if (!/^[a-z0-9-]+$/.test(slug) || !(await getGame(slug))) return json({ error: 'Unknown game.' }, 404);
  const history = parseHistory(body?.history);
  // Count the raw list too: a client that sends 50 turns is past the limit even though parseHistory keeps only the last 12.
  const priorTurns = Array.isArray(body?.history) ? Math.max(history.length, Math.min(body.history.length, MAX_THREAD_TURNS)) : history.length;
  const budget = spendChatBudget(user, priorTurns);
  if (!budget.ok) return json({ q, limit: budget.limit, message: budget.message, maxTurns: MAX_THREAD_TURNS }, budget.limit === 'daily' ? 429 : 200);
  try {
    const res = await askRules(slug, q, history);
    recordAsk(slug, q, 'web', res);
    const docs = groupCitations(res.sources).map((d) => ({ ...d, cite: pageList(d.pages) }));
    return json({ q, id: res.id ?? null, answer: res.answer, warning: res.warning ?? null, docs, turn: budget.turn, maxTurns: MAX_THREAD_TURNS, warn: budget.warn, ms: res.ms });
  } catch (e) {
    console.warn('[api/ask]', (e as Error).message);
    recordAsk(slug, q, 'web', { error: e });
    return json({ error: 'The rules assistant is busy or offline. Please try again in a minute.' }, 503);
  }
};
