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
