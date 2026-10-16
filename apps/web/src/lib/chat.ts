import {
  CHAT_SYSTEM, CHAT_AGGREGATE_ADDENDUM, CHAT_HISTORY_ADDENDUM, DailyCounter, answerMaxTokens, badCitations, buildPrompt, checkChatBudget,
  historyBlock, isAggregateQuestion, namedSections, normalizeQuestion, rewriteQuestion, trimHistory, type ChatBudget, type ChatTurn,
} from '@rogue/core';
import { searchRules, expandWithNeighbors, type RuleHit, type SearchStats } from './rules-index';
import { ensureMigrated, getAi, getPool, services } from './services';
import { isAdmin } from './admin';
import type { SessionUser } from './auth';

/** Milliseconds per stage of one ask (logged, and returned so slow stages are visible). */
export interface ChatTimings { rewrite: number; embed: number; search: number; rerank: number; answer: number; total: number }
export interface ChatAnswer {
  id?: number; answer: string; sources: { page: number; printed: number | null; section: string | null; title: string; url: string; publisher: string | null; quote: string }[];
  warning?: string; ms: number; timings?: ChatTimings; standalone?: string; promptTokens?: number; completionTokens?: number;
}
const cache = new Map<string, ChatAnswer>();

// Asks per signed-in user per UTC day, shared by /api/ask and the no-JS game page form.
const daily = new DailyCounter();

/** May this user ask now? `priorTurns` is the thread length the client sent. Spends one daily ask when allowed. */
export function spendChatBudget(user: SessionUser, priorTurns: number): ChatBudget {
  const key = String(user.id);
  const b = checkChatBudget({ priorTurns, usedToday: daily.count(key), dailyLimit: services.chatDailyLimit, admin: isAdmin(user) });
  if (b.ok) daily.add(key);
  return b;
}

/**
 * Rules chat: (follow-up -> standalone question) -> retrieve (hybrid + rerank) -> answer ONLY from excerpts with page cites -> check cites were retrieved.
 * `history` is the earlier turns of the thread (already clamped by parseHistory); it shapes understanding, never the facts.
 */
export async function askRules(game: string, question: string, history: ChatTurn[] = []): Promise<ChatAnswer> {
  const q = question.trim().slice(0, 300);
  const t = Date.now();
  const ai = getAi();
  const recent = trimHistory(history, { maxTurns: 6, maxChars: 4000 });
  const rw = await rewriteQuestion(ai, recent, q);
  const standalone = rw.standalone;
  const timings: ChatTimings = { rewrite: Date.now() - t, embed: 0, search: 0, rerank: 0, answer: 0, total: 0 };
  // Keyed by the standalone question: "and the medic?" means different things in different threads.
  const key = `${game}|${standalone.toLowerCase()}`;
  const hit = cache.get(key); if (hit) return hit;
  // List/count questions ("how many roles") need many passages, so look wider and add neighbouring chunks.
  const wide = isAggregateQuestion(standalone);
  const stats: SearchStats = { embedMs: 0, searchMs: 0, rerankMs: 0, promptTokens: 0, completionTokens: 0 };
  const hits: RuleHit[] = await searchRules(standalone, { game, limit: wide ? 12 : 5, snippet: 600, rerank: true, stats });
  Object.assign(timings, { embed: stats.embedMs, search: stats.searchMs, rerank: stats.rerankMs });
  if (!hits.length) return { answer: 'I could not find anything about this in the indexed rulebook for this game.', sources: [], ms: Date.now() - t, timings: { ...timings, total: Date.now() - t } };
  if (!ai) throw new Error('AI is not configured');
  let excerpts = hits.map((h) => ({ page: h.page, text: h.snippet, section: h.section, printed: h.printed }));
  if (wide) { const more = await expandWithNeighbors(hits.map((h) => h.chunk_id), 2); if (more.length) excerpts = more.slice(0, 30); }
  const reasoning = services.aiAnswerReasoning;
  const system = (wide ? CHAT_SYSTEM + CHAT_AGGREGATE_ADDENDUM : CHAT_SYSTEM) + (recent.length ? CHAT_HISTORY_ADDENDUM : '');
  const tAnswer = Date.now();
  const r = await ai.chat({
    temperature: 0,
    maxTokens: answerMaxTokens(wide, reasoning),
    ...(reasoning === 'default' ? {} : { reasoning }),
    messages: [{ role: 'system', content: system }, { role: 'user', content: buildPrompt(q, excerpts, { conversation: historyBlock(recent), standalone }) }],
  });
  timings.answer = Date.now() - tAnswer;
  timings.total = Date.now() - t;
  const raw = r.text.trim();
  const bad = badCitations(raw, excerpts);
  const answer = namedSections(raw, excerpts);
  const promptTokens = rw.promptTokens + stats.promptTokens + r.promptTokens;
  const completionTokens = rw.completionTokens + stats.completionTokens + r.completionTokens;
  const out: ChatAnswer = {
    answer,
    sources: hits.map((h) => ({ page: h.page, printed: h.printed, section: h.section, title: h.source_title, url: h.source_url, publisher: h.publisher, quote: h.snippet.replace(/\s+/g, ' ').slice(0, 220) })),
    ...(bad.length ? { warning: `The answer cites page(s) ${bad.join(', ')} that were not in the retrieved excerpts. Check the rulebook.` } : {}),
    ms: timings.total, timings, standalone, promptTokens, completionTokens,
  };
  console.info(`[ask] ${game} turns=${recent.length} rewritten=${rw.rewritten} wide=${wide} rewrite=${timings.rewrite}ms embed=${timings.embed}ms search=${timings.search}ms rerank=${timings.rerank}ms answer=${timings.answer}ms total=${timings.total}ms tokens=${promptTokens}/${completionTokens}`);
  // Store an id (plus question/answer for the FAQ, never the user) so the page can offer helpful / not helpful votes; a cached answer keeps its id.
  if (answer) {
    try { const pool = getPool(); if (pool) { await ensureMigrated(); const keep = !bad.length; out.id = Number((await pool.query(
      `INSERT INTO chat_answers(game_slug, question, question_norm, answer, sources, standalone_question, prompt_tokens, completion_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      // Answers with a citation warning are never stored for the FAQ (text stays NULL), so they cannot be published. Token counts are always kept.
      [game, keep ? q : null, keep ? normalizeQuestion(q) : null, keep ? answer : null, keep ? JSON.stringify(out.sources.map((x) => ({ page: x.page, section: x.section, title: x.title, url: x.url }))) : null,
        keep && standalone !== q ? standalone : null, promptTokens, completionTokens])).rows[0].id); } }
    catch (e) { console.warn('[ask] could not store answer id', (e as Error).message); }
  }
  if (answer) { if (cache.size > 200) cache.clear(); cache.set(key, out); }
  return out;
}

export interface GameSource { url: string; title: string | null; publisher: string | null; edition: string; availability: string }

/** The documents we hold for a game (one row per source), for the game page's compact Sources list. No claims are loaded. */
export async function gameSources(game: string): Promise<GameSource[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query(
    `SELECT DISTINCT ON (s.id) s.url, s.title, s.publisher, s.availability, e.label edition
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 ORDER BY s.id`, [game])).rows;
}
