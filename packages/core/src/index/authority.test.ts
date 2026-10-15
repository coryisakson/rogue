import { describe, expect, it } from 'vitest';
import { sourceWeight } from './authority.js';
import { rrf } from './chunker.js';
describe('authority', () => {
  it('orders errata > faq > rulebook > product page, publisher > community', () => {
    const w = (k: string, a = 'publisher') => sourceWeight(k, a);
    expect(w('errata')).toBeGreaterThan(w('faq'));
    expect(w('faq')).toBeGreaterThan(w('rulebook'));
    expect(w('rulebook')).toBeGreaterThan(w('other'));
    expect(w('rulebook')).toBeGreaterThan(w('rulebook', 'community'));
    expect(w('rulebook', 'community')).toBeGreaterThan(w('rulebook', 'forum'));
  });
  it('weight breaks a tie in fusion but does not bury a much better match', () => {
    const far = [['a', ...Array.from({ length: 40 }, (_, i) => `x${i}`), 'b']];
    expect(rrf(far, 60, (id) => (id === 'b' ? 1.3 : 1))[0]).toBe('a'); // far behind: stays behind
    expect(rrf([['a', 'b']], 60, (id) => (id === 'b' ? 1.3 : 1))).toEqual(['b', 'a']); // neighbours: authority lifts
    expect(rrf([['a', 'b'], ['b', 'a']], 60, (id) => (id === 'b' ? 1.3 : 1))).toEqual(['b', 'a']); // tie: authority wins
  });
});
