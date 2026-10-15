import { describe, expect, it } from 'vitest';
import { helpfulLabel, isFaqVisible, needsFaqReview, normalizeQuestion, parseFaqAction } from './faq.js';
const f = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
describe('faq', () => {
  it('normalizes questions', () => {
    expect(normalizeQuestion('  What is the HAND limit?? ')).toBe('what is the hand limit');
    expect(normalizeQuestion('Wie viele Karten, bitte?')).toBe('wie viele karten bitte');
  });
  it('labels', () => expect(helpfulLabel(9, 13)).toBe('9 of 13 found this helpful'));
  it('visibility needs votes and share', () => {
    expect(isFaqVisible(2, 2, null)).toBe(false);
    expect(isFaqVisible(9, 13, null)).toBe(true);
    expect(isFaqVisible(3, 6, null)).toBe(false);
    expect(isFaqVisible(13, 13, 'hidden')).toBe(false);
  });
  it('flags low rated only once', () => {
    expect(needsFaqReview(1, 5, null)).toBe(true);
    expect(needsFaqReview(1, 2, null)).toBe(false);
    expect(needsFaqReview(1, 5, 'kept')).toBe(false);
    expect(needsFaqReview(3, 5, null)).toBe(false);
  });
  it('parses admin form', () => {
    expect(parseFaqAction(f({ game: 'pandemic', q: 'x y', action: 'keep' }))).toEqual({ game: 'pandemic', qnorm: 'x y', action: 'keep', reason: '' });
    expect(parseFaqAction(f({ game: 'pandemic', q: 'x', action: 'hide' }))).toHaveProperty('error');
    expect(parseFaqAction(f({ game: 'BAD!', q: 'x', action: 'keep' }))).toHaveProperty('error');
  });
});
