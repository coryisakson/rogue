import { describe, expect, it } from 'vitest';
import { parseRating, ratingLabel } from './ratings.js';

const f = (o: Record<string, string>) => new URLSearchParams(o);
describe('ratings', () => {
  it('accepts valid ratings', () => { expect(parseRating(f({ claim: '12', stars: '4' }))).toEqual({ claimId: 12, stars: 4 }); });
  it('rejects bad input', () => {
    for (const o of [{ claim: '0', stars: '3' }, { claim: '1', stars: '0' }, { claim: '1', stars: '6' }, { claim: '1.5', stars: '3' }, { claim: 'x', stars: '3' }, { claim: '1' }, {}])
      expect(parseRating(f(o as Record<string, string>))).toBeNull();
  });
  it('formats labels', () => { expect(ratingLabel(4.25, 8)).toBe('4.3 \u2605 (8)'); expect(ratingLabel(null, 0)).toBeNull(); expect(ratingLabel(5, 0)).toBeNull(); });
});
