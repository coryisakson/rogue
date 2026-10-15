import { CHAT_SYSTEM, badCitations, buildPrompt, normalizeQuestion } from '@rogue/core';
import { searchRules, type RuleHit } from './rules-index';
import { ensureMigrated, getAi, getPool } from './services';

export interface ChatAnswer { id?: number; answer: string; sources: { page: number; title: string; url: string; publisher: string | null; quote: string }[]; warning?: string; ms: number }
const cache = new Map<string, ChatAnswer>();

/** Rules chat: retrieve (hybrid + rerank) -> answer ONLY from excerpts with page cites -> check cites were retrieved. */
export async function askRules(game: string, question: string): Promise<ChatAnswer> {
  const q = question.trim().slice(0, 300);
  const key = `${game}|${q.toLowerCase()}`;
  const hit = cache.get(key); if (hit) return hit;
  const t = Date.now();
  const hits: RuleHit[] = await searchRules(q, { game, limit: 5, snippet: 600, rerank: true });
  if (!hits.length) return { answer: 'I could not find anything about this in the indexed rulebook for this game.', sources: [], ms: Date.now() - t };
  const ai = getAi(); if (!ai) throw new Error('AI is not configured');
  const excerpts = hits.map((h) => ({ page: h.page, text: h.snippet }));
  const r = await ai.chat({ temperature: 0, maxTokens: 2500, messages: [{ role: 'system', content: CHAT_SYSTEM }, { role: 'user', content: buildPrompt(q, excerpts) }] });
  const answer = r.text.trim();
  const bad = badCitations(answer, excerpts);
  const out: ChatAnswer = {
    answer,
    sources: hits.map((h) => ({ page: h.page, title: h.source_title, url: h.source_url, publisher: h.publisher, quote: h.snippet.replace(/\s+/g, ' ').slice(0, 220) })),
    ...(bad.length ? { warning: `The answer cites page(s) ${bad.join(', ')} that were not in the retrieved excerpts. Check the rulebook.` } : {}),
    ms: Date.now() - t,
  };
  // Store an id (plus question/answer for the FAQ, never the user) so the page can offer helpful / not helpful votes; a cached answer keeps its id.
  if (answer) {
    try { const pool = getPool(); if (pool) { await ensureMigrated(); out.id = Number((await pool.query(
      'INSERT INTO chat_answers(game_slug, question, question_norm, answer, sources) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      // Answers with a citation warning are never stored for the FAQ (text stays NULL), so they cannot be published.
      [game, bad.length ? null : q, bad.length ? null : normalizeQuestion(q), bad.length ? null : answer, bad.length ? null : JSON.stringify(out.sources.map((x) => ({ page: x.page, title: x.title, url: x.url })))])).rows[0].id); } }
    catch (e) { console.warn('[ask] could not store answer id', (e as Error).message); }
  }
  if (answer) { if (cache.size > 200) cache.clear(); cache.set(key, out); }
  return out;
}
