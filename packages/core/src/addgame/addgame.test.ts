import { describe, expect, it } from 'vitest';
import { assessRights, hostProblem, isPrivateAddress, parseGameRequest, slugify, tdmReserved, type ProbeFacts } from './index.js';

const base = { name: 'Azul', publisher: 'Plan B Games', rulebookUrl: 'https://cdn.example.com/azul.pdf' };
const facts = (o: Partial<ProbeFacts> = {}): ProbeFacts => ({ robots: 'allowed', tdmReserved: false, optOut: null, status: 200, contentType: 'application/pdf', contentLength: 1000, redirectHost: null, resolvedPrivate: false, ...o });

describe('slugify', () => {
  it('makes url-safe ids', () => {
    expect(slugify('Slay the Spire: The Board Game')).toBe('slay-the-spire-the-board-game');
    expect(slugify('Catan & Cities')).toBe('catan-and-cities');
    expect(slugify('Café Müller!')).toBe('cafe-muller');
    expect(slugify('???')).toBe('');
  });
});

describe('isPrivateAddress', () => {
  it('flags private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('hostProblem', () => {
  it('accepts normal https hosts and refuses the rest', () => {
    expect(hostProblem(new URL('https://www.zmangames.com/x.pdf'))).toBeNull();
    for (const u of ['http://example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://nas.local/x', 'https://example.com:8443/x', 'https://u:p@example.com/x', 'https://intranet/x', 'https://[::1]/x']) expect(hostProblem(new URL(u)), u).not.toBeNull();
  });
});

describe('parseGameRequest', () => {
  it('parses a good request and tidies it', () => {
    const r = parseGameRequest({ ...base, name: '  Azul  ', year: '2017', language: 'EN', foundOn: 'https://planbgames.com/azul#rules' });
    expect(r).toEqual({ ok: true, value: { name: 'Azul', publisher: 'Plan B Games', year: 2017, language: 'en', rulebookUrl: base.rulebookUrl, foundOn: 'https://planbgames.com/azul' } });
  });
  it('rejects bad input with a readable message', () => {
    for (const bad of [{ name: 'A' }, { publisher: '' }, { year: '17' }, { year: 'abc' }, { language: 'english' }, { rulebookUrl: '' }, { rulebookUrl: 'not a url' }, { rulebookUrl: 'http://x.com/a.pdf' }, { rulebookUrl: 'https://10.0.0.1/a.pdf' }, { foundOn: 'ftp://x.com' }]) {
      const r = parseGameRequest({ ...base, ...bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });
});

describe('tdmReserved', () => {
  it('reads tdmrep.json rules', () => {
    expect(tdmReserved([{ location: '/*', 'tdm-reservation': 1 }], '/a.pdf')).toBe(true);
    expect(tdmReserved([{ location: '/private/*', 'tdm-reservation': 1 }], '/private/a.pdf')).toBe(true);
    expect(tdmReserved([{ location: '/private/*', 'tdm-reservation': 1 }], '/public/a.pdf')).toBe(false);
    expect(tdmReserved([{ location: '/*', 'tdm-reservation': 0 }], '/a.pdf')).toBe(false);
    expect(tdmReserved({ nope: true }, '/a')).toBe(false);
    expect(tdmReserved(null, '/a')).toBe(false);
  });
});

describe('assessRights', () => {
  it('passes clean results but always leaves the terms check to a human', () => {
    const r = assessRights(facts(), 'cdn.example.com');
    expect(r.verdict).toBe('pass');
    expect(r.findings.some((f) => f.level === 'warn' && /Terms of use/.test(f.text))).toBe(true);
  });
  it('blocks on robots, TDM, opt-out and private addresses', () => {
    for (const o of [{ robots: 'blocked' as const }, { tdmReserved: true }, { optOut: 'noai' }, { resolvedPrivate: true }]) expect(assessRights(facts(o), 'h.com').verdict).toBe('blocked');
  });
  it('flags unreachable, wrong type, too big and redirected files as problems', () => {
    for (const o of [{ status: null }, { status: 404 }, { contentType: 'image/png' }, { contentLength: 30_000_000 }, { redirectHost: 'other.com' }]) expect(assessRights(facts(o), 'h.com').verdict, JSON.stringify(o)).toBe('problem');
  });
  it('accepts html pages and a missing content type', () => {
    expect(assessRights(facts({ contentType: 'text/html; charset=utf-8' }), 'h.com').verdict).toBe('pass');
    expect(assessRights(facts({ contentType: null }), 'h.com').verdict).toBe('pass');
  });
});
