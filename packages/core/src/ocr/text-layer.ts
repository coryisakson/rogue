import { MIN_MEANINGFUL_CHARS, meaningfulChars } from './needs-ocr.js';

/**
 * Per-page "best of" choice between a PDF's own text layer and OCR.
 * A clean text layer is exact (no recognition errors), so we keep it; only empty or garbled pages go to OCR.
 * Everything here is pure and language-agnostic (en/de/es/it/zh tested), so it is easy to test and tune.
 */

/** Pages scoring below this are treated as garbled and sent to OCR. */
export const MIN_TEXT_LAYER_SCORE = 0.5;

export interface TextLayerQuality {
  /** 0 (unusable) .. 1 (clean). */
  score: number;
  /** Letters and digits on the page (see meaningfulChars). */
  chars: number;
  /** Which checks failed, e.g. ['spaced-out']; empty for a clean page. */
  reasons: string[];
}

// Scripts written without spaces between words: short "tokens" there are normal, not broken spacing.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_ALL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
// Replacement char, private-use glyphs (unmapped fonts) and control chars other than ordinary whitespace.
const BAD = /[�\p{Co}\p{Cc}]/gu;
const LATIN_VOWEL = /[aeiouyäöüàáâèéêëìíîïòóôùúûœæ]/i;

/** Clamp to 0..1 after mapping `value` linearly from [from -> 0] to [to -> 1]. */
function ramp(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/** A token that looks like a real word: 2+ letters, only letters plus inner ' - ·, sensible casing, a vowel if long Latin. */
function isWordLike(letters: string): boolean {
  if (letters.length < 2) return false;
  if (!/^\p{L}+(?:['’\-·]\p{L}+)*$/u.test(letters)) return false;
  // "tHeGaMe": more than two case switches inside one token is a decoding artefact, not a word.
  const switches = letters.match(/\p{Ll}\p{Lu}|\p{Lu}\p{Ll}/gu)?.length ?? 0;
  if (switches > 2) return false;
  if (letters.length >= 4 && /^\p{Script=Latin}+$/u.test(letters.replace(/['’\-·]/g, '')) && !LATIN_VOWEL.test(letters)) {
    // Allow all-caps abbreviations (e.g. "HTML", "XP") but not lower-case vowel-less runs.
    return letters === letters.toUpperCase();
  }
  return true;
}

/** Score one page's text layer. Each check gives a penalty 0..1; the score is 1 minus the worst penalty. */
export function textLayerQuality(text: string, minChars = MIN_MEANINGFUL_CHARS): TextLayerQuality {
  const chars = meaningfulChars(text);
  if (chars < minChars) return { score: 0, chars, reasons: ['empty'] };

  const visible = text.replace(/[\s]/gu, '');
  const bad = (visible.match(BAD)?.length ?? 0) / visible.length;
  const letterShare = chars / visible.length;
  const cjkShare = (text.match(CJK_ALL)?.length ?? 0) / chars;

  const penalties: Record<string, number> = {
    // 10%+ replacement/private-use glyphs means the font had no usable Unicode map.
    'bad-glyphs': ramp(bad, 0.02, 0.1),
    // Rules text is mostly letters; a page of symbols is mojibake from a broken encoding.
    'symbols': ramp(-letterShare, -0.7, -0.35),
  };

  // Word checks only make sense for space-separated scripts. Ignore CJK tokens; skip entirely on mostly-CJK pages.
  if (cjkShare < 0.3) {
    const tokens = text.split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter((t) => t && !CJK.test(t));
    if (tokens.length >= 5) {
      const single = tokens.filter((t) => [...t].length === 1).length / tokens.length;
      const words = tokens.filter(isWordLike).length / tokens.length;
      // "T h e  g a m e": most tokens are single letters. Normal prose has a few ("a", "I", "y", "e").
      penalties['spaced-out'] = ramp(single, 0.3, 0.6);
      penalties['few-words'] = ramp(-words, -0.6, -0.25);
    }
  }

  const worst = Math.max(...Object.values(penalties));
  const reasons = Object.entries(penalties).filter(([, p]) => p >= 0.5).map(([k]) => k);
  return { score: Math.round((1 - worst) * 100) / 100, chars, reasons };
}

/** `auto`: OCR empty/garbled pages only. `all`: OCR every page (ForceOCR). `off`: never OCR. */
export type OcrMode = 'auto' | 'all' | 'off';

/** ROGUE_OCR_MODE wins; the older ROGUE_OCR_ALL_PAGES=1 still means `all`; default `auto`. */
export function ocrModeFromEnv(env: Record<string, string | undefined>): OcrMode {
  const mode = env.ROGUE_OCR_MODE?.trim().toLowerCase();
  if (mode === 'auto' || mode === 'all' || mode === 'off') return mode;
  return env.ROGUE_OCR_ALL_PAGES?.trim() === '1' ? 'all' : 'auto';
}

export interface PageDecision {
  /** 1-based. */
  page: number;
  score: number;
  chars: number;
  reasons: string[];
  /** What we plan to use; the adapter falls back to 'text' if OCR returns nothing. */
  source: 'text' | 'ocr';
}

export interface PickOptions {
  mode?: OcrMode;
  minChars?: number;
  minScore?: number;
}

/** Decide per page whether to keep the text layer or OCR it. Returns 1-based OCR page numbers plus every decision. */
export function pickPagesForOcr(pages: string[], opts: PickOptions = {}): { ocrPages: number[]; decisions: PageDecision[] } {
  const { mode = 'auto', minChars = MIN_MEANINGFUL_CHARS, minScore = MIN_TEXT_LAYER_SCORE } = opts;
  const decisions = pages.map((text, i): PageDecision => {
    const q = textLayerQuality(text, minChars);
    const ocr = mode === 'all' || (mode === 'auto' && q.score < minScore);
    return { page: i + 1, ...q, source: ocr ? 'ocr' : 'text' };
  });
  return { ocrPages: decisions.filter((d) => d.source === 'ocr').map((d) => d.page), decisions };
}
