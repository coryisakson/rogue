import { describe, expect, it } from 'vitest';
import { libraryMatch, parseSourceInput, parseSourceUrl, runtimeEditionLabel, runtimeSeed, sourceProbeGate, termsGate } from './sources.js';

const base = { url: 'https://cdn.example.com/azul-faq.pdf#page=2', title: 'Azul FAQ', publisher: 'Plan B Games', language: 'en', kind: 'faq' };

describe('game sources: form validation', () => {
  it('accepts a valid form, drops the #fragment and defaults foundOn to null', () => {
    const p = parseSourceInput(base);
    expect(p).toEqual({ ok: true, value: { url: 'https://cdn.example.com/azul-faq.pdf', title: 'Azul FAQ', publisher: 'Plan B Games', language: 'en', kind: 'faq', foundOn: null, authority: 'publisher' } });
  });
  it('takes the admin Authority choice (publisher by default, official or community), nothing else', () => {
    for (const authority of ['publisher', 'official', 'community', 'Community']) expect(parseSourceInput({ ...base, authority }).ok).toBe(true);
    expect(parseSourceInput({ ...base, authority: 'community' })).toMatchObject({ ok: true, value: { authority: 'community' } });
    for (const authority of ['forum', 'author', 'admin']) expect(parseSourceInput({ ...base, authority }).ok).toBe(false);
  });
  it('defaults language to en and kind to rulebook', () => {
    const p = parseSourceInput({ ...base, language: '', kind: '' });
    expect(p.ok && p.value.language).toBe('en');
    expect(p.ok && p.value.kind).toBe('rulebook');
  });
  it('only takes the five site languages and the four kinds', () => {
    for (const language of ['en', 'de', 'zh', 'es', 'it', 'DE']) expect(parseSourceInput({ ...base, language }).ok).toBe(true);
    for (const language of ['fr', 'en-us', 'xx']) expect(parseSourceInput({ ...base, language }).ok).toBe(false);
    for (const kind of ['rulebook', 'faq', 'errata', 'other']) expect(parseSourceInput({ ...base, kind }).ok).toBe(true);
    for (const kind of ['quickstart', 'forum', 'x']) expect(parseSourceInput({ ...base, kind }).ok).toBe(false);
  });
  it('refuses unsafe or missing links with the add-game host rules', () => {
    for (const url of ['', 'not a url', 'http://cdn.example.com/a.pdf', 'https://10.0.0.1/a.pdf', 'https://intranet.local/a.pdf', 'https://u:p@cdn.example.com/a.pdf', 'https://cdn.example.com:8443/a.pdf']) {
      expect(parseSourceInput({ ...base, url }).ok).toBe(false);
    }
    expect(parseSourceInput({ ...base, foundOn: 'http://example.com/rules' }).ok).toBe(false);
    const ok = parseSourceInput({ ...base, foundOn: 'https://example.com/azul/#downloads' });
    expect(ok.ok && ok.value.foundOn).toBe('https://example.com/azul/');
  });
  it('needs a title and a publisher', () => {
    expect(parseSourceInput({ ...base, title: ' ' }).ok).toBe(false);
    expect(parseSourceInput({ ...base, publisher: 'x' }).ok).toBe(false);
  });
  it('parseSourceUrl names the field in its error', () => {
    const r = parseSourceUrl('nope', 'Rules link');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Rules link/);
  });
});

describe('game sources: gates', () => {
  it('terms gate: known hosts skip the checkbox, new hosts need it', () => {
    const known = ['cdn.svc.asmodee.net', 'www.zmangames.com'];
    expect(termsGate('cdn.svc.asmodee.net', known, false)).toBeNull();
    expect(termsGate('new.example.com', known, false)).toMatch(/not an approved host/);
    expect(termsGate('new.example.com', known, true)).toBeNull();
  });
  it('probe gate: blocked never passes, problem and pass do, a mismatched host is refused', () => {
    const url = 'https://cdn.example.com/a.pdf';
    expect(sourceProbeGate('pass', 'cdn.example.com', url)).toBeNull();
    expect(sourceProbeGate('problem', 'cdn.example.com', url)).toBeNull();
    expect(sourceProbeGate('blocked', 'cdn.example.com', url)).toMatch(/blocked/);
    expect(sourceProbeGate('pass', 'other.example.com', url)).toMatch(/do not match/);
  });
});

describe('game sources: seeds', () => {
  it('builds the edition label and a seed allSeeds() can use', () => {
    const label = runtimeEditionLabel('Plan B Games', 'faq', 'en', '2026-10-17');
    expect(label).toBe('Plan B Games faq (en, admin-added 2026-10-17)');
    const row = { game_slug: 'azul', url: 'https://cdn.example.com/a.pdf', title: 'Azul FAQ', publisher: 'Plan B Games', language: 'en', kind: 'faq', edition_label: label, found_on: null };
    expect(runtimeSeed(row)).toEqual({ gameSlug: 'azul', url: row.url, title: 'Azul FAQ', publisher: 'Plan B Games', language: 'en', kind: 'faq', editionLabel: label, foundOn: row.url });
    expect(runtimeSeed({ ...row, kind: 'weird', found_on: 'https://example.com/p' })).toMatchObject({ kind: 'other', foundOn: 'https://example.com/p' });
    // The stored authority travels with the seed; none or an unknown value leaves the ingest default (publisher).
    expect(runtimeSeed({ ...row, authority: 'community' }).authority).toBe('community');
    expect(runtimeSeed({ ...row, authority: 'forum' }).authority).toBeUndefined();
  });
});

describe('game sources: admin title search', () => {
  const games = [{ slug: 'azul', bggId: 230802 }, { slug: 'slay-the-spire', bggId: null }];
  it('finds a game in Rogue by BGG id first, then by slug', () => {
    expect(libraryMatch({ bggId: 230802, title: 'Azul (renamed)' }, games)).toBe('azul');
    expect(libraryMatch({ bggId: 338960, title: 'Slay the Spire' }, games)).toBe('slay-the-spire');
  });
  it('returns null for a game not in Rogue', () => {
    expect(libraryMatch({ bggId: 1, title: 'Brass: Birmingham' }, games)).toBeNull();
  });
});
