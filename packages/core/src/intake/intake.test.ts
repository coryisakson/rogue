import { describe, expect, it } from 'vitest';
import { rankPublisherPages, adminSearchQuery, googleLink, isAggregator, parseBggMatches, parseDetails, parsePick, pickFromSearch } from './index.js';

describe('intake', () => {
  it('builds a pick list from BGG search hits', () => {
    const m = parseBggMatches([
      { url: 'https://boardgamegeek.com/boardgame/30549/pandemic', title: 'Pandemic | Board Game - BoardGameGeek' },
      { url: 'https://boardgamegeek.com/boardgame/207017/pandemic-the-cure-experimental-meds', title: 'Pandemic: The Cure – Experimental Meds (2016) - BoardGameGeek' },
      { url: 'https://boardgamegeek.com/boardgame/30549/pandemic?x=1', title: 'dup' },
      { url: 'https://boardgamegeek.com/filepage/27536/x', title: 'file' },
      { url: 'https://example.com/boardgame/5/x', title: 'fake' },
    ]);
    expect(m).toEqual([
      { bggId: 30549, title: 'Pandemic', year: null, url: 'https://boardgamegeek.com/boardgame/30549' },
      { bggId: 207017, title: 'Pandemic: The Cure – Experimental Meds', year: 2016, url: 'https://boardgamegeek.com/boardgame/207017' },
    ]);
  });
  it('validates picks and details', () => {
    expect(parsePick({ bggId: '30549', title: ' Pandemic ', year: '2008' })?.bggId).toBe(30549);
    expect(parsePick({ bggId: 'x', title: 'a' })).toBeNull();
    expect(parsePick({ bggId: '5', title: 'Ok', year: '1500' })).toBeNull();
    expect(parseDetails('hi').ok).toBe(false);
    expect(parseDetails('Pandemic Iberia by Z-Man 2016 English').ok).toBe(true);
  });
  it('makes a google link', () => {
    expect(googleLink(adminSearchQuery('Foo Bar\n2020'))).toContain('google.com/search?q=Foo%20Bar%202020');
  });
  it('prefers a publisher rulebook pdf and skips aggregators', () => {
    expect(isAggregator('www.scribd.com')).toBe(true);
    const p = pickFromSearch([
      { url: 'https://www.scribd.com/document/1/Pandemic-Rules', title: 'Pandemic rules' },
      { url: 'https://cdn.zman.com/files/pandemic_rules.pdf', title: 'pandemic_rules.pdf - Z-MAN Games' },
      { url: 'https://www.zman.com/game/pandemic/', title: 'Pandemic - Z-MAN' },
    ], 'Pandemic');
    expect(p.rulebook?.url).toBe('https://cdn.zman.com/files/pandemic_rules.pdf');
    expect(p.pagesToScan).toEqual(['https://www.zman.com/game/pandemic/']);
    expect(pickFromSearch([{ url: 'https://www.scribd.com/x.pdf', title: 'rules' }], 'Pandemic').rulebook).toBeNull();
  });
  it('ranks publisher pages first and skips shops and crowdfunding', () => {
    const urls = rankPublisherPages([
      { url: 'https://store.asmodee.com/products/pandemic', title: 'Pandemic Board Game - Asmodee' },
      { url: 'https://gamefound.com/en/projects/x/slay-the-spire', title: 'Slay the Spire' },
      { url: 'https://www.zmangames.com/game/pandemic/', title: 'Pandemic - Z-MAN Games' },
      { url: 'https://boardgamegeek.com/boardgame/30549/pandemic', title: 'Pandemic' },
      { url: 'https://www.zmangames.com/', title: 'Z-MAN Games: Homepage' },
    ], 'Pandemic');
    expect(urls[0]).toBe('https://www.zmangames.com/game/pandemic/');
    expect(urls.some((u) => /gamefound|boardgamegeek|store\.asmodee/.test(u))).toBe(false);
  });
});
