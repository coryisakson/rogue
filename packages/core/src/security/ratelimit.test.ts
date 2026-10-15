import { describe, expect, it } from 'vitest';
import { isAdminPath, isCostlyPath, RateLimiter, safeEqual } from './ratelimit.js';

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
  it('classifies paths', () => {
    expect(isAdminPath('/api/admin/ingest')).toBe(true);
    expect(isAdminPath('/api/ai-ping')).toBe(true);
    expect(isAdminPath('/api/games')).toBe(false);
    expect(isCostlyPath('/mcp')).toBe(true);
    expect(isCostlyPath('/api/rules/search')).toBe(true);
    expect(isCostlyPath('/games/pandemic')).toBe(false);
  });
});
