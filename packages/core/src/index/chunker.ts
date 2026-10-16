/**
 * Split extracted rulebook text (pages marked "=== page N ===") into overlapping, page-cited chunks for retrieval.
 * Chunks never cross pages so every chunk has an exact citation. Language-agnostic: splits on whitespace and sentence-ish breaks only.
 */
import { filterPagesNoise } from './noise.js';

export interface Chunk { page: number; ord: number; text: string }

export function splitPages(text: string): Map<number, string> {
  const parts = text.split(/\n*=== page (\d+) ===\n/);
  const pages = new Map<number, string>();
  for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), (parts[i + 1] ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  return pages;
}

const CAPS_LINE = /^[A-Z][A-Z' -]{2,}$/;

/**
 * Two-column PDFs print neighbouring all-caps headings on consecutive lines ("CONTINGENCY\nPLANNER\nDISPATCHER"), which reads
 * like one name. Split such a run into names: the longest word group that the page later calls "the <Name>" is one heading
 * (so "Contingency Planner" and "Dispatcher" separate). Each heading goes on its own line, marked "## ". Game-agnostic, no name lists.
 */
export function splitJoinedHeadings(body: string): string {
  const lines = body.split('\n');
  const lower = body.toLowerCase();
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j < lines.length && CAPS_LINE.test((lines[j] ?? '').trim())) j++;
    if (j - i < 2) { out.push(lines[i] ?? ''); i++; continue; }
    const words = lines.slice(i, j).join(' ').trim().split(/\s+/);
    for (let k = 0; k < words.length;) {
      let take = 1;
      for (let len = words.length - k; len > 1; len--) {
        if (lower.includes('the ' + words.slice(k, k + len).join(' ').toLowerCase())) { take = len; break; }
      }
      out.push('## ' + words.slice(k, k + take).join(' ')); // marker keeps the model from re-joining neighbours
      k += take;
    }
    i = j;
  }
  return out.join('\n');
}

export function chunkText(text: string, opts: { target?: number; overlap?: number } = {}): Chunk[] {
  const target = opts.target ?? 900;
  const overlap = opts.overlap ?? 150;
  const out: Chunk[] = [];
  let ord = 0;
  // Layout debris (map labels, card icons, repeated headers/footers) is dropped first so chunks hold rules prose.
  for (const [page, clean] of filterPagesNoise(splitPages(text))) {
    const body = splitJoinedHeadings(clean.text);
    if (body.length < 20) continue;
    let start = 0;
    while (start < body.length) {
      let end = Math.min(body.length, start + target);
      if (end < body.length) {
        const window = body.slice(start + Math.floor(target * 0.6), end);
        const brk = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf('; '));
        if (brk > 0) end = start + Math.floor(target * 0.6) + brk + 1;
      }
      const piece = body.slice(start, end).trim();
      if (piece.length >= 20) out.push({ page, ord: ord++, text: piece });
      if (end >= body.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return out;
}

/** Reciprocal rank fusion of ranked id lists (best first). Used to merge keyword and vector results. */
export function rrf(lists: string[][], k = 60, weight: (id: string) => number = () => 1): string[] {
  const score = new Map<string, number>();
  for (const l of lists) l.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  for (const [id, v] of score) score.set(id, v * weight(id));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const STOP = new Set('a an the of to in on for and or is are was be do does did can i you we it that this with as at by from how what when who why which my your me if then than so not no'.split(' '));
/** Conversational question -> OR query over content words (websearch_to_tsquery is AND-only and returns nothing for questions). */
export function orQuery(q: string): string {
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)))];
  return words.map(prefixForm).join(' | ');
}

/** The 'simple' search config does no stemming, so "retaining" would miss "retained". Long English words with a common ending become prefix terms ("retain:*"). */
function prefixForm(w: string): string {
  const m = /^([a-z]{4,})(ing|ed|es|s)$/.exec(w);
  return m && m[1] ? `${m[1]}:*` : w;
}


/** Heading of each "=== page N ===" block (HTML adapter writes the section heading on the first line after the marker). */
export function sectionHeadings(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of text.matchAll(/=== page (\d+) ===\n([^\n]*)/g)) out.set(Number(m[1]), (m[2] ?? "").trim());
  return out;
}
