import { describe, expect, it } from 'vitest';
import { AGGREGATE_PLAN, NORMAL_PLAN, neighbourRank, pickNeighbours, retrievalPlan, type NeighbourCandidate } from './retrieval.js';

const cand = (ord: number, chunkDistance: number, pageDistance: number, sourceId = 1): NeighbourCandidate<string> =>
  ({ sourceId, ord, chunkDistance, pageDistance, item: `${sourceId}:${ord}` });

describe('retrievalPlan', () => {
  it('list/count questions retrieve deeper and wider than normal ones', () => {
    expect(retrievalPlan(false)).toEqual(NORMAL_PLAN);
    expect(retrievalPlan(true)).toEqual(AGGREGATE_PLAN);
    expect(AGGREGATE_PLAN.limit).toBeGreaterThan(NORMAL_PLAN.limit);
    expect(AGGREGATE_PLAN.neighbourChunks).toBeGreaterThan(0);
    expect(AGGREGATE_PLAN.neighbourPages).toBeGreaterThan(0);
    expect(AGGREGATE_PLAN.maxExcerpts).toBeGreaterThanOrEqual(AGGREGATE_PLAN.limit);
    expect(NORMAL_PLAN).toMatchObject({ neighbourChunks: 0, neighbourPages: 0 });
  });
});

describe('neighbourRank', () => {
  const plan = { limit: 12, neighbourChunks: 2, neighbourPages: 1, maxExcerpts: 30 };
  it('ranks hits, then chunk neighbours, then page neighbours', () => {
    expect(neighbourRank(0, 0, plan)).toBe(0);
    expect(neighbourRank(2, 0, plan)).toBe(2);
    expect(neighbourRank(5, 0, plan)).toBe(3); // same page, beyond the chunk radius
    expect(neighbourRank(9, 1, plan)).toBe(4); // facing page
    expect(neighbourRank(9, 2, plan)).toBeNull();
  });
  it('the normal plan keeps only the hits', () => {
    expect(neighbourRank(0, 0, NORMAL_PLAN)).toBe(0);
    expect(neighbourRank(1, 1, NORMAL_PLAN)).toBeNull();
  });
});

describe('pickNeighbours', () => {
  it('returns kept chunks in reading order and drops far ones', () => {
    const plan = { ...AGGREGATE_PLAN, maxExcerpts: 10 };
    expect(pickNeighbours([cand(5, 0, 0), cand(2, 1, 0, 2), cand(4, 1, 0), cand(9, 4, 3)], plan)).toEqual(['1:4', '1:5', '2:2']);
  });
  it('never drops a hit for a neighbour when the cap bites', () => {
    const plan = { ...AGGREGATE_PLAN, maxExcerpts: 3 };
    // Source 1 has many early neighbours; the hit in source 9 must still be sent.
    const many = [cand(1, 2, 0), cand(2, 1, 0), cand(3, 0, 0), cand(4, 1, 0), cand(5, 2, 0), cand(40, 0, 0, 9)];
    expect(pickNeighbours(many, plan)).toEqual(['1:2', '1:3', '9:40']);
  });
});
