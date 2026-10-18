/**
 * Admin game hub (/admin/games, Cory 2026-10-18: one place per game). Pure helpers: the search box over ingested games,
 * the "recently added/updated" ordering and the per-game history timeline. The SQL lives in apps/web/src/lib/admin-games.ts.
 */

/** A game that is in Rogue with at least one source, plus the dates that count as "something happened". */
export interface IngestedGame {
  slug: string;
  name: string;
  createdAt: Date | null;
  /** Latest fetched_at over the game's sources. */
  lastFetchedAt: Date | null;
  /** Latest decided_at over the game's requests. */
  lastDecidedAt: Date | null;
}

export const GAME_QUERY_MAX = 80;

/** Search box text as the page uses it: single spaces, trimmed, capped. Matching is case-insensitive. */
export function normalizeGameQuery(q: string | null | undefined): string {
  return String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, GAME_QUERY_MAX);
}

/** Does the game's name or slug contain the query (case-insensitive)? A space in the query also matches a dash in the slug. */
export function gameMatches(game: { name: string; slug: string }, q: string): boolean {
  const needle = normalizeGameQuery(q).toLowerCase();
  if (!needle) return false;
  return game.name.toLowerCase().includes(needle) || game.slug.includes(needle) || game.slug.includes(needle.replace(/ /g, '-'));
}

/** Search results: names starting with the query first, then other matches, each group by name. */
export function searchGames<T extends { name: string; slug: string }>(games: T[], q: string, limit = 25): T[] {
  const needle = normalizeGameQuery(q).toLowerCase();
  const starts = (g: T) => (g.name.toLowerCase().startsWith(needle) ? 0 : 1);
  return games.filter((g) => gameMatches(g, needle))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The latest of game created, latest source fetch and latest request decision (null when none is known). */
export function lastActivity(g: Pick<IngestedGame, 'createdAt' | 'lastFetchedAt' | 'lastDecidedAt'>): Date | null {
  const times = [g.createdAt, g.lastFetchedAt, g.lastDecidedAt].filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null;
}

/** The "Recently added/updated" strip: newest activity first, games without any date last, ties by name. */
export function recentGames<T extends IngestedGame>(games: T[], n = 8): T[] {
  const t = (g: T) => lastActivity(g)?.getTime() ?? -Infinity;
  return [...games].sort((a, b) => t(b) - t(a) || a.name.localeCompare(b.name)).slice(0, n);
}

/** One line of a game's history. `key` keeps the order stable when two events share a timestamp. */
export interface TimelineEvent { at: Date | null; kind: string; text: string; key: string }

/** Merge event lists into one newest-first timeline; undated events go last; duplicate keys are kept once. */
export function mergeTimeline(...lists: TimelineEvent[][]): TimelineEvent[] {
  const seen = new Set<string>();
  const all: TimelineEvent[] = [];
  for (const e of lists.flat()) if (!seen.has(e.key)) { seen.add(e.key); all.push(e); }
  const t = (e: TimelineEvent) => (e.at && !Number.isNaN(e.at.getTime()) ? e.at.getTime() : -Infinity);
  return all.sort((a, b) => t(b) - t(a) || b.key.localeCompare(a.key));
}

/** How a source's text was made, from the detail of its latest audit_log 'fetched' entry (same wording as /admin/extracts). */
export function extractNote(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return 'unknown';
  const ocr = Array.isArray(detail['ocrPages']) ? detail['ocrPages'].length : 0;
  return (ocr > 0 ? `OCR, ${ocr} pages` : 'text layer') + ('ocrErrors' in detail ? ' (OCR errors)' : '');
}
