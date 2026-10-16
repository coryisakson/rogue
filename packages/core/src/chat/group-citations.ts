import { formatPageCite } from '../pagelabels.js';

/** One retrieved passage behind an answer, as the rules chat returns it (best match first). */
export interface CitationSource { page: number | null; printed?: number | null; section?: string | null; title: string; url: string; publisher: string | null; quote: string }

/** One cited document: every known page once, in page order, plus one short quote. */
export interface CitedDocument { title: string; url: string; publisher: string | null; pages: string[]; quote: string }

const knownPage = (p: number | null | undefined): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 1;

/**
 * Group answer sources by document (source url) so a reader sees each rulebook once with all its pages,
 * instead of one card per retrieved chunk. Order of documents follows the first (best-ranked) hit.
 * Page labels are "7" or "7 (printed 5)"; a named section (web sources) is shown by name. Unknown pages are dropped.
 */
export function groupCitations(sources: CitationSource[]): CitedDocument[] {
  const docs = new Map<string, { doc: CitedDocument; pages: Map<string, number> }>();
  for (const s of sources) {
    let entry = docs.get(s.url);
    if (!entry) {
      entry = { doc: { title: s.title, url: s.url, publisher: s.publisher, pages: [], quote: '' }, pages: new Map() };
      docs.set(s.url, entry);
    }
    // The first non-empty quote is the best-ranked one; keep only that (short quotes, rights rule 3).
    if (!entry.doc.quote && s.quote.trim()) entry.doc.quote = s.quote.trim();
    const label = s.section?.trim() || (knownPage(s.page) ? formatPageCite(s.page, s.printed).replace(/^p\./, '') : '');
    if (label && !entry.pages.has(label)) entry.pages.set(label, knownPage(s.page) ? s.page : Number.MAX_SAFE_INTEGER);
  }
  return [...docs.values()].map(({ doc, pages }) => ({
    ...doc,
    pages: [...pages.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([label]) => label),
  }));
}

/** "p. 4" for one page, "pp. 4, 7, 9" for several, "" when no page is known. */
export function pageList(pages: string[]): string {
  if (!pages.length) return '';
  return `${pages.length === 1 ? 'p.' : 'pp.'} ${pages.join(', ')}`;
}
