import { describe, expect, it } from 'vitest';
import { PROVIDERS, buildAuthUrl, exchangeCode, normalizeProfile, safeNext, sameOrigin, sha256hex, randomToken } from './oauth.js';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('oauth', () => {
  it('safeNext blocks open redirects', () => {
    expect(safeNext('/games/pandemic/ask?q=x')).toBe('/games/pandemic/ask?q=x');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/ok\r\nSet-Cookie: x=1', '', null, undefined]) expect(safeNext(bad as string)).toBe('/');
  });
  it('buildAuthUrl carries client, redirect, scope and state', () => {
    const u = new URL(buildAuthUrl(PROVIDERS.github, 'cid', 'https://r.example/auth/github/callback', 'st8'));
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('state')).toBe('st8');
    expect(u.searchParams.get('redirect_uri')).toBe('https://r.example/auth/github/callback');
  });
  it('normalizeProfile handles each provider and rejects junk', () => {
    expect(normalizeProfile('github', { id: 42, login: 'octo', avatar_url: 'https://a/x.png' })).toEqual({ uid: '42', name: 'octo', avatar: 'https://a/x.png' });
    expect(normalizeProfile('google', { sub: 's1', name: 'Gina' })).toEqual({ uid: 's1', name: 'Gina', avatar: null });
    expect(normalizeProfile('discord', { id: '9', username: 'dee', avatar: 'abc' })?.avatar).toContain('/avatars/9/abc.png');
    expect(normalizeProfile('github', {})).toBeNull();
    expect(normalizeProfile('google', { name: 'no sub' })).toBeNull();
  });
  it('exchangeCode runs token then profile call', async () => {
    const seen: string[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (url === PROVIDERS.github.tokenUrl) { expect(String(init?.body)).toContain('code=thecode'); return res(200, { access_token: 'tok' }); }
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
      return res(200, { id: 7, login: 'ann' });
    };
    const p = await exchangeCode(PROVIDERS.github, { id: 'i', secret: 's' }, 'thecode', 'https://r/cb', f);
    expect(p.uid).toBe('7'); expect(seen).toHaveLength(2);
  });
  it('exchangeCode fails closed', async () => {
    await expect(exchangeCode(PROVIDERS.github, { id: 'i', secret: 's' }, 'c', 'u', async () => res(401, {}))).rejects.toThrow(/401/);
    await expect(exchangeCode(PROVIDERS.github, { id: 'i', secret: 's' }, 'c', 'u', async () => res(200, { error: 'bad_verification_code' }))).rejects.toThrow(/access_token/);
  });
  it('sameOrigin and token helpers', () => {
    expect(sameOrigin('https://rogue.example', null, 'rogue.example')).toBe(true);
    expect(sameOrigin('https://evil.com', null, 'rogue.example')).toBe(false);
    expect(sameOrigin(null, null, 'rogue.example')).toBe(false);
    expect(sha256hex('a')).toHaveLength(64);
    expect(randomToken()).not.toBe(randomToken());
  });
});
