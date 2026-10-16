/** Pure helpers for rules chat. */
import { formatPageCite } from '../pagelabels.js';

/** `section` is set for web-page sources: they have no pages, so the excerpt is cited as (s.N) and shown by its heading.
 *  `printed` is the page number printed in the PDF; display only, citations stay the physical p.N. */
export interface Excerpt { page: number; text: string; section?: string | null; printed?: number | null }

export const CHAT_SYSTEM = `You answer board game rules questions using ONLY the numbered rulebook excerpts provided.
- Answer in the same language as the question, in 1-4 short sentences. Quote at most one short phrase.
- After each rule you state, cite the page like (p.3). An excerpt labelled (p.7 (printed 5)) is cited as (p.7): always use the first number. Excerpts labelled (s.N "heading") come from a web page: cite those like (s.2), never as a page.
- If the excerpts do not contain the answer, say so plainly and suggest checking the official rulebook. Never guess or use outside knowledge.
- If excerpts disagree, say so and cite both. But a role's special ability that changes a general rule is an exception, not a disagreement: state the general rule first, then the exception.
- Excerpts come from two-column PDFs, so words from neighbouring columns can run together. Use sense to separate them.`;

export function buildPrompt(question: string, excerpts: Excerpt[]): string {
  const ex = excerpts.map((e, i) => `[${i + 1}] (${e.section ? `s.${e.page} "${e.section}"` : formatPageCite(e.page, e.printed)}) ${e.text.replace(/\s+/g, ' ').trim()}`).join('\n\n');
  return `Rulebook excerpts:\n\n${ex}\n\nQuestion: ${question}`;
}

/** Page numbers the answer cites, e.g. "(p.3)" or "p. 3, p.4". */
export function citedPages(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\bp\.?\s*(\d{1,3})\b/gi)].map((m) => Number(m[1])))];
}

/** Web-page sections the answer cites, e.g. "(s.2)". */
export function citedSections(answer: string): number[] {
  return [...new Set([...answer.matchAll(/\bs\.\s*(\d{1,3})\b/gi)].map((m) => Number(m[1])))];
}

/** Cited pages/sections that were NOT among the retrieved excerpts (a sign the model invented a citation). Sections come back as "s.N". */
export function badCitations(answer: string, excerpts: Excerpt[]): (number | string)[] {
  const havePages = new Set(excerpts.filter((e) => !e.section).map((e) => e.page));
  const haveSections = new Set(excerpts.filter((e) => e.section).map((e) => e.page));
  return [
    ...citedPages(answer).filter((p) => !havePages.has(p)),
    ...citedSections(answer).filter((n) => !haveSections.has(n)).map((n) => `s.${n}`),
  ];
}

/** Replace "(s.2)" with the section's heading so users see "What's in the box", not a made-up page number. */
export function namedSections(answer: string, excerpts: Excerpt[]): string {
  const names = new Map(excerpts.filter((e) => e.section).map((e) => [e.page, e.section as string]));
  return answer.replace(/\bs\.\s*(\d{1,3})\b/gi, (m, n) => (names.has(Number(n)) ? `"${names.get(Number(n))}"` : m));
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
- State the count definitively ("There are N ...") when the excerpts show the whole list (for example a section that introduces all of them, or a complete set). Use "at least N found in the excerpts" ONLY when the list is visibly cut off or the excerpts clearly skip part of it.
- Cite ONLY page numbers printed as (p.N) or (s.N) in the excerpts. Excerpt numbers like [3] are not pages. If an item appears on several pages, cite just one or two of those pages.
- Because of the two-column layout, two neighbouring names can appear joined (for example a heading followed by the next heading). Split them into separate items and never list a joined pair as one item or as two overlapping items.
- Only count items the excerpts actually name. Never add items from outside knowledge.`;
