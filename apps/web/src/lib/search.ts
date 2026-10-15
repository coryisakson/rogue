import type { SearchHit } from '@rogue/core';
import { ipv4Fetch } from './services';

/**
 * Web search provider (config item). ROGUE_SEARCH_BASE_URL = a SearXNG root (JSON API: /search?format=json).
 * Unset = search is off: intake falls back to free-text requests that an admin researches by hand.
 */
export const searchBaseUrl = (): string | null => {
  const v = (process.env['ROGUE_SEARCH_BASE_URL'] ?? '').trim().replace(/\/+$/, '');
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
