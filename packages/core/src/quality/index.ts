/**
 * Text quality gate for indexing (pure, no I/O).
 *
 * Why: OCR of scanned rulebooks produces broken words, stray symbols and split letters. Garbled text retrieved by Ask
 * makes wrong answers, and the Librarian drafts claims from it. This module scores each page with cheap, deterministic
 * signals. The Quality Curator agent (Nanobot) only looks at the pages this gate calls "suspect" and may PROPOSE a
 * repaired text; `acceptRepair` below decides whether the proposal is safe. Agents propose, code decides.
 */

export type PageVerdict = 'ok' | 'suspect' | 'garbled' | 'empty';

export interface PageQuality {
  /** 0 (unreadable) .. 1 (clean prose) */
  score: number;
  verdict: PageVerdict;
  /** Human-readable reasons, e.g. "many one-letter fragments". Empty for clean pages. */
  issues: string[];
}

/** Common function words in the languages Rogue ingests (en/de/fr/es). Clean prose is full of them; OCR noise is not. */
const STOP = new Set((
  'the of to and a in is you it that for on with as are be this at or by from your each can if not an all one when then have will may must ' +
  'der die das und ist nicht mit ein eine zu den von auf für sie er es wenn dann ' +
  'le la les des et est un une pour que dans sur avec pas du au ' +
  'el los las del y es una por con para que se no'
).split(' '));

const VOWEL = /[aeiouyàâäéèêëîïôöùûüáíóúñ]/i;

const words = (t: string): string[] => t.toLowerCase().match(/\p{L}+/gu) ?? [];

/** Score one page of extracted text. Thresholds are tuned for prose; tables and card lists land in "suspect", which is fine (agent review). */
export function scorePage(text: string): PageQuality {
  const clean = text.replace(/\s+/g, ' ').trim();
  const w = words(clean);
  if (w.length < 8 || clean.length < 40) return { score: 0, verdict: 'empty', issues: ['almost no text'] };

  const issues: string[] = [];
  let score = 1;

  // 1. Function-word share. English rules prose sits around 0.30-0.45; word salad is far lower.
  const stopRate = w.filter((x) => STOP.has(x)).length / w.length;
  if (stopRate < 0.12) { score -= 0.35; issues.push('few common words (text may be garbled)'); }
  else if (stopRate < 0.2) { score -= 0.15; issues.push('fewer common words than normal prose'); }

  // 2. One-letter fragments other than "a"/"i" ("w ords", "t he") are the classic OCR split.
  const frag = w.filter((x) => x.length === 1 && x !== 'a' && x !== 'i' && x !== 'y' && x !== 'o').length / w.length;
  if (frag > 0.12) { score -= 0.3; issues.push('many one-letter fragments'); }
  else if (frag > 0.06) { score -= 0.12; issues.push('some one-letter fragments'); }

  // 3. Long tokens without a vowel are not words.
  const longs = w.filter((x) => x.length >= 4);
  const vowelless = longs.length ? longs.filter((x) => !VOWEL.test(x)).length / longs.length : 0;
  if (vowelless > 0.1) { score -= 0.25; issues.push('words without vowels'); }

  // 4. Symbol noise: characters that are not letters, digits, whitespace or ordinary punctuation.
  const total = clean.length;
  const odd = (clean.match(/[^\p{L}\p{N}\s.,;:!?'"()\-–—%/&+=*#\[\]’“”‘…°×]/gu) ?? []).length / total;
  if (odd > 0.06) { score -= 0.3; issues.push('many stray symbols'); }
  else if (odd > 0.025) { score -= 0.12; issues.push('some stray symbols'); }
  if (/\uFFFD/.test(clean)) { score -= 0.2; issues.push('replacement characters (encoding damage)'); }

  // 5. Letters mixed with digits inside one token ("rn0ve", "l0ve") hint at misread glyphs. Ordinary "2nd", "4x" are fine.
  const toks = clean.split(' ');
  const mixed = toks.filter((t) => /\p{L}\d\p{L}|\d\p{L}{2,}\d|\p{L}{2,}\d\p{L}{2,}/u.test(t)).length / toks.length;
  if (mixed > 0.04) { score -= 0.15; issues.push('letters mixed with digits inside words'); }

  // 6. Average word length far outside prose range.
  const avg = w.reduce((n, x) => n + x.length, 0) / w.length;
  if (avg < 2.8 || avg > 9) { score -= 0.15; issues.push('unusual average word length'); }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const verdict: PageVerdict = score >= 0.75 ? 'ok' : score >= 0.4 ? 'suspect' : 'garbled';
  return { score, verdict, issues };
}

/** Retrieval multiplier for a page score. Clean text is untouched; garbled text sinks well below anything readable. */
export function qualityWeight(score: number | null | undefined): number {
  if (score === null || score === undefined) return 1;
  if (score >= 0.75) return 1;
  if (score >= 0.4) return 0.6 + (score - 0.4) * (0.4 / 0.35); // 0.6 .. 1.0
  return 0.2;
}

/** Pages worth an agent's time: suspect ones (garbled pages are listed too, since a repair may rescue them). */
export function pagesNeedingReview(scores: Map<number, PageQuality>, limit = 40): number[] {
  return [...scores.entries()]
    .filter(([, q]) => q.verdict === 'suspect' || q.verdict === 'garbled')
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, limit)
    .map(([p]) => p);
}

// ---- repair gate ------------------------------------------------------------------------------------------------

// Only standalone numbers count: OCR digit-for-letter slips inside words ("y0ur") are exactly what a repair should fix.
const numbersIn = (t: string): string[] => (t.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu) ?? []).sort();

/** Overlap of two texts as a Dice score over letter trigrams with spaces removed, so "th en" vs "then" still matches. */
function similarity(a: string, b: string): number {
  const grams = (t: string) => {
    const flat = t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const m = new Map<string, number>();
    for (let i = 0; i + 3 <= flat.length; i++) { const g = flat.slice(i, i + 3); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const ga = grams(a); const gb = grams(b);
  let common = 0; let na = 0; let nb = 0;
  for (const [g, n] of ga) { na += n; common += Math.min(n, gb.get(g) ?? 0); }
  for (const n of gb.values()) nb += n;
  return na + nb ? (2 * common) / (na + nb) : 0;
}

export interface RepairDecision { accepted: boolean; reason: string; before: number; after: number }

/**
 * Is an agent's repaired page text safe to use? A repair may fix spelling and spacing damage, never rules.
 * Accepted only if: the numbers are the same (a rule's counts must not change), the length is similar, most of the
 * original wording survives, few brand-new words appear, and the page scores better than before.
 */
export function acceptRepair(original: string, repaired: string): RepairDecision {
  const before = scorePage(original).score;
  const after = scorePage(repaired).score;
  const no = (reason: string): RepairDecision => ({ accepted: false, reason, before, after });
  if (repaired.trim().length < 40) return no('repaired text is too short');
  const ratio = repaired.length / Math.max(original.length, 1);
  if (ratio < 0.6 || ratio > 1.4) return no(`length changed too much (${ratio.toFixed(2)}x)`);
  if (numbersIn(original).join('|') !== numbersIn(repaired).join('|')) return no('numbers differ from the original');
  if (after < before + 0.1) return no(`not clearly better (${before} -> ${after})`);
  const a = words(original); const b = words(repaired);
  const kept = similarity(original, repaired);
  // Garbled originals legitimately lose many tokens (broken words); require less overlap the worse the original is.
  const needed = before < 0.4 ? 0.4 : 0.6;
  if (kept < needed) return no(`too little of the original wording kept (${kept.toFixed(2)} < ${needed})`);
  // A word is not new if its letters already sit in the original once spaces are ignored ("th en" -> "then").
  const flat = a.join('');
  const fresh = b.filter((x) => x.length >= 4 && !flat.includes(x)).length / Math.max(b.length, 1);
  const maxFresh = before < 0.4 ? 0.5 : 0.2;
  if (fresh > maxFresh) return no(`too many new words (${(fresh * 100).toFixed(0)}%)`);
  return { accepted: true, reason: 'numbers kept, wording close, quality improved', before, after };
}
