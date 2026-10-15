import { describe, expect, it } from 'vitest';
import { isAssetHost, judgeTerms, registrableDomain, termsSiteCandidates } from './index.js';

const filler = 'These terms describe how you may use our website, order products, and contact customer support. '.repeat(20);

describe('terms agent (pure parts)', () => {
  it('knows a CDN is not the publisher', () => {
    expect(isAssetHost('cdn.svc.asmodee.net')).toBe(true);
    expect(isAssetHost('www.zmangames.com')).toBe(false);
    expect(registrableDomain('cdn.svc.asmodee.net')).toBe('asmodee.net');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
  });
  it('looks at the linking page first and skips the CDN host', () => {
    const c = termsSiteCandidates('https://cdn.svc.asmodee.net/production-zman/uploads/rules.pdf', 'https://www.zmangames.com/game/pandemic/');
    expect(c[0]!.origin).toBe('https://www.zmangames.com');
    expect(c.some((x) => x.origin === 'https://cdn.svc.asmodee.net')).toBe(false);
    expect(c.some((x) => x.origin === 'https://www.asmodee.net')).toBe(true);
  });
  it('uses the file host when it is a real site and nothing else is known', () => {
    const c = termsSiteCandidates('https://contentiongames.com/_images/rules.pdf', null);
    expect(c[0]!.origin).toBe('https://contentiongames.com');
  });
  it('clears long terms with no bot/AI/copy language', () => {
    expect(judgeTerms(filler).verdict).toBe('clear');
  });
  it('flags a prohibition on bots as restricted', () => {
    const j = judgeTerms(`${filler} You may not use any robot, spider or scraper to access the site.`);
    expect(j.verdict).toBe('restricted');
  });
  it('lets generic copyright wording through (R28) but not bot rules', () => {
    const j = judgeTerms(`${filler} You may not copy, reproduce or republish any content from this website without prior written permission.`);
    expect(j.verdict).toBe('clear');
    expect(j.flags.length).toBeGreaterThan(0);
  });
  it('treats AI mentions without a clear rule as unclear, and short pages as unclear', () => {
    expect(judgeTerms(`${filler} We use artificial intelligence to recommend products to our customers.`).verdict).toBe('unclear');
    expect(judgeTerms('Terms. Use at your own risk.').verdict).toBe('unclear');
  });
});
