/**
 * Extract review gate (ADR 0005, run as the Reviewer's `extract_review` skill per ADR 0007). Pure, no I/O.
 *
 * Why: in auto OCR mode code keeps a PDF page's text layer unless it looks garbled, else uses OCR. Code cannot judge every
 * page (tables, sidebars, columns read in the wrong order). For the few pages it is unsure about, an agent compares the text
 * layer and the OCR text and PROPOSES which to keep, or a merge of the two. `acceptPageChoice` decides: a merge may only
 * reuse words and numbers that are already in one of the two candidates, so no content can be invented.
 */
import type { PageQuality } from './index.js';

export type ExtractReason = 'garbled' | 'disagree' | 'table' | 'short';
export interface UnsurePage { page: number; reasons: ExtractReason[] }

/** Below this word overlap the text layer and OCR read clearly different text (one of them is wrong). */
export const DISAGREE_OVERLAP = 0.5;
/** Fewer words than this (but some) is a page worth a look: a caption, a box read in pieces, or a page mostly lost. */
export const SHORT_PAGE_WORDS = 20;

const wordsOf = (t: string): string[] => t.toLowerCase().match(/\p{L}+/gu) ?? [];
// Only standalone numbers count (same rule as the repair gate): "y0ur" is an OCR slip, not a number.
const numbersOf = (t: string): string[] => t.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu) ?? [];

/** Dice overlap of the distinct words (2+ letters) of two texts: 1 = same vocabulary, 0 = nothing shared. */
export function wordOverlap(a: string, b: string): number {
  const sa = new Set(wordsOf(a).filter((w) => w.length >= 2));
  const sb = new Set(wordsOf(b).filter((w) => w.length >= 2));
  if (!sa.size && !sb.size) return 1;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return (2 * common) / (sa.size + sb.size);
}

/** Rows of cells: markdown pipes or columns separated by wide gaps on at least 40% of 4+ lines. */
export function looksLikeTable(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const rows = lines.filter((l) => (l.match(/\|/g)?.length ?? 0) >= 2 || (l.match(/\S(?:\t| {3,})(?=\S)/g)?.length ?? 0) >= 2).length;
  return rows / lines.length >= 0.4;
}

/**
 * Pages an extract review is worth its cost for. Inputs per page number: the quality score of the stored text, the PDF text
 * layer, and OCR text where OCR ran (missing pages simply skip the comparison). Pages without words are skipped (cover art).
 * Most unsure first (more reasons, then lower score).
 */
export function pagesNeedingExtractReview(scores: Map<number, PageQuality>, textLayer: Map<number, string>, ocr: Map<number, string>, limit = 30): UnsurePage[] {
  const pages = new Set<number>([...scores.keys(), ...textLayer.keys(), ...ocr.keys()]);
  const out: (UnsurePage & { score: number })[] = [];
  for (const page of pages) {
    const tl = textLayer.get(page) ?? '';
    const oc = ocr.get(page) ?? '';
    const n = Math.max(wordsOf(tl).length, wordsOf(oc).length);
    if (n < 3) continue;
    const q = scores.get(page);
    const reasons: ExtractReason[] = [];
    if (q && (q.verdict === 'suspect' || q.verdict === 'garbled')) reasons.push('garbled');
    if (wordsOf(tl).length >= 8 && wordsOf(oc).length >= 8 && wordOverlap(tl, oc) < DISAGREE_OVERLAP) reasons.push('disagree');
    if (looksLikeTable(tl) || looksLikeTable(oc)) reasons.push('table');
    if (n < SHORT_PAGE_WORDS) reasons.push('short');
    if (reasons.length) out.push({ page, reasons, score: q?.score ?? 1 });
  }
  return out
    .sort((a, b) => b.reasons.length - a.reasons.length || a.score - b.score || a.page - b.page)
    .slice(0, limit)
    .map(({ page, reasons }) => ({ page, reasons }));
}

// ---- choice gate -------------------------------------------------------------------------------------------------

export const PAGE_CHOICES = ['text_layer', 'ocr', 'merge'] as const;
export type PageChoice = (typeof PAGE_CHOICES)[number];
export interface PageCandidates { textLayer: string; ocr: string | null }
export interface ChoiceProposal { choice: unknown; text?: unknown; reason?: unknown }
export type ChoiceDecision =
  | { accepted: true; choice: PageChoice; text: string; reason: string; provenance: string }
  | { accepted: false; reason: string };

/** A merge may be at most this much shorter or longer than the longer candidate. */
export const MERGE_LENGTH_TOLERANCE = 0.3;

/**
 * Is the agent's page choice safe to apply? text_layer and ocr pick a candidate as it is. A merge must: use only words found
 * in either candidate (case-insensitive), use only numbers found in either candidate (exact), keep every number both
 * candidates agree on, and stay within +/-30% of the longer candidate's length. Provenance is `extractor:<reason>`.
 */
export function acceptPageChoice(c: PageCandidates, p: ChoiceProposal): ChoiceDecision {
  const no = (reason: string): ChoiceDecision => ({ accepted: false, reason });
  const choice = p.choice;
  if (typeof choice !== 'string' || !(PAGE_CHOICES as readonly string[]).includes(choice)) return no('choice must be text_layer, ocr or merge');
  const reason = (typeof p.reason === 'string' ? p.reason : '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (reason.length < 3) return no('give a short reason');
  const ok = (text: string): ChoiceDecision => ({ accepted: true, choice: choice as PageChoice, text, reason, provenance: `extractor:${reason}` });
  if (choice === 'text_layer') return wordsOf(c.textLayer).length ? ok(c.textLayer) : no('the text layer of this page is empty');
  if (c.ocr === null || !wordsOf(c.ocr).length) return no('there is no OCR text for this page');
  if (choice === 'ocr') return ok(c.ocr);

  const merged = typeof p.text === 'string' ? p.text.trim() : '';
  if (!merged) return no('a merge needs the merged text');
  const known = new Set([...wordsOf(c.textLayer), ...wordsOf(c.ocr)]);
  const invented = [...new Set(wordsOf(merged).filter((w) => !known.has(w)))];
  if (invented.length) return no(`words not in either candidate: ${invented.slice(0, 5).join(', ')}`);
  const knownNums = new Set([...numbersOf(c.textLayer), ...numbersOf(c.ocr)]);
  const newNums = [...new Set(numbersOf(merged).filter((x) => !knownNums.has(x)))];
  if (newNums.length) return no(`numbers not in either candidate: ${newNums.slice(0, 5).join(', ')}`);
  const mergedNums = new Set(numbersOf(merged));
  const ocrNums = new Set(numbersOf(c.ocr));
  const dropped = [...new Set(numbersOf(c.textLayer).filter((x) => ocrNums.has(x) && !mergedNums.has(x)))];
  if (dropped.length) return no(`numbers both candidates agree on are missing: ${dropped.slice(0, 5).join(', ')}`);
  const longer = Math.max(c.textLayer.trim().length, c.ocr.trim().length);
  const ratio = merged.length / Math.max(longer, 1);
  if (ratio < 1 - MERGE_LENGTH_TOLERANCE || ratio > 1 + MERGE_LENGTH_TOLERANCE) return no(`merged length is ${ratio.toFixed(2)}x the longer candidate (allowed ${1 - MERGE_LENGTH_TOLERANCE}-${1 + MERGE_LENGTH_TOLERANCE})`);
  return ok(merged);
}
