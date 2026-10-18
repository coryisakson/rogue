import { describe, expect, it } from 'vitest';
import { hasExtractedText } from './has-text';

describe('hasExtractedText', () => {
  it('is false for empty and marker-only output', () => {
    expect(hasExtractedText('')).toBe(false);
    expect(hasExtractedText('\n\n=== page 1 ===\n  \n\n=== page 2 ===\n')).toBe(false);
  });
  it('is true when any page has text', () => {
    expect(hasExtractedText('\n\n=== page 1 ===\n\n\n=== page 2 ===\nSetup')).toBe(true);
  });
});
