import type { APIRoute } from 'astro';
import { scoreAskAnswer, type AskEvalQuestion } from '@rogue/core';
import { askRules } from '../../../lib/chat';
import pandemic from '../../../../../../packages/core/eval/ask-pandemic.json';
import slay from '../../../../../../packages/core/eval/ask-slay-the-spire.json';

const SETS: Record<string, { game: string; questions: AskEvalQuestion[] }> = { pandemic: pandemic as never, 'slay-the-spire': slay as never };

/** GET /api/admin/eval-ask?game=pandemic&from=0&n=5 : run the answer-level eval through the real Ask path (admin token only; costs AI calls). */
export const GET: APIRoute = async ({ url }) => {
  const set = SETS[url.searchParams.get('game') ?? 'pandemic'];
  if (!set) return Response.json({ error: 'unknown game' }, { status: 400 });
  const from = Number(url.searchParams.get('from') ?? 0), n = Number(url.searchParams.get('n') ?? 5);
  const rows = [];
  for (const item of set.questions.slice(from, from + n)) {
    try {
      const a = await askRules(set.game, item.q);
      rows.push({ q: item.q, kind: item.kind ?? 'fact', expected: item.expected, ...scoreAskAnswer(item, a), answer: a.answer.slice(0, 700), pages: a.sources.map((s) => s.page), ms: a.ms });
    } catch (e) { rows.push({ q: item.q, pass: false, reasons: [(e as Error).message] }); }
  }
  return Response.json({ game: set.game, from, total: set.questions.length, passed: rows.filter((r) => r.pass).length, rows }, { headers: { 'cache-control': 'no-store' } });
};
