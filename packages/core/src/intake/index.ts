/**
 * Game intake, pure parts: turn web search results into a BGG-style pick list, build the admin's
 * manual-search link, and choose a rulebook from search results. No I/O (the web app calls SearXNG).
 */
import { rankCandidates, type DocCandidate } from '../scout/index.js';

export interface SearchHit { url: string; title: string; content?: string }
export interface GameMatch { bggId: number; title: string; year: number | null; url: string }

/** Only the id, title and year of a BGG page are kept (BGG notes: no copied descriptions or art). */
export function parseBggMatches(hits: SearchHit[], limit = 8): GameMatch[] {
  const seen = new Set<number>();
  const out: GameMatch[] = [];
  for (const h of hits) {
    const m = /^https:\/\/boardgamegeek\.com\/boardgame(?:expansion)?\/(\d+)(?:\/([a-z0-9-]*))?\/?$/i.exec(h.url.split(/[?#]/)[0] ?? '');
    if (!m) continue;
    const bggId = Number(m[1]);
    if (!Number.isSafeInteger(bggId) || seen.has(bggId)) continue;
    // "Pandemic | Board Game - BoardGameGeek", "Pandemic: The Cure – Experimental Meds (2016) - BoardGameGeek"
    let title = h.title.replace(/\s*[-–|]\s*BoardGameGeek\s*$/i, '').replace(/\s*\|\s*Board Game\s*$/i, '').replace(/\s*\|\s*Board Game\s*[-–]?\s*$/i, '').trim();
    let year: number | null = null;
    const y = /\s*\((\d{4})\)\s*$/.exec(title);
    if (y) { year = Number(y[1]); title = title.slice(0, y.index).trim(); }
    title = title.replace(/\s+/g, ' ').slice(0, 80);
    if (title.length < 2) continue;
    seen.add(bggId);
    out.push({ bggId, title, year, url: `https://boardgamegeek.com/boardgame/${bggId}` });
    if (out.length >= limit) break;
  }
  return out;
}

/** Validate a pick posted from the form. */
export function parsePick(f: Record<string, unknown>): GameMatch | null {
  const bggId = Number(f['bggId']);
  const title = String(f['title'] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const yearRaw = String(f['year'] ?? '').trim();
  const year = yearRaw ? Number(yearRaw) : null;
  if (!Number.isSafeInteger(bggId) || bggId < 1 || title.length < 2) return null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return null;
  return { bggId, title, year, url: `https://boardgamegeek.com/boardgame/${bggId}` };
}

/** Free-text details for an unlisted game; the admin reads them and searches by hand. */
export function parseDetails(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = String(raw ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200);
  if (text.length < 10) return { ok: false, error: 'Tell us as much as you can: title, publisher, year, edition, language, where you saw it.' };
  return { ok: true, text };
}

/** Google link the admin clicks when automatic search is off or found nothing. */
export function googleLink(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.replace(/\s+/g, ' ').trim().slice(0, 300))}`;
}
export const adminSearchQuery = (details: string): string => `${details.split('\n').join(' ').slice(0, 200)} board game official rulebook pdf`;

/** Search phrases the Scout runs for a confirmed game. */
export function scoutQueries(name: string, year: number | null): string[] {
  const y = year ? ` ${year}` : '';
  // Publisher first: who makes the game, then their rules/downloads, then a direct rulebook PDF search.
  return [`${name}${y} board game publisher official website`, `${name} board game official rules download`, `${name}${y} board game official rulebook pdf`];
}

// Sites that copy, resell or discuss rulebooks. Never a source for Rogue (publisher/rights holder only).
const AGGREGATORS = /(^|\.)(boardgamegeek\.com|scribd\.com|youtube\.com|youtu\.be|reddit\.com|amazon\.[a-z.]+|ebay\.[a-z.]+|wikipedia\.org|fandom\.com|pinterest\.[a-z.]+|facebook\.com|tesera\.ru|officialgamerules\.org|dicebreaker\.com|polygon\.com|pdfcoffee\.com|vdocuments\.[a-z.]+|studylib\.net|yumpu\.com|issuu\.com|docplayer\.[a-z]+|manualslib\.com|tabletopgaming\.[a-z.]+|geeknative\.com)$/i;
export const isAggregator = (host: string): boolean => AGGREGATORS.test(host);

export interface ScoutPick { rulebook: DocCandidate | null; pagesToScan: string[] }

/**
 * From raw search hits: choose a rulebook PDF if a non-aggregator hit already is one; otherwise name up to 3 publisher
 * pages worth scanning for links. The human still approves the host and reads the terms.
 */
export function pickFromSearch(hits: SearchHit[], gameName: string): ScoutPick {
  const direct = hits.filter((h) => { try { const u = new URL(h.url); return u.protocol === 'https:' && !isAggregator(u.hostname) && /\.pdf$/i.test(u.pathname); } catch { return false; } })
    .map((h) => ({ url: h.url, text: h.title }));
  const ranked = rankCandidates(direct, gameName).filter((c) => c.role === 'rulebook');
  const words = gameName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const named = ranked.find((c) => words.length === 0 || words.some((w) => `${c.text} ${c.url}`.toLowerCase().includes(w)));
  const pages: string[] = [];
  for (const h of hits) {
    try {
      const u = new URL(h.url);
      if (u.protocol !== 'https:' || isAggregator(u.hostname) || /\.pdf$/i.test(u.pathname)) continue;
      if (pages.length < 3 && !pages.includes(h.url)) pages.push(h.url);
    } catch { /* skip */ }
  }
  return { rulebook: named ?? null, pagesToScan: pages };
}

// Shops, crowdfunding, museums and media: they mention the game but are not where the rulebook lives.
const NOT_PUBLISHER = /(^|\.)(store\.[a-z0-9.-]+|gamefound\.com|kickstarter\.com|myshopify\.com|shopify\.com|gamers-hq\.de|miniature-market\.com|coolstuffinc\.com|noblenet\.com|target\.com|walmart\.com|barnesandnoble\.com|gamestop\.com|vam\.ac\.uk|nerdlab-games\.com|bgg\.cc|geekdo\.com|boardgameatlas\.com|tabletopia\.com|steampowered\.com|store\.steampowered\.com)$/i;

/**
 * Publisher-first: from search results choose the pages most likely to be the publisher's own page for the game.
 * Score = game words in title/path (strong), home page of the host (weak), same host seen in several results.
 * Aggregators, shops and crowdfunding pages are skipped. The Scout reads these pages for rulebook links.
 */
export function rankPublisherPages(hits: SearchHit[], gameName: string, limit = 5): string[] {
  const words = gameName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const hostCount = new Map<string, number>();
  for (const h of hits) { try { const k = new URL(h.url).hostname.replace(/^www\./, ''); hostCount.set(k, (hostCount.get(k) ?? 0) + 1); } catch { /* skip */ } }
  const scored: { url: string; score: number; order: number }[] = [];
  hits.forEach((h, order) => {
    try {
      const u = new URL(h.url);
      if (u.protocol !== 'https:' || /\.pdf$/i.test(u.pathname) || isAggregator(u.hostname) || NOT_PUBLISHER.test(u.hostname)) return;
      const hay = `${h.title} ${u.pathname}`.toLowerCase();
      const matched = words.filter((w) => hay.includes(w)).length;
      let score = words.length ? (matched / words.length) * 10 : 5;
      if (/\/(game|games|product|products)\//.test(u.pathname)) score += 2;
      if (u.pathname === '/' || u.pathname === '') score += 1;
      score += Math.min(2, (hostCount.get(u.hostname.replace(/^www\./, '')) ?? 1) - 1);
      scored.push({ url: h.url, score, order });
    } catch { /* skip */ }
  });
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).filter((x) => !seen.has(x.url) && !!seen.add(x.url)).slice(0, limit).map((x) => x.url);
}
