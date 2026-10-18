import {
  CHAT_SYSTEM, CHAT_AGGREGATE_ADDENDUM, CHAT_HISTORY_ADDENDUM, DailyCounter, answerLanguageRule, answerMaxTokens, badCitations, buildPrompt, chatRoles,
  checkChatBudget, citesUrl, historyBlock, isAggregateQuestion, namedSections, normalizeQuestion, rewriteQuestion, t, trimHistory,
  type ChatBudget, type ChatTurn, type Locale,
} from '@rogue/core';
import { searchRules, expandWithNeighbors, gameRuleLangs, type RuleHit, type SearchStats } from './rules-index';
import { aiConfig, aiRoleOverridden, ensureMigrated, getAi, getPool, services } from './services';
import { setting } from './settings';
import { isAdmin } from './admin';
import type { SessionUser } from './auth';

/** Milliseconds per stage of one ask (logged, and returned so slow stages are visible). */
export interface ChatTimings { rewrite: number; embed: number; search: number; rerank: number; answer: number; total: number }
export interface ChatAnswer {
  id?: number; answer: string; sources: { page: number; printed: number | null; section: string | null; title: string; url: string; publisher: string | null; quote: string; lang: string }[];
  warning?: string; ms: number; timings?: ChatTimings; standalone?: string; promptTokens?: number; completionTokens?: number;
}
const cache = new Map<string, ChatAnswer>();

/** Drop cached answers that cite this URL (an admin deleted the source), so the next ask is answered fresh. Returns how many. */
export function forgetAnswersCiting(url: string): number {
  let n = 0;
  for (const [k, a] of cache) if (citesUrl(a.sources, url)) { cache.delete(k); n++; }
  return n;
}

// Asks per signed-in user per UTC day, shared by /api/ask and the no-JS game page form.
const daily = new DailyCounter();

/** May this user ask now? `priorTurns` is the thread length the client sent. Spends one daily ask when allowed. Limit messages are in `locale`. */
export function spendChatBudget(user: SessionUser, priorTurns: number, locale: Locale = 'en'): ChatBudget {
  const key = String(user.id);
  const b = checkChatBudget({ priorTurns, usedToday: daily.count(key), dailyLimit: services.chatDailyLimit, admin: isAdmin(user) });
  if (b.ok) daily.add(key);
  else b.message = b.limit === 'thread' ? t(locale, 'chat.limitThread') : t(locale, 'chat.limitDaily', { n: services.chatDailyLimit });
  return b;
}

/**
 * Rules chat: (follow-up -> standalone question) -> retrieve (hybrid + rerank) -> answer ONLY from excerpts with page cites -> check cites were retrieved.
 * `history` is the earlier turns of the thread (already clamped by parseHistory); it shapes understanding, never the facts.
 * `userLang` (web chat: the request locale) sets the answer language; the question is also translated into the game's rulebook
 * language(s) for retrieval. Without it (Discord, MCP, evals) the answer follows the question's language, as before.
 */
export async function askRules(game: string, question: string, history: ChatTurn[] = [], userLang?: Locale): Promise<ChatAnswer> {
  const q = question.trim().slice(0, 300);
  const t0 = Date.now();
  const recent = trimHistory(history, { maxTurns: 6, maxChars: 4000 });
  // Rulebooks in another language than the user's: translate the question so keyword search can match the rulebook's words.
  const translateTo = userLang ? (await gameRuleLangs(game)).filter((l) => l !== userLang) : [];
  // Multilingual asks may run on the chat_multilingual override (e.g. Claude while testing); English stays on the default model.
  const roles = chatRoles({ userLang: userLang ?? 'en', translating: translateTo.length > 0, multiConfigured: aiRoleOverridden('chat_multilingual') });
  const rw = await rewriteQuestion(getAi(roles.rewrite), recent, q, { translateTo, reasoning: aiConfig().aiRewriteReasoning });
  const standalone = rw.standalone;
  const timings: ChatTimings = { rewrite: Date.now() - t0, embed: 0, search: 0, rerank: 0, answer: 0, total: 0 };
  // Keyed by the standalone question: "and the medic?" means different things in different threads. The answer language is part of the key.
  const key = `${setting('ROGUE_AI_CHAT_MODEL') ?? '-'}|${game}|${userLang ?? '-'}|${standalone.toLowerCase()}`; // model is part of the key so a model change never serves old answers
  const hit = cache.get(key); if (hit) return hit;
  // List/count questions ("how many roles") need many passages, so look wider and add neighbouring chunks.
  const wide = isAggregateQuestion(standalone) || Object.values(rw.translations).some(isAggregateQuestion);
  const stats: SearchStats = { embedMs: 0, searchMs: 0, rerankMs: 0, promptTokens: 0, completionTokens: 0 };
  const alt = Object.values(rw.translations);
  const hits: RuleHit[] = await searchRules(standalone, { game, limit: wide ? 12 : 5, snippet: 600, rerank: true, stats, alt });
  Object.assign(timings, { embed: stats.embedMs, search: stats.searchMs, rerank: stats.rerankMs });
  if (!hits.length) return { answer: t(userLang ?? 'en', 'chat.notFound'), sources: [], ms: Date.now() - t0, timings: { ...timings, total: Date.now() - t0 } };
  const ai = getAi(roles.answer);
  if (!ai) throw new Error('AI is not configured');
  let excerpts = hits.map((h) => ({ page: h.page, text: h.snippet, section: h.section, printed: h.printed }));
  if (wide) { const more = await expandWithNeighbors(hits.map((h) => h.chunk_id), 2); if (more.length) excerpts = more.slice(0, 30); }
  const reasoning = aiConfig().aiAnswerReasoning;
  const system = (wide ? CHAT_SYSTEM + CHAT_AGGREGATE_ADDENDUM : CHAT_SYSTEM) + answerLanguageRule(userLang) + (recent.length ? CHAT_HISTORY_ADDENDUM : '');
  const tAnswer = Date.now();
  const r = await ai.chat({
    temperature: 0,
    maxTokens: answerMaxTokens(wide, reasoning),
    ...(reasoning === 'default' ? {} : { reasoning }),
    messages: [{ role: 'system', content: system }, { role: 'user', content: buildPrompt(q, excerpts, { conversation: historyBlock(recent), standalone }) }],
  });
  timings.answer = Date.now() - tAnswer;
  timings.total = Date.now() - t0;
  const raw = r.text.trim();
  const bad = badCitations(raw, excerpts);
  const answer = namedSections(raw, excerpts);
  const promptTokens = rw.promptTokens + stats.promptTokens + r.promptTokens;
  const completionTokens = rw.completionTokens + stats.completionTokens + r.completionTokens;
  const out: ChatAnswer = {
    answer,
    sources: hits.map((h) => ({ page: h.page, printed: h.printed, section: h.section, title: h.source_title, url: h.source_url, publisher: h.publisher, quote: h.snippet.replace(/\s+/g, ' ').slice(0, 220), lang: h.lang })),
    ...(bad.length ? { warning: t(userLang ?? 'en', 'chat.badCites', { pages: bad.join(', ') }) } : {}),
    ms: timings.total, timings, standalone, promptTokens, completionTokens,
  };
  console.info(`[ask] ${game} lang=${userLang ?? '-'} translated=${alt.length} model=${roles.answer} turns=${recent.length} rewritten=${rw.rewritten} wide=${wide} rewrite=${timings.rewrite}ms embed=${timings.embed}ms search=${timings.search}ms rerank=${timings.rerank}ms answer=${timings.answer}ms total=${timings.total}ms tokens=${promptTokens}/${completionTokens}`);
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

export interface GameSource { url: string; title: string | null; publisher: string | null; edition: string; availability: string; language: string | null }

/** The documents we hold for a game (one row per source), for the game page's compact Sources list. No claims are loaded. */
export async function gameSources(game: string): Promise<GameSource[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query(
    `SELECT DISTINCT ON (s.id) s.url, s.title, s.publisher, s.availability, s.language, e.label edition
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 ORDER BY s.id`, [game])).rows;
}
