import { bggSearchQueries, parseBggMatches, type BggSearchOutcome, type GameMatch, type SearchHit } from '@rogue/core';
import { ipv4Fetch } from './services';
import { setting } from './settings';

/**
 * Web search provider (/admin/settings, else env). ROGUE_SEARCH_BASE_URL = a SearXNG root (JSON API: /search?format=json).
 * Unset = search is off: intake falls back to free-text requests that an admin researches by hand.
 */
export const searchBaseUrl = (): string | null => {
  const v = (setting('ROGUE_SEARCH_BASE_URL') ?? '').replace(/\/+$/, '');
  return v || null;
};
export const searchEnabled = (): boolean => searchBaseUrl() !== null;

const cache = new Map<string, { at: number; hits: SearchHit[] }>();
const TTL_MS = 6 * 3600_000;

export async function webSearch(query: string, limit = 12): Promise<SearchHit[]> {
  const base = searchBaseUrl();
  if (!base) throw new Error('web search is not configured');
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 300);
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.hits.slice(0, limit);
  const res = await ipv4Fetch(`${base}/search?format=json&q=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`search answered HTTP ${res.status}`);
  const j = (await res.json()) as { results?: { url?: string; title?: string; content?: string }[] };
  const hits = (j.results ?? []).filter((r) => r.url && r.title).map((r) => ({ url: String(r.url), title: String(r.title), content: String(r.content ?? '').slice(0, 300) }));
  if (cache.size > 200) cache.clear();
  cache.set(q, { at: Date.now(), hits });
  return hits.slice(0, limit);
}

/**
 * BGG game pages for a title, trying each phrase of bggSearchQueries until one gives a match. Counts the raw hits so the
 * admin can tell "the provider found pages, none on BGG" from "the provider found nothing". A provider error is reported
 * only when every phrase failed (one flaky engine should not hide matches from the other phrase).
 */
export async function searchGameOutcome(title: string): Promise<BggSearchOutcome> {
  if (!searchEnabled()) return { kind: 'off' };
  let rawHits = 0; let queries = 0; let lastError: string | null = null; let failed = 0;
  for (const q of bggSearchQueries(title)) {
    queries++;
    let hits: SearchHit[];
    try { hits = await webSearch(q, 25); } catch (e) { failed++; lastError = e instanceof Error ? e.message : 'unknown error'; continue; }
    rawHits += hits.length;
    const matches = parseBggMatches(hits);
    if (matches.length) return { kind: 'ok', matches, rawHits, queries };
  }
  if (failed === queries && lastError) return { kind: 'error', message: lastError };
  return { kind: 'ok', matches: [], rawHits, queries };
}

/** The game pick list: BoardGameGeek game pages for a title. Shared by /request-game and the admin title search. */
export async function searchGameMatches(title: string): Promise<GameMatch[]> {
  const o = await searchGameOutcome(title);
  if (o.kind === 'off') throw new Error('web search is not configured');
  if (o.kind === 'error') throw new Error(o.message);
  return o.matches;
}
