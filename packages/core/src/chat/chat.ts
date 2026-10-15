/** Pure helpers for rules chat. */
export interface Excerpt { page: number; text: string }

export const CHAT_SYSTEM = `You answer board game rules questions using ONLY the numbered rulebook excerpts provided.
- Answer in the same language as the question, in 1-4 short sentences. Quote at most one short phrase.
- After each rule you state, cite the page like (p.3).
- If the excerpts do not contain the answer, say so plainly and suggest checking the official rulebook. Never guess or use outside knowledge.
- If excerpts disagree, say so and cite both.`;

export function buildPrompt(question: string, excerpts: Excerpt[]): string {
  const ex = excerpts.map((e, i) => `[${i + 1}] (p.${e.page}) ${e.text.replace(/\s+/g, ' ').trim()}`).join('\n\n');
  return `Rulebook excerpts:\n\n${ex}\n\nQuestion: ${question}`;
}

/** Page numbers the answer cites, e.g. "(p.3)" or "p. 3, p.4". */
export function citedPages(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\bp\.?\s*(\d{1,3})\b/gi)].map((m) => Number(m[1])))];
}

/** Cited pages that were NOT among the retrieved excerpts (a sign the model invented a citation). */
export function badCitations(answer: string, excerpts: Excerpt[]): number[] {
  const have = new Set(excerpts.map((e) => e.page));
  return citedPages(answer).filter((p) => !have.has(p));
}

/** "How many roles are there", "list all the roles", "which cards...": the answer is spread over several passages and must be assembled. */
export function isAggregateQuestion(q: string): boolean {
  return /\b(how many|number of|list|all (of )?the|what are the|which (are|roles|cards|characters|types)|name (all|the)|count)\b/i.test(q)
    || /\b(wie viele|alle|liste|welche)\b/i.test(q);
}

/** Added to the system prompt for aggregate questions: collect items across excerpts, count them, show the list. */
export const CHAT_AGGREGATE_ADDENDUM = `
This is a list or count question. The rulebook may never state the total. The 1-4 sentence limit does not apply to the list itself.
- Read ALL excerpts and collect every distinct item that matches (for example each named role), without repeating one.
- Give the count you found, then the list, citing the page for each item or group like (p.3).
- If the excerpts may be incomplete (the list seems cut off), say "at least N found in the excerpts" instead of claiming a total.
- Only count items the excerpts actually name. Never add items from outside knowledge.`;
