import { describe, expect, it } from 'vitest';
import { isCostlyPath, isPublicPath, RateLimiter, safeEqual } from './ratelimit.js';

describe('security', () => {
  it('rate limits per key and resets after the window', () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4].map(() => rl.allow('a'))).toEqual([true, true, true, false]);
    expect(rl.allow('b')).toBe(true);
    t = 1001;
    expect(rl.allow('a')).toBe(true);
  });
  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('only front-end paths are public', () => {
    for (const p of ['/', '/about', '/games', '/games/pandemic', '/games/pandemic/setup', '/healthz', '/_astro/x.js']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/mcp', '/api/games', '/api/search', '/api/rules/search', '/api/admin/ingest', '/api/ai-ping', '/readyz', '/games/pandemic/../../api', '/games/a/b/c', '/api/games/pandemic/claims']) expect(isPublicPath(p)).toBe(false);
    expect(isCostlyPath('/games/pandemic')).toBe(true);
    expect(isCostlyPath('/')).toBe(false);
  });
});
