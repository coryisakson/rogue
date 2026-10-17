/**
 * BGG XML API2 client, server side only (docs/BGG_NOTES.md). Uses Rogue's single registered-app token from env
 * ROGUE_BGG_TOKEN (RGE-A16; never logged, never sent to the browser). Without a token the API path is off and users
 * upload their own CSV export instead. Our own fetches are rate-limited so we stay well inside BGG's unpublished limits.
 */
import { RateLimiter, bggCollectionUrl, interpretBggCollection, type BggApiResult } from '@rogue/core';
import { ipv4Fetch } from './services';
import { setting } from './settings';

/** Is the BGG API path available on this instance? */
export const bggTokenConfigured = (): boolean => Boolean(setting('ROGUE_BGG_TOKEN'));

// At most 10 BGG requests a minute for the whole instance, and 3 imports per user per 10 minutes.
const globalLimit = new RateLimiter(10, 60_000);
const userLimit = new RateLimiter(3, 10 * 60_000);

export type BggFetchResult = BggApiResult | { kind: 'no-token' } | { kind: 'rate-limited' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches a user's owned board games. BGG answers 202 while it prepares a collection; we retry a few times with a
 * growing pause (about 12 s in total) and then return 'queued' so the user can try again shortly.
 */
export async function fetchBggCollection(username: string, userId: number): Promise<BggFetchResult> {
  const token = setting('ROGUE_BGG_TOKEN');
  if (!token) return { kind: 'no-token' };
  if (!userLimit.allow(String(userId))) return { kind: 'rate-limited' };
  const waits = [2000, 4000, 6000];
  for (let attempt = 0; ; attempt++) {
    if (!globalLimit.allow('bgg')) return { kind: 'rate-limited' };
    let result: BggApiResult;
    try {
      const res = await ipv4Fetch(bggCollectionUrl(username), {
        headers: { authorization: `Bearer ${token}`, accept: 'application/xml', 'user-agent': 'Rogue (rules knowledge base)' },
        signal: AbortSignal.timeout(20_000),
      });
      result = interpretBggCollection(res.status, await res.text());
    } catch {
      result = { kind: 'error', status: 0 };
    }
    const wait = waits[attempt];
    if (result.kind !== 'queued' || wait === undefined) return result;
    await sleep(wait);
  }
}
