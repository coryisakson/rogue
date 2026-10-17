/**
 * The BGG top 10, as confirmed by the admin (Cory, "Admin approved!", 2026-10-17). A static input on purpose:
 * Rogue never scrapes BGG pages. Source: https://boardgamegeek.com/browse/boardgame on 2026-10-17 (docs/BGG_TOP10.md).
 * Only id, title and year are kept (BGG notes: no copied descriptions or art).
 */
import { slugify } from '../addgame/index.js';

export interface TopGame { rank: number; bggId: number; title: string; year: number }

export const BGG_TOP10_DATE = '2026-10-17';
export const BGG_TOP10_SOURCE = 'https://boardgamegeek.com/browse/boardgame';
export const BGG_TOP10: readonly TopGame[] = [
  { rank: 1, bggId: 224517, title: 'Brass: Birmingham', year: 2018 },
  { rank: 2, bggId: 342942, title: 'Ark Nova', year: 2021 },
  { rank: 3, bggId: 161936, title: 'Pandemic Legacy: Season 1', year: 2015 },
  { rank: 4, bggId: 174430, title: 'Gloomhaven', year: 2017 },
  { rank: 5, bggId: 397598, title: 'Dune: Imperium - Uprising', year: 2023 },
  { rank: 6, bggId: 316554, title: 'Dune: Imperium', year: 2020 },
  { rank: 7, bggId: 233078, title: 'Twilight Imperium: Fourth Edition', year: 2017 },
  { rank: 8, bggId: 115746, title: 'War of the Ring: Second Edition', year: 2011 },
  { rank: 9, bggId: 167791, title: 'Terraforming Mars', year: 2016 },
  { rank: 10, bggId: 187645, title: 'Star Wars: Rebellion', year: 2016 },
];

/** What Rogue already has: games in the library and open game requests, each by BGG id and slug. */
export interface KnownGames { gameBggIds: Iterable<number>; gameSlugs: Iterable<string>; requestBggIds: Iterable<number>; requestSlugs: Iterable<string> }
export interface PlannedGame extends TopGame { slug: string }
export interface SkippedGame { title: string; reason: 'in library' | 'already requested' }

/**
 * Decide which listed games still need a request, in list order. A game is skipped when it is in the library
 * (by BGG id or slug) or already requested (same check). Running it again after queueing plans nothing, so the
 * admin action is idempotent.
 */
export function planTopGames(list: readonly TopGame[], known: KnownGames): { queue: PlannedGame[]; skipped: SkippedGame[] } {
  const gameIds = new Set(known.gameBggIds), gameSlugs = new Set(known.gameSlugs);
  const reqIds = new Set(known.requestBggIds), reqSlugs = new Set(known.requestSlugs);
  const queue: PlannedGame[] = [], skipped: SkippedGame[] = [];
  for (const g of list) {
    const slug = slugify(g.title);
    if (gameIds.has(g.bggId) || gameSlugs.has(slug)) skipped.push({ title: g.title, reason: 'in library' });
    else if (reqIds.has(g.bggId) || reqSlugs.has(slug)) skipped.push({ title: g.title, reason: 'already requested' });
    else {
      queue.push({ ...g, slug });
      // A duplicate inside the list itself is planned once.
      reqIds.add(g.bggId); reqSlugs.add(slug);
    }
  }
  return { queue, skipped };
}
