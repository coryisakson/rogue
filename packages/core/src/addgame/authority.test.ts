import { describe, expect, it } from 'vitest';
import { authorityLabel, isAuthorityAttested, parseSourceAuthority, parseWikiAuthority } from './authority.js';

describe('source authority choice', () => {
  it('generic form: publisher by default, official or community, nothing else', () => {
    expect(parseSourceAuthority(undefined)).toEqual({ ok: true, value: 'publisher' });
    expect(parseSourceAuthority('')).toEqual({ ok: true, value: 'publisher' });
    expect(parseSourceAuthority(' Official ')).toEqual({ ok: true, value: 'official' });
    expect(parseSourceAuthority('community')).toEqual({ ok: true, value: 'community' });
    for (const x of ['forum', 'author', 'other', 'yes']) expect(parseSourceAuthority(x).ok).toBe(false);
  });
  it('wiki: community by default, publisher only by the attestation checkbox or an explicit value', () => {
    expect(parseWikiAuthority({})).toEqual({ ok: true, value: 'community' });
    expect(parseWikiAuthority({ publisherWiki: 'yes' })).toEqual({ ok: true, value: 'publisher' });
    expect(parseWikiAuthority({ publisherWiki: 'on' })).toEqual({ ok: true, value: 'community' });
    expect(parseWikiAuthority({ authority: 'publisher' })).toEqual({ ok: true, value: 'publisher' });
    expect(parseWikiAuthority({ authority: 'official' }).ok).toBe(false);
  });
  it('knows what counts as an attestation and how to label it', () => {
    expect(isAuthorityAttested('publisher', true)).toBe(true);
    expect(isAuthorityAttested('community', true)).toBe(false);
    expect(isAuthorityAttested('publisher', false)).toBe(false);
    expect(isAuthorityAttested('official', false)).toBe(true);
    expect(authorityLabel('publisher', true)).toBe('Publisher wiki');
    expect(authorityLabel('community', true)).toBe('Community wiki');
    expect(authorityLabel(null, true)).toBe('Community wiki');
    expect(authorityLabel('official', false)).toBe('Official');
  });
});
