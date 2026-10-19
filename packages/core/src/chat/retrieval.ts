/**
 * How widely Ask retrieves for a question. Most questions are answered by one passage; list/count questions
 * ("how many roles", "which characters") need every passage that names an item, and those often sit on the
 * chunks and pages next to the best hit (a roles spread, a components list on the facing page).
 */
export interface RetrievalPlan {
  /** Top-k search hits (after rerank). */
  limit: number;
  /** Also send this many chunks before/after each hit in the same source (0 = hits only). */
  neighbourChunks: number;
  /** Also send chunks on pages this many pages before/after a hit's page in the same source (0 = none). */
  neighbourPages: number;
  /** Most excerpts sent to the model; hits always come first when the cap bites. */
  maxExcerpts: number;
}

export const NORMAL_PLAN: RetrievalPlan = { limit: 5, neighbourChunks: 0, neighbourPages: 0, maxExcerpts: 5 };
export const AGGREGATE_PLAN: RetrievalPlan = { limit: 12, neighbourChunks: 2, neighbourPages: 1, maxExcerpts: 30 };

export function retrievalPlan(aggregate: boolean): RetrievalPlan {
  return aggregate ? AGGREGATE_PLAN : NORMAL_PLAN;
}

/** A chunk found next to a hit: how far it is from its nearest hit, in chunks and in pages (same source). */
export interface NeighbourCandidate<T> {
  sourceId: number;
  ord: number;
  /** Fewest chunks between this chunk and any hit in its source (0 = it is a hit). */
  chunkDistance: number;
  /** Fewest pages between this chunk's page and any hit's page in its source. */
  pageDistance: number;
  item: T;
}

/**
 * Lower is more useful: hits (0), then chunk neighbours by distance, then chunks that are only on a nearby page.
 * Returns null when the chunk is outside both radii.
 */
export function neighbourRank(chunkDistance: number, pageDistance: number, plan: RetrievalPlan): number | null {
  if (chunkDistance <= plan.neighbourChunks) return chunkDistance;
  if (pageDistance <= plan.neighbourPages) return plan.neighbourChunks + 1 + pageDistance;
  return null;
}

/**
 * Pick the excerpts to send: the closest candidates up to the cap (so a hit is never cut for a far neighbour),
 * then back in reading order (source, chunk order) so a list that runs across chunks reads in sequence.
 */
export function pickNeighbours<T>(candidates: NeighbourCandidate<T>[], plan: RetrievalPlan): T[] {
  const ranked = candidates
    .map((c) => ({ c, rank: neighbourRank(c.chunkDistance, c.pageDistance, plan) }))
    .filter((x): x is { c: NeighbourCandidate<T>; rank: number } => x.rank !== null);
  const readingOrder = (a: NeighbourCandidate<T>, b: NeighbourCandidate<T>) => a.sourceId - b.sourceId || a.ord - b.ord;
  const kept = ranked.sort((a, b) => a.rank - b.rank || readingOrder(a.c, b.c)).slice(0, plan.maxExcerpts).map((x) => x.c);
  return kept.sort(readingOrder).map((c) => c.item);
}
