import type { APIRoute } from 'astro';
import { firstRank, summarize, type EvalQuestion } from '@rogue/core';
import { searchRules } from '../../../lib/rules-index';
import pandemic from '../../../../../../packages/core/eval/pandemic.json';

/** GET /api/admin/eval-rules?rerank=0|1 : retrieval quality on the per-game question set (hit@k, MRR). */
export const GET: APIRoute = async ({ url }) => {
  const rerank = url.searchParams.get('rerank') === '1';
  const qs = pandemic.questions as EvalQuestion[];
  const rows = [];
  for (const { q, must } of qs) {
    const t = Date.now();
    const hits = await searchRules(q, { game: pandemic.game, limit: 5, snippet: 600, rerank });
    rows.push({ q, rank: firstRank(hits.map((h) => h.snippet), must), ms: Date.now() - t });
  }
  return Response.json({ rerank, ...summarize(rows), rows }, { headers: { 'cache-control': 'no-store' } });
};
