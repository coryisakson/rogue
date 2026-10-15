import { describe, expect, it } from 'vitest';
import { acceptQrUrl, dedupeFindings, isQrCandidate, qrClaimBody } from './qr.js';

describe('qr helpers', () => {
  it('accepts web links only', () => {
    expect(acceptQrUrl(' https://contentiongames.com/sts-app/ ')).toBe('https://contentiongames.com/sts-app/');
    expect(acceptQrUrl('http://example.com')).toBe('http://example.com/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'WIFI:S:x;P:y;;', 'mailto:a@b.c', 'tel:123', 'not a url', 'https://u:p@evil.com/', 'https://a.com/ b', 'https://a.com/' + 'x'.repeat(600)])
      expect(acceptQrUrl(bad)).toBeNull();
  });
  it('filters candidate images by shape and size', () => {
    expect(isQrCandidate(289, 289)).toBe(true);
    expect(isQrCandidate(1712, 336)).toBe(false);
    expect(isQrCandidate(20, 20)).toBe(false);
  });
  it('dedupes by url keeping the first page and drops invalid ones', () => {
    const out = dedupeFindings([
      { url: 'https://a.com/x', page: 5 }, { url: 'https://a.com/x', page: 2 }, { url: 'javascript:1', page: 1 }, { url: 'https://b.com', page: 3 },
    ]);
    expect(out).toEqual([{ url: 'https://a.com/x', page: 2 }, { url: 'https://b.com/', page: 3 }]);
  });
  it('writes a plain claim body', () => {
    expect(qrClaimBody({ url: 'https://a.com/x', page: 2 })).toBe('A QR code in the rulebook links to https://a.com/x (a.com).');
  });
});
