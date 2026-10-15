const STOP = new Set('a an the of to in on for and or is are be by with as at it its this that their they must may can player players'.split(' '));
const tokens = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w)));

/** Jaccard similarity of content words, 0..1. */
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0; for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

export interface DupClaim { id: number; topic: string; playerCount: number | null; body: string; createdBy: string }

/**
 * Find claims that say nearly the same thing as an earlier (kept) claim. Same topic and player count only.
 * Hand-written/seed claims are always kept over librarian ones; otherwise the lowest id wins.
 * Returns the ids to drop, each with the id it duplicates.
 */
export function findDuplicates(claims: DupClaim[], threshold = 0.5): { drop: number; keep: number; score: number }[] {
  const rank = (c: DupClaim) => (c.createdBy.startsWith('librarian') ? 1 : 0);
  const sorted = [...claims].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const kept: DupClaim[] = [];
  const out: { drop: number; keep: number; score: number }[] = [];
  for (const c of sorted) {
    let best: { k: DupClaim; s: number } | null = null;
    for (const k of kept) {
      if (k.topic !== c.topic || k.playerCount !== c.playerCount) continue;
      const s = similarity(k.body, c.body);
      if (s >= threshold && (!best || s > best.s)) best = { k, s };
    }
    if (best) out.push({ drop: c.id, keep: best.k.id, score: Math.round(best.s * 100) / 100 });
    else kept.push(c);
  }
  return out;
}
