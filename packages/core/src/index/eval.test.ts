import { describe, expect, it } from 'vitest';
import { applyRanking, firstRank, parseRanking, summarize } from './eval.js';

describe('eval helpers', () => {
  it('firstRank finds the first matching snippet', () => {
    expect(firstRank(['a', 'The Hand Limit is 7', 'hand limit'], 'hand limit')).toBe(2);
    expect(firstRank(['a'], 'zzz')).toBeNull();
  });
  it('summarize', () => {
    const s = summarize([{ q: 'a', rank: 1 }, { q: 'b', rank: 4 }, { q: 'c', rank: null }, { q: 'd', rank: 2 }]);
    expect(s.hitAt1).toBe(0.25);
    expect(s.hitAt3).toBe(0.5);
    expect(s.hitAt5).toBe(0.75);
    expect(s.mrr).toBeCloseTo((1 + 0.25 + 0 + 0.5) / 4);
  });
  it('parseRanking tolerates prose, fences, junk and duplicates', () => {
    expect(parseRanking('Here: [3, 1, 3, 9, 2]', 4)).toEqual([3, 1, 2]);
    expect(parseRanking('```json\n[2,1]\n```', 3)).toEqual([2, 1]);
    expect(parseRanking('no idea', 3)).toEqual([]);
  });
  it('applyRanking keeps unmentioned items after picks', () => {
    expect(applyRanking(['a', 'b', 'c', 'd'], [3, 1])).toEqual(['c', 'a', 'b', 'd']);
    expect(applyRanking(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
