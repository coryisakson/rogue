/** Pages with fewer meaningful characters than this are treated as scanned (image-only). */
export const MIN_MEANINGFUL_CHARS = 40;

/** Count letters and digits only: whitespace, page numbers' punctuation and stray symbols do not make a page "text". */
export function meaningfulChars(text: string): number {
  const m = text.match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

/**
 * Decide which pages look scanned. Returns 1-based page numbers whose extracted text is too short.
 * Pure on purpose, so it is easy to test and to tune the threshold.
 */
export function needsOcr(pagesText: string[], minChars = MIN_MEANINGFUL_CHARS): number[] {
  const out: number[] = [];
  pagesText.forEach((t, i) => { if (meaningfulChars(t) < minChars) out.push(i + 1); });
  return out;
}
