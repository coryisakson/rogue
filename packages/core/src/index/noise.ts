/**
 * Layout-noise filter for extracted page text. Rulebook PDFs (Pandemic especially) mix map city labels, card art text,
 * page furniture and stray symbols into the rules prose, which pollutes chunks and retrieval. This drops that debris
 * before chunking. Conservative on purpose: a line that looks like a sentence is never dropped, and a short heading is
 * kept when prose follows it. Pure, no I/O; returns what it dropped so the result can be audited. Game-agnostic, no name lists.
 */

export interface NoiseResult {
  /** The page text with noise lines removed (blank lines kept so paragraphs stay apart). */
  text: string;
  /** The removed lines, trimmed, in page order. */
  droppedLines: string[];
}

/** A label line (city name, card title) has at most this many words; "Ho Chi Minh City" is four. */
const MAX_LABEL_WORDS = 4;
/** A run of label lines this long or shorter, followed by prose, is kept as a heading (two-column PDFs split headings over lines). */
const MAX_HEADING_RUN = 4;
/** Below this share of letters among non-space characters a line is symbols/numbers, not text. */
const MIN_LETTER_SHARE = 0.5;
/** A line on at least this share of pages (in the header/footer zone) is page furniture. */
const REPEATED_SHARE = 0.5;
/** Repeated-line detection needs this many pages; with fewer, "every page" means nothing. */
const MIN_PAGES_FOR_REPEATS = 3;
/** Headers and footers live in the first and last lines of a page (same idea as pagelabels.ts). */
const EDGE_LINES = 2;

const LETTER = /\p{L}/gu;
const CAPITALISED_WORD = /^\p{Lu}[\p{L}'’-]*$/u;
const SENTENCE_END = /[.!?:;,)]$/;

/** True for anything that reads like prose: ends like a sentence, or has 3+ words with a lowercase one. Never dropped. */
export function looksLikeSentence(line: string): boolean {
  const t = line.trim();
  if (!(t.match(LETTER)?.length)) return false;
  if (SENTENCE_END.test(t)) return true;
  const words = t.split(/\s+/);
  return words.length >= 3 && words.some((w) => /^\p{Ll}/u.test(w));
}

/** Mostly digits, symbols or icons ("2–4", "★ ★", "+1", "• •"). Empty lines are not noise. */
export function isSymbolLine(line: string): boolean {
  const chars = line.replace(/\s+/g, '');
  if (!chars) return false;
  const letters = chars.match(LETTER)?.length ?? 0;
  return letters / [...chars].length < MIN_LETTER_SHARE;
}

/** A few Capitalised or ALLCAPS words with no punctuation: a map label, card title, or a heading. */
export function isLabelLine(line: string): boolean {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= MAX_LABEL_WORDS && words.every((w) => CAPITALISED_WORD.test(w));
}

/** Header/footer comparisons ignore numbers, so "Rules 4" and "Rules 5" count as the same footer. */
function edgeKey(line: string): string {
  return line.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').toLowerCase();
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Header/footer lines repeated on at least half the pages. Only the first and last two lines of each page vote,
 * so a phrase that recurs in the body is never mistaken for furniture. Returns normalised keys (see edgeKey).
 */
export function repeatedEdgeLines(pages: string[]): Set<string> {
  const out = new Set<string>();
  if (pages.length < MIN_PAGES_FOR_REPEATS) return out;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = nonEmptyLines(page);
    const edges = new Set([...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)].map(edgeKey));
    for (const k of edges) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) if (n >= Math.max(2, pages.length * REPEATED_SHARE)) out.add(k);
  return out;
}

/**
 * Remove noise lines from one page. `repeated` comes from repeatedEdgeLines over the whole document.
 * Order of checks: sentences always stay; then page furniture, symbol lines, and label runs not followed by prose go.
 */
export function filterNoise(text: string, repeated: Set<string> = new Set()): NoiseResult {
  const lines = text.split(/\r?\n/);
  const nonEmpty = nonEmptyLines(text);
  const edgeZone = new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)]);
  const drop = new Array<boolean>(lines.length).fill(false);

  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || looksLikeSentence(t)) return;
    if (edgeZone.has(t) && repeated.has(edgeKey(t))) drop[i] = true;
    else if (isSymbolLine(t)) drop[i] = true;
  });

  // Label lines come in runs (a heading split over lines, or a column of city names). A short run directly
  // followed by prose is a heading and stays; a long run, or one followed by more debris or the page end, goes.
  for (let i = 0; i < lines.length;) {
    if (drop[i] || !isLabelLine(lines[i] ?? '')) { i++; continue; }
    const run: number[] = [];
    let j = i;
    for (; j < lines.length; j++) {
      const t = (lines[j] ?? '').trim();
      if (!t) continue; // blank lines inside a run do not end it
      if (drop[j]) continue; // already-dropped debris between labels does not end it either
      if (!isLabelLine(t)) break;
      run.push(j);
    }
    const next = j < lines.length ? (lines[j] ?? '').trim() : '';
    const isHeading = run.length <= MAX_HEADING_RUN && looksLikeSentence(next);
    if (!isHeading) for (const k of run) drop[k] = true;
    i = j;
  }

  const droppedLines = lines.flatMap((l, i) => (drop[i] ? [l.trim()] : []));
  const text2 = lines.filter((_, i) => !drop[i]).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: text2, droppedLines };
}

/** Filter every page of a document: detects repeated headers/footers across pages, then cleans each page. */
export function filterPagesNoise(pages: Map<number, string>): Map<number, NoiseResult> {
  const repeated = repeatedEdgeLines([...pages.values()]);
  return new Map([...pages].map(([n, body]) => [n, filterNoise(body, repeated)]));
}
