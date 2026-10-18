/** True when an extraction has real text once the "=== page N ===" markers and whitespace are removed. */
export function hasExtractedText(text: string): boolean {
  return text.replace(/=== page \d+ ===/g, '').trim().length > 0;
}
