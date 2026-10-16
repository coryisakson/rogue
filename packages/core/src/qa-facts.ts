/**
 * User Q&A become facts: a well-rated, cited rules-chat answer is turned into a 'qa' candidate claim.
 * Pure functions; the app looks up documents and stores the claim as needs_review (never published here: humans approve).
 */
import { isFaqVisible } from './faq.js';

export interface QaSource { page: number | null; section?: string | null; title: string; url: string }
/** One FAQ tally row: the newest answer to a player question plus its votes and admin status. */
export interface QaRow { question: string; answer: string; sources: QaSource[] | null; total: number; up: number; status: string | null }

/** Claims stay readable on a fact list: long chat answers are cut, not dropped. */
export const QA_MAX_ANSWER = 1200;

/** Cited sources with a real page number; a citation without a page cannot be checked, so it does not count. */
export function pagedSources(sources: QaSource[] | null): QaSource[] {
  return (sources ?? []).filter((s) => Number.isInteger(s.page) && (s.page as number) > 0 && !!s.url);
}

/** A Q&A row may become a fact only when the public FAQ would show it (votes, share, not hidden) and it cites a page. */
export function qaEligibility(row: QaRow): { ok: true } | { ok: false; reason: string } {
  if (row.status === 'hidden') return { ok: false, reason: 'hidden by an admin' };
  if (!isFaqVisible(row.up, row.total, row.status)) return { ok: false, reason: 'not enough helpful votes' };
  if (!row.question.trim() || !row.answer.trim()) return { ok: false, reason: 'empty question or answer' };
  if (pagedSources(row.sources).length === 0) return { ok: false, reason: 'no cited page' };
  return { ok: true };
}

/** Claim body: "Q: <question> A: <answer>" on one line, whitespace collapsed so the same Q&A always gives the same body. */
export function qaClaimBody(question: string, answer: string): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  let a = clean(answer);
  if (a.length > QA_MAX_ANSWER) a = `${a.slice(0, QA_MAX_ANSWER - 1).trimEnd()}…`;
  return `Q: ${clean(question)} A: ${a}`;
}

/** Citation locator in the KB's usual form: "p.4 Setup", or "p.4" without a section. */
export function qaLocator(s: QaSource): string {
  const section = (s.section ?? '').replace(/\s+/g, ' ').trim();
  return section ? `p.${s.page} ${section}` : `p.${s.page}`;
}

/** Everything the app needs to store one Q&A fact; null when the row is not eligible. Duplicate url+page pairs are cited once. */
export function buildQaFact(row: QaRow): { body: string; citations: { url: string; page: number; locator: string }[] } | null {
  if (!qaEligibility(row).ok) return null;
  const seen = new Set<string>();
  const citations: { url: string; page: number; locator: string }[] = [];
  for (const s of pagedSources(row.sources)) {
    const key = `${s.url}#${s.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ url: s.url, page: s.page as number, locator: qaLocator(s) });
  }
  return { body: qaClaimBody(row.question, row.answer), citations };
}
