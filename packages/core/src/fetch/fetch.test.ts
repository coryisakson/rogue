import { describe, expect, it } from 'vitest';
import { RightsGatedFetcher, FetchDenied } from './fetcher.js';
import { findOptOut, parseRobots, robotsAllows } from './policy.js';

describe('robots', () => {
  const body = `User-agent: *\nDisallow: /search/\nDisallow: /*?s=\nAllow: /search/public\n\nUser-agent: BadBot\nDisallow: /`;
  const rules = parseRobots(body);
  it('applies wildcard rules, longest match wins', () => {
    expect(robotsAllows(rules, '/game/pandemic/')).toBe(true);
    expect(robotsAllows(rules, '/search/x')).toBe(false);
    expect(robotsAllows(rules, '/search/public')).toBe(true);
    expect(robotsAllows(rules, '/page?s=foo')).toBe(false);
  });
  it('prefers a group naming our agent', () => {
    const r = parseRobots('User-agent: RogueBot\nDisallow: /private\nUser-agent: *\nDisallow: /', 'RogueBot');
    expect(robotsAllows(r, '/ok')).toBe(true);
    expect(robotsAllows(r, '/private/x')).toBe(false);
  });
  it('treats an HTML placeholder as no rules', () => {
    expect(robotsAllows(parseRobots('<html><body>Nothing here</body></html>'), '/anything')).toBe(true);
  });
});

describe('opt-out detection', () => {
  it('finds header and meta opt-outs', () => {
    expect(findOptOut({ 'tdm-reservation': '1' })).toMatch(/TDM/);
    expect(findOptOut({ 'x-robots-tag': 'noai' })).toMatch(/noai/);
    expect(findOptOut({}, '<meta name="robots" content="index, noai">')).toMatch(/meta/);
    expect(findOptOut({}, '<meta name="robots" content="index, follow">')).toBeNull();
  });
});

function fakeFetch(map: Record<string, { status?: number; body: string | Uint8Array; headers?: Record<string, string> }>): typeof fetch {
  return (async (url: string) => {
    const hit = map[url];
    if (!hit) return new Response('nope', { status: 404 });
    const res = new Response(hit.body as BodyInit, { status: hit.status ?? 200, headers: hit.headers });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as unknown as typeof fetch;
}

describe('RightsGatedFetcher', () => {
  const base = { allowedHosts: ['cdn.example.com'], minDelayMs: 0 };
  it('fetches an allowed pdf and hashes it', async () => {
    const f = new RightsGatedFetcher({ ...base, fetchImpl: fakeFetch({
      'https://cdn.example.com/robots.txt': { body: 'User-agent: *\nDisallow: /nope' },
      'https://cdn.example.com/a.pdf': { body: 'PDFDATA', headers: { 'content-type': 'application/pdf', etag: '"x"' } },
    }) });
    const d = await f.fetch('https://cdn.example.com/a.pdf');
    expect(d.sha256).toHaveLength(64);
    expect(d.etag).toBe('"x"');
    expect(d.decision.policyVersion).toMatch(/^eu-/);
  });
  it('denies hosts off the allowlist, http, and robots-blocked paths', async () => {
    const f = new RightsGatedFetcher({ ...base, fetchImpl: fakeFetch({
      'https://cdn.example.com/robots.txt': { body: 'User-agent: *\nDisallow: /nope' },
    }) });
    await expect(f.fetch('https://evil.example.org/a.pdf')).rejects.toBeInstanceOf(FetchDenied);
    await expect(f.fetch('http://cdn.example.com/a.pdf')).rejects.toThrow(/https/);
    await expect(f.fetch('https://cdn.example.com/nope/a.pdf')).rejects.toThrow(/robots/);
  });
  it('blocks when the server reserves TDM rights', async () => {
    const f = new RightsGatedFetcher({ ...base, fetchImpl: fakeFetch({
      'https://cdn.example.com/robots.txt': { body: '' },
      'https://cdn.example.com/a.pdf': { body: 'x', headers: { 'tdm-reservation': '1' } },
    }) });
    await expect(f.fetch('https://cdn.example.com/a.pdf')).rejects.toThrow(/opt-out/);
  });
  it('blocks conservatively when robots.txt gives a server error', async () => {
    const f = new RightsGatedFetcher({ ...base, fetchImpl: fakeFetch({
      'https://cdn.example.com/robots.txt': { status: 503, body: '' },
      'https://cdn.example.com/a.pdf': { body: 'x' },
    }) });
    await expect(f.fetch('https://cdn.example.com/a.pdf')).rejects.toThrow(/robots/);
  });
});
