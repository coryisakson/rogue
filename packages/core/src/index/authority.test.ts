import { describe, expect, it } from 'vitest';
import { sourceWeight } from './authority.js';
import { rrf } from './chunker.js';
describe('authority', () => {
  it('orders rulebook > errata > faq > everything else, publisher > community', () => {
    const w = (k: string, a = 'publisher') => sourceWeight(k, a);
    expect(w('rulebook')).toBeGreaterThan(w('errata'));
    expect(w('errata')).toBeGreaterThan(w('faq'));
    expect(w('faq')).toBeGreaterThan(w('quickstart'));
    expect(w('faq')).toBeGreaterThan(w('article'));
    expect(w('faq')).toBeGreaterThan(w('forum_post', 'forum'));
    expect(w('faq')).toBeGreaterThan(w('other'));
    expect(w('rulebook')).toBeGreaterThan(w('rulebook', 'community'));
    expect(w('rulebook', 'community')).toBeGreaterThan(w('rulebook', 'forum'));
  });
  it('a community wiki page ranks below publisher text and above a forum post', () => {
    expect(sourceWeight('wiki', 'community')).toBeLessThan(sourceWeight('other', 'publisher'));
    expect(sourceWeight('wiki', 'community')).toBeLessThan(sourceWeight('rulebook', 'publisher'));
    expect(sourceWeight('wiki', 'community')).toBeGreaterThan(sourceWeight('forum_post', 'forum'));
  });
  it('a publisher wiki (admin attestation) ranks above a community wiki, still below the publisher rulebook PDF', () => {
    expect(sourceWeight('wiki', 'publisher')).toBeGreaterThan(sourceWeight('wiki', 'community'));
    expect(sourceWeight('rulebook', 'publisher')).toBeGreaterThan(sourceWeight('wiki', 'publisher'));
    expect(sourceWeight('wiki', 'publisher')).toBeGreaterThan(sourceWeight('forum_post', 'forum'));
  });
  it('a manual capture ranks below the same source fetched by Rogue, even as publisher', () => {
    expect(sourceWeight('rulebook', 'publisher', 'manual_capture')).toBeLessThan(sourceWeight('rulebook', 'publisher'));
    expect(sourceWeight('rulebook', 'community', 'manual_capture')).toBeLessThan(sourceWeight('rulebook', 'community'));
    expect(sourceWeight('rulebook', 'publisher', null)).toBe(sourceWeight('rulebook', 'publisher'));
  });
  it('weight breaks a tie in fusion but does not bury a much better match', () => {
    const far = [['a', ...Array.from({ length: 40 }, (_, i) => `x${i}`), 'b']];
    expect(rrf(far, 60, (id) => (id === 'b' ? 1.3 : 1))[0]).toBe('a'); // far behind: stays behind
    expect(rrf([['a', 'b']], 60, (id) => (id === 'b' ? 1.3 : 1))).toEqual(['b', 'a']); // neighbours: authority lifts
    expect(rrf([['a', 'b'], ['b', 'a']], 60, (id) => (id === 'b' ? 1.3 : 1))).toEqual(['b', 'a']); // tie: authority wins
  });
});
