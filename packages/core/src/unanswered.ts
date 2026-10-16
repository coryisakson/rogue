/**
 * Unanswered Ask questions join the same admin improvement queue as poorly rated answers.
 * Pure functions: which Ask results count as "no answer", how repeats are merged, how the queue is ordered.
 */
import { citedPages, citedSections } from './chat/chat.js';
import { normalizeQuestion } from './faq.js';

/** Why an Ask produced nothing useful. */
export type NoAnswerKind = 'error' | 'empty' | 'no_sources' | 'refusal';
/** Why a question sits in the improvement queue. */
export type QueueReason = 'low_rating' | 'no_answer';
export type AskChannel = 'web' | 'discord';

/** Phrases the model uses when the excerpts do not hold the answer (CHAT_SYSTEM tells it to "say so plainly"). */
const REFUSAL = [
  /\b(could ?not|couldn't|cannot|can't|can not|unable to|was not able to) (find|locate|determine|answer|see)\b/i,
  /\b(do|does|did)(n't| not) (contain|cover|mention|say|specify|include|address|state|explain|describe)\b/i,
  /\bnot (covered|mentioned|specified|addressed|stated|included|described|explained)\b/i,
  /\bno (information|mention|details?|rules?|answer)\b[^.]*\b(excerpts?|rulebook|provided|given)\b/i,
];

/**
 * Classify one Ask outcome. Returns null when there is a real answer.
 * A refusal only counts when the answer cites nothing: "the excerpts do not say X, but (p.3) says Y" is a partial answer.
 */
export function classifyNoAnswer(r: { answer?: string | null; sources?: unknown[] | null; error?: unknown }): NoAnswerKind | null {
  if (r.error) return 'error';
  const answer = (r.answer ?? '').trim();
  if (!r.sources || r.sources.length === 0) return 'no_sources';
  if (!answer) return 'empty';
  const cites = citedPages(answer).length + citedSections(answer).length;
  if (cites === 0 && REFUSAL.some((re) => re.test(answer))) return 'refusal';
  return null;
}

/** Dedupe key: one queue row per game and question, however it was typed. Null when there is nothing to store. */
export function unansweredKey(game: string, question: string): { game_slug: string; question_norm: string } | null {
  const question_norm = normalizeQuestion(question);
  if (!/^[a-z0-9-]{1,60}$/.test(game) || question_norm.length < 3) return null;
  return { game_slug: game, question_norm };
}

/** `count` is how many people it affected: times asked (no_answer) or votes cast (low_rating). */
export interface QueueItem { reason: QueueReason; game_slug: string; question_norm: string; question: string; count: number }

/** One list for the admin: unanswered and low-rated questions together, most-affected first; ties keep input order. */
export function improvementQueue<T extends QueueItem>(items: T[]): T[] {
  return [...items].sort((a, b) => b.count - a.count);
}

/** Admin form for an unanswered question: resolve (fixed, e.g. source added) or dismiss (not a rules question). */
export function parseUnansweredAction(form: { get(k: string): unknown }): { game: string; qnorm: string; action: 'resolve' | 'dismiss' } | { error: string } {
  const game = String(form.get('game') ?? '');
  const qnorm = String(form.get('q') ?? '');
  const action = String(form.get('action') ?? '');
  if (!/^[a-z0-9-]{1,60}$/.test(game) || !qnorm || qnorm.length > 300) return { error: 'Bad question' };
  if (action !== 'resolve' && action !== 'dismiss') return { error: 'Bad action' };
  return { game, qnorm, action };
}
