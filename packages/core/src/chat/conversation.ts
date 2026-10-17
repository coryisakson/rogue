/** Pure helpers that turn the game-page chat into a conversation: history clamping, follow-up rewrite, budget checks. */
import type { AiProvider } from '../ai/types.js';
import { LANGUAGE_NAMES_EN, isLocale } from '../i18n/index.js';

/** One earlier turn of the thread, as the browser sends it back: the question and the answer text it got. */
export interface ChatTurn { q: string; a: string }

/** Hard caps (abuse/token guard). The thread lives in the browser, so the server re-checks everything it is sent. */
export const MAX_THREAD_TURNS = 12;
export const THREAD_WARN_TURN = 10;
export const MAX_QUESTION_CHARS = 300;
const MAX_ANSWER_CHARS = 4000;

/**
 * Read the `history` field of a POST /api/ask body without trusting it: only well-formed {q, a} string pairs,
 * each clipped, and at most the last MAX_THREAD_TURNS of them (a longer list is cut, then refused by checkChatBudget).
 */
export function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw.slice(-MAX_THREAD_TURNS)) {
    const q = typeof t?.q === 'string' ? t.q.trim().slice(0, MAX_QUESTION_CHARS) : '';
    const a = typeof t?.a === 'string' ? t.a.trim().slice(0, MAX_ANSWER_CHARS) : '';
    if (q) turns.push({ q, a });
  }
  return turns;
}

/** Remove page/section cites like "(p.3)", "(pp. 4, 7)", "(s.2)" and quoted section names: they cost tokens and mean nothing out of context. */
export function stripCitations(answer: string): string {
  return answer
    .replace(/\s*\((?:pp?|s)\.\s*[^)]*\)/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/**
 * Keep the most recent turns that fit in maxChars (oldest first in the result). Citations are stripped first;
 * the newest turns are kept whole where possible and the oldest kept turn has its answer cut to what is left.
 */
export function trimHistory(history: ChatTurn[], opts: { maxTurns?: number; maxChars?: number } = {}): ChatTurn[] {
  const maxTurns = opts.maxTurns ?? 6;
  let left = opts.maxChars ?? 4000;
  const out: ChatTurn[] = [];
  for (const t of history.slice(-maxTurns).reverse()) {
    const q = t.q.slice(0, MAX_QUESTION_CHARS);
    if (q.length > left) break;
    left -= q.length;
    const full = stripCitations(t.a);
    const a = full.length <= left ? full : left > 1 ? full.slice(0, left - 1).trimEnd() + '…' : '';
    left -= a.length;
    out.unshift({ q, a });
    if (left <= 0) break;
  }
  return out;
}

/** The compact 'Conversation so far' block for the answer and rewrite prompts. Empty when there is no history. */
export function historyBlock(history: ChatTurn[]): string {
  if (!history.length) return '';
  return `Conversation so far:\n${history.map((t) => `User: ${t.q}\nAssistant: ${t.a.replace(/\s+/g, ' ')}`).join('\n')}`;
}

export const REWRITE_SYSTEM = 'Rewrite the last question as a standalone question using the conversation; keep the game terms; output only the question.';

/** Added to the answer system prompt when there are earlier turns. */
export const CHAT_HISTORY_ADDENDUM = `
- The prompt may show the conversation so far. Use it only to understand what the user means by the last question. Every rule you state must still come from the numbered excerpts and carry a page cite.`;

/**
 * Clean the rewrite model's output into one question. Anything empty, multi-paragraph junk or over-long falls back to the raw question,
 * so a bad rewrite can never make retrieval worse than no rewrite.
 */
export function parseRewrite(text: string, fallback: string): string {
  const line = (text.split('\n').map((l) => l.trim()).find(Boolean) ?? '')
    .replace(/^(standalone question|question|rewritten question)\s*:\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  return line.length >= 3 && line.length <= MAX_QUESTION_CHARS ? line : fallback;
}

const langName = (code: string) => (isLocale(code) ? LANGUAGE_NAMES_EN[code] : code);

/** Rewrite and translate in one call, for a question asked in another language than the game's rulebook(s). */
export function rewriteTranslateSystem(langs: string[]): string {
  return 'Rewrite the last question as a standalone question using the conversation, if any; keep the game terms. '
    + `Then translate that standalone question into ${langs.map((l) => `${langName(l)} (${l})`).join(', ')}, using the usual rule terms of the game in that language. `
    + `Output only these lines, nothing else:\nQ: <standalone question>\n${langs.map((l) => `${l}: <translation>`).join('\n')}`;
}

/**
 * Read the rewrite+translate output. A missing or junk "Q:" line keeps the question as typed; a missing or junk translation is
 * simply left out (retrieval then runs on the original only), so a bad reply never makes retrieval worse than no rewrite.
 */
export function parseRewriteTranslate(text: string, fallback: string, langs: string[]): { standalone: string; translations: Record<string, string> } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const value = (prefix: string) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
    const v = line ? line.slice(prefix.length + 1).trim().replace(/^["'“”]+|["'“”]+$/g, '').trim() : '';
    return v.length >= 3 && v.length <= MAX_QUESTION_CHARS ? v : null;
  };
  const translations: Record<string, string> = {};
  for (const l of langs) { const v = value(l); if (v) translations[l] = v; }
  return { standalone: value('Q') ?? fallback, translations };
}

export interface RewriteResult { standalone: string; translations: Record<string, string>; promptTokens: number; completionTokens: number; rewritten: boolean }

/**
 * Follow-up questions ("and what about the medic?") make poor search queries. With history, ask the model (no thinking, tiny budget)
 * for a standalone version; without history, or on any failure, use the question as typed.
 * `translateTo` lists rulebook languages that differ from the user's: the same call then also translates the question into them,
 * so retrieval can search the rulebook in its own words (searchRules queries the original and the translations).
 */
export async function rewriteQuestion(ai: Pick<AiProvider, 'chat'> | null, history: ChatTurn[], question: string, opts: { translateTo?: string[]; reasoning?: 'none' | 'low' | 'default' } = {}): Promise<RewriteResult> {
  const langs = opts.translateTo ?? [];
  const none = { standalone: question, translations: {}, promptTokens: 0, completionTokens: 0, rewritten: false };
  if (!ai || (!history.length && !langs.length)) return none;
  try {
    const r = await ai.chat({
      temperature: 0,
      maxTokens: 120 + 100 * langs.length,
      // 'default' sends no reasoning_effort (the model decides); unset keeps the original 'none'.
      ...(opts.reasoning === 'default' ? {} : { reasoning: opts.reasoning ?? 'none' }),
      messages: [
        { role: 'system', content: langs.length ? rewriteTranslateSystem(langs) : REWRITE_SYSTEM },
        { role: 'user', content: `${history.length ? `${historyBlock(history)}\n\n` : ''}Last question: ${question}` },
      ],
    });
    const { standalone, translations } = langs.length ? parseRewriteTranslate(r.text, question, langs) : { standalone: parseRewrite(r.text, question), translations: {} };
    return { standalone, translations, promptTokens: r.promptTokens, completionTokens: r.completionTokens, rewritten: standalone !== question };
  } catch (e) {
    console.warn(`[chat] question rewrite failed, using the raw question: ${(e as Error).message}`);
    return none;
  }
}

export type ChatBudget =
  | { ok: true; turn: number; warn: boolean }
  | { ok: false; limit: 'thread' | 'daily'; message: string };

export const THREAD_LIMIT_MESSAGE = 'This conversation is getting long. Start a new one to keep answers accurate.';

/**
 * Can this question be asked? `priorTurns` is the thread length before it, `usedToday` the user's asks so far today.
 * Admins skip the daily cap (they run evals), but long threads stay refused for everyone: accuracy drops, not just cost.
 */
export function checkChatBudget(input: { priorTurns: number; usedToday: number; dailyLimit: number; admin?: boolean }): ChatBudget {
  if (input.priorTurns >= MAX_THREAD_TURNS) return { ok: false, limit: 'thread', message: THREAD_LIMIT_MESSAGE };
  if (!input.admin && input.usedToday >= input.dailyLimit) {
    return { ok: false, limit: 'daily', message: `You have asked ${input.dailyLimit} questions today, the daily limit. It resets at midnight (UTC); thanks for your patience.` };
  }
  const turn = input.priorTurns + 1;
  return { ok: true, turn, warn: turn >= THREAD_WARN_TURN };
}

/**
 * Answer token cap. With less thinking the model needs less room; list/count answers stay wide.
 * Thinking tokens count against max_tokens on reasoning models, so the cap must leave room for them.
 */
export function answerMaxTokens(wide: boolean, reasoning: 'none' | 'low' | 'default'): number {
  if (wide) return 4000;
  return reasoning === 'none' ? 700 : reasoning === 'low' ? 1500 : 2500;
}
