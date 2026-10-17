import { describe, expect, it } from 'vitest';
import { isChatPath, isCostlyPath, isPublicPath, RateLimiter, safeEqual } from './ratelimit.js';

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
    for (const p of ['/', '/about', '/games', '/games/pandemic', '/games/pandemic/setup', '/games/pandemic/aid','/games/pandemic/facts','/admin/extracts','/healthz', '/_astro/x.js', '/admin', '/admin/backups', '/admin/run', '/admin/claims', '/admin/review', '/admin/requests', '/admin/sources', '/admin/sources/', '/admin/settings', '/admin/faq','/admin/faq-decide', '/admin/quality', '/admin/quality-decide', '/agent/mcp/scout', '/agent/mcp/quality-curator', '/games/pandemic/faq', '/request-game', '/api/ask', '/account/language', '/account/collection', '/account/collection/upload', '/mcp', '/mcp/server-card', '/docs/mcp']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/mcp/', '/mcp/x', '/mcp/../api/games', '/docs', '/docs/other', '/api/games', '/api/search', '/api/rules/search', '/api/admin/ingest', '/admin/other', '/admin/sources/x', '/admin/settings/x', '/admin/sources/../../api', '/agent/mcp', '/agent/mcp/a/b', '/agent/other', '/admin/backups/x', '/api/ai-ping', '/readyz', '/games/pandemic/../../api', '/games/a/b/c', '/api/games/pandemic/claims', '/api/ask/x', '/api/asks']) expect(isPublicPath(p)).toBe(false);
    expect(isCostlyPath('/games/pandemic')).toBe(true);
    expect(isCostlyPath('/')).toBe(false);
    expect(isCostlyPath('/mcp')).toBe(false); // /mcp has its own per-IP buckets in the handler
    expect(isPublicPath('/games/pandemic/ask')).toBe(true);
    expect(isPublicPath('/discord/interactions')).toBe(true);
    for (const p of ['/oauth/register', '/oauth/authorize', '/oauth/token', '/oauth/revoke', '/oauth/apps', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/oauth', '/oauth/', '/oauth/other', '/oauth/token/x', '/oauth/../api/games', '/.well-known/openid-configuration', '/.well-known/oauth-protected-resource/other', '/.well-known/x']) expect(isPublicPath(p)).toBe(false);
    for (const p of ['/discord', '/discord/', '/discord/interactions/', '/discord/interactions/x', '/discord/other', '/discord/interactions/../../api']) expect(isPublicPath(p)).toBe(false);
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/rate')).toBe(true);
    expect(isPublicPath('/rate-answer')).toBe(true);
    expect(isPublicPath('/auth/github')).toBe(true);
    expect(isPublicPath('/auth/github/callback')).toBe(true);
    expect(isPublicPath('/auth/github/callback/../../api')).toBe(false);
    expect(isChatPath('/games/pandemic/ask')).toBe(true);
    expect(isChatPath('/games/pandemic')).toBe(true);
    expect(isChatPath('/games/pandemic/setup')).toBe(false);
  });
});
