/**
 * Fit solver v0: choose which cited claims go on a one-page setup sheet.
 *
 * Why: the Librarian publishes ~100 claims per game; a half-letter sheet fits ~45 lines.
 * We estimate each claim's line count from its text length and fill sections in priority
 * order until the line budget is used. Every chosen line keeps its page locator.
 */
export interface SheetClaim { id: string; topic: string; body: string; locator: string | null; player_count?: number | null; created_by?: string; avg_stars?: number | null }
export interface SheetLine { id: string; text: string; page: string | null }
export interface SheetSection { key: string; title: string; lines: SheetLine[]; omitted: number }
export interface Sheet { sections: SheetSection[]; usedLines: number; budget: number }

export const SECTIONS = [
  { key: 'goal', title: 'Goal', topics: ['goal'], share: 0.15 },
  { key: 'setup', title: 'Setup steps', topics: ['setup'], share: 0.5 },
  { key: 'turn', title: 'On a turn', topics: ['turn'], share: 0.25 },
  { key: 'lose', title: 'How you lose', topics: ['lose'], share: 0.1 },
] as const;

/** Rough line count: ~62 characters per line at 8.6pt on 5in, plus a small gap per item. */
export function estimateLines(text: string, charsPerLine = 62): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine)) + 0.15;
}

/** Hand-checked and well-rated claims win; unrated Librarian claims come last. Page order breaks ties. */
function priority(c: SheetClaim): number {
  const trusted = c.created_by && !c.created_by.startsWith('librarian') ? 1 : 0;
  return trusted * 10 + (c.avg_stars ?? 3);
}
const pageNum = (c: SheetClaim) => Number(c.locator?.match(/\d+/)?.[0] ?? 999);

export function buildSheet(claims: SheetClaim[], budget = 44): Sheet {
  const seen = new Set<string>();
  let used = 0;
  const sections = SECTIONS.map((s) => {
    const pool = claims
      .filter((c) => (s.topics as readonly string[]).includes(c.topic))
      .filter((c) => (seen.has(c.body.toLowerCase()) ? false : (seen.add(c.body.toLowerCase()), true)))
      .sort((a, b) => priority(b) - priority(a) || pageNum(a) - pageNum(b));
    const room = budget * s.share;
    const chosen: SheetClaim[] = []; let spent = 0;
    for (const c of pool) {
      const n = estimateLines(c.body);
      if (spent + n > room) continue;
      chosen.push(c); spent += n;
    }
    used += spent;
    chosen.sort((a, b) => pageNum(a) - pageNum(b) || Number(a.id) - Number(b.id)); // rulebook order reads naturally
    return { key: s.key, title: s.title, lines: chosen.map((c) => ({ id: c.id, text: c.body, page: c.locator })), omitted: pool.length - chosen.length };
  });
  return { sections, usedLines: Math.round(used * 10) / 10, budget };
}
