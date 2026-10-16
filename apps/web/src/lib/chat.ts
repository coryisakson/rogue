import { CHAT_SYSTEM, badCitations, buildPrompt, namedSections, normalizeQuestion, isAggregateQuestion, CHAT_AGGREGATE_ADDENDUM } from '@rogue/core';
import { searchRules, expandWithNeighbors, type RuleHit } from './rules-index';
import { ensureMigrated, getAi, getPool } from './services';

export interface ChatAnswer { id?: number; answer: string; sources: { page: number; printed: number | null; section: string | null; title: string; url: string; publisher: string | null; quote: string }[]; warning?: string; ms: number }
const cache = new Map<string, ChatAnswer>();

/** Rules chat: retrieve (hybrid + rerank) -> answer ONLY from excerpts with page cites -> check cites were retrieved. */
export async function askRules(game: string, question: string): Promise<ChatAnswer> {
  const q = question.trim().slice(0, 300);
  const key = `${game}|${q.toLowerCase()}`;
  const hit = cache.get(key); if (hit) return hit;
  const t = Date.now();
  // List/count questions ("how many roles") need many passages, so look wider and add neighbouring chunks.
  const wide = isAggregateQuestion(q);
  const hits: RuleHit[] = await searchRules(q, { game, limit: wide ? 8 : 5, snippet: 600, rerank: true });
  if (!hits.length) return { answer: 'I could not find anything about this in the indexed rulebook for this game.', sources: [], ms: Date.now() - t };
  const ai = getAi(); if (!ai) throw new Error('AI is not configured');
  let excerpts = hits.map((h) => ({ page: h.page, text: h.snippet, section: h.section, printed: h.printed }));
  if (wide) { const more = await expandWithNeighbors(hits.map((h) => h.chunk_id)); if (more.length) excerpts = more.slice(0, 16); }
  const r = await ai.chat({ temperature: 0, maxTokens: wide ? 4000 : 2500, messages: [{ role: 'system', content: wide ? CHAT_SYSTEM + CHAT_AGGREGATE_ADDENDUM : CHAT_SYSTEM }, { role: 'user', content: buildPrompt(q, excerpts) }] });
  const raw = r.text.trim();
  const bad = badCitations(raw, excerpts);
  const answer = namedSections(raw, excerpts);
  const out: ChatAnswer = {
    answer,
    sources: hits.map((h) => ({ page: h.page, printed: h.printed, section: h.section, title: h.source_title, url: h.source_url, publisher: h.publisher, quote: h.snippet.replace(/\s+/g, ' ').slice(0, 220) })),
    ...(bad.length ? { warning: `The answer cites page(s) ${bad.join(', ')} that were not in the retrieved excerpts. Check the rulebook.` } : {}),
    ms: Date.now() - t,
  };
  // Store an id (plus question/answer for the FAQ, never the user) so the page can offer helpful / not helpful votes; a cached answer keeps its id.
  if (answer) {
    try { const pool = getPool(); if (pool) { await ensureMigrated(); out.id = Number((await pool.query(
      'INSERT INTO chat_answers(game_slug, question, question_norm, answer, sources) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      // Answers with a citation warning are never stored for the FAQ (text stays NULL), so they cannot be published.
      [game, bad.length ? null : q, bad.length ? null : normalizeQuestion(q), bad.length ? null : answer, bad.length ? null : JSON.stringify(out.sources.map((x) => ({ page: x.page, section: x.section, title: x.title, url: x.url })))])).rows[0].id); } }
    catch (e) { console.warn('[ask] could not store answer id', (e as Error).message); }
  }
  if (answer) { if (cache.size > 200) cache.clear(); cache.set(key, out); }
  return out;
}
