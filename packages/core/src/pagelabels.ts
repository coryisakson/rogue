/**
 * Printed page numbers. A rulebook PDF often has a cover or front matter, so the page number printed in the footer
 * ("5") differs from the PDF's physical page (7). Players look for the printed number, so citations show both.
 * Pure on purpose: easy to test, no I/O. Physical page numbers stay the stable id everywhere; printed is display-only.
 */

export interface PageLabels {
  /** One entry per physical page (index 0 = page 1): the printed number, or null (cover, front matter, or not detected). */
  labels: (number | null)[];
  /** printed = physical - offset. Null when no consistent offset was found. */
  offset: number | null;
  /** Share of pages with a number candidate that agree on the offset (0 when rejected). */
  confidence: number;
}

/** Header/footer lines longer than this are body text, so a number at their start or end is not a page number. */
const MAX_LABEL_LINE = 40;
/** At least this share of pages with a candidate must agree on one offset. */
const MIN_AGREEMENT = 0.6;

/** Numbers a single header/footer line could be printing as its page number. */
export function lineCandidates(line: string): number[] {
  const t = line.trim();
  if (/^[ivxlcdm]+$/i.test(t)) return []; // roman numerals: front matter, ignored on purpose
  const whole = t.match(/^(?:page\s+|p\.\s*)?(\d{1,4})(?:\s+of\s+\d{1,4})?$/i) ?? t.match(/^[-–—]\s*(\d{1,4})\s*[-–—]$/);
  if (whole) return [Number(whole[1])];
  if (t.length > MAX_LABEL_LINE) return [];
  // A short running header/footer like "12  Setup" or "Rules of Play  13". A number mid-line ("draw 3 cards") never counts.
  const out: number[] = [];
  const start = t.match(/^(\d{1,4})\s+\S/); if (start) out.push(Number(start[1]));
  const end = t.match(/\S\s+(\d{1,4})$/); if (end) out.push(Number(end[1]));
  return out.filter((n) => n >= 1);
}

/** Candidates on one page: only the first 2 and last 2 non-empty lines, where headers and footers live. */
export function pageCandidates(text: string): number[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const idx = new Set([0, 1, lines.length - 2, lines.length - 1].filter((i) => i >= 0 && i < lines.length));
  return [...new Set([...idx].flatMap((i) => lineCandidates(lines[i]!)))];
}

/**
 * Detect printed page numbers. `pages[i]` is the text of physical page i+1.
 * Accepts only a constant offset that most numbered pages agree on; otherwise every label is null (never invent).
 */
export function detectPageLabels(pages: string[]): PageLabels {
  const none: PageLabels = { labels: pages.map(() => null), offset: null, confidence: 0 };
  const votes = new Map<number, number>();
  let withCandidate = 0;
  pages.forEach((text, i) => {
    const offsets = new Set(pageCandidates(text).map((n) => i + 1 - n));
    if (offsets.size) withCandidate++;
    for (const k of offsets) votes.set(k, (votes.get(k) ?? 0) + 1);
  });
  if (!withCandidate) return none;
  const [offset, agree] = [...votes].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]!;
  // At least 3 pages agree (all pages of a 2-page doc); a single number on a 1-page doc is too weak to trust.
  const required = Math.max(2, Math.min(3, pages.length));
  const share = agree / withCandidate;
  if (agree < required || share < MIN_AGREEMENT) return none;
  return { labels: pages.map((_, i) => (i + 1 - offset >= 1 ? i + 1 - offset : null)), offset, confidence: share };
}

/** Citation text for a PDF page: "p.7", or "p.7 (printed 5)" when the book prints a different number. */
export function formatPageCite(page: number, printed: number | null | undefined): string {
  return printed == null || printed === page ? `p.${page}` : `p.${page} (printed ${printed})`;
}
