import { describe, expect, it } from 'vitest';
import {
  rankPublisherPages, adminSearchQuery, bggSearchNote, bggSearchQueries, googleLink, isAggregator, isBggGameUrl, parseBggMatches, parseDetails,
  parseNameRequest, parsePick, pickFromSearch,
} from './index.js';

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
  // The "terraforming" bug: SearXNG results come back with www./m. hosts, http, query strings, expansions and BGG's
  // "| Board Game | BoardGameGeek" titles, mixed with non-BGG pages. The old regex took only https://boardgamegeek.com.
  it('finds Terraforming Mars in realistic search results', () => {
    const m = parseBggMatches([
      { url: 'https://www.reddit.com/r/boardgames/comments/abc/terraforming_mars/', title: 'Terraforming Mars : r/boardgames' },
      { url: 'https://www.boardgamegeek.com/boardgame/167791/terraforming-mars', title: 'Terraforming Mars | Board Game | BoardGameGeek' },
      { url: 'https://boardgamegeek.com/boardgame/167791/terraforming-mars/files', title: 'Terraforming Mars | Files | BoardGameGeek' },
      { url: 'http://boardgamegeek.com/boardgameexpansion/247030/terraforming-mars-prelude?utm_source=x#top', title: 'Terraforming Mars: Prelude | Board Game Expansion | BoardGameGeek' },
      { url: 'https://m.boardgamegeek.com/boardgame/328479/', title: 'Terraforming Mars: Ares Expedition (2021) | Board Game | BoardGameGeek' },
      { url: 'https://boardgamegeek.com/boardgame/284189', title: 'Terraforming Mars: The Dice Game - BoardGameGeek' },
      { url: 'https://www.boardgamegeek.com/boardgame/167791/terraforming-mars?fromsearch=1', title: 'dup' },
      { url: 'https://boardgamegeek.com/geeksearch.php?q=terraforming', title: 'Search | BoardGameGeek' },
      { url: 'https://notboardgamegeek.com/boardgame/1/x', title: 'fake' },
      { url: 'https://www.amazon.com/Terraforming-Mars/dp/B01GSYA4K2', title: 'Terraforming Mars - Amazon' },
    ]);
    expect(m.map((x) => [x.bggId, x.title, x.year])).toEqual([
      [167791, 'Terraforming Mars', null],
      [247030, 'Terraforming Mars: Prelude', null],
      [328479, 'Terraforming Mars: Ares Expedition', 2021],
      [284189, 'Terraforming Mars: The Dice Game', null],
    ]);
    expect(m[0]!.url).toBe('https://boardgamegeek.com/boardgame/167791');
    expect(isBggGameUrl('https://www.boardgamegeek.com/boardgame/167791/terraforming-mars')).toBe(true);
    expect(isBggGameUrl('https://boardgamegeek.com/filepage/1/x')).toBe(false);
  });
  it('caps the pick list and keeps BGG titles that contain "Board Game"', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://boardgamegeek.com/boardgame/${i + 1}/g`, title: `Game ${i + 1} | Board Game | BoardGameGeek` }));
    expect(parseBggMatches(many)).toHaveLength(8);
    expect(parseBggMatches([{ url: 'https://boardgamegeek.com/boardgame/9/x', title: 'Slay the Spire: The Board Game | Board Game | BoardGameGeek' }])[0]!.title).toBe('Slay the Spire: The Board Game');
  });
  it('tries a host-only site filter, then a plain query', () => {
    expect(bggSearchQueries('  terraforming ')).toEqual(['site:boardgamegeek.com terraforming board game', 'terraforming boardgamegeek']);
    expect(bggSearchQueries('x').every((q) => !q.includes('boardgamegeek.com/boardgame'))).toBe(true);
  });
  it('tells the admin why a search found nothing', () => {
    expect(bggSearchNote({ kind: 'off' }, 'x')).toMatch(/search is off/i);
    expect(bggSearchNote({ kind: 'error', message: 'search answered HTTP 502' }, 'x')).toMatch(/failed \(search answered HTTP 502\)/);
    expect(bggSearchNote({ kind: 'ok', matches: [], rawHits: 0, queries: 2 }, 'terraforming')).toMatch(/no results for “terraforming” \(2 searches/);
    expect(bggSearchNote({ kind: 'ok', matches: [], rawHits: 17, queries: 2 }, 'terraforming')).toMatch(/17 results .* none was a BoardGameGeek game page/);
    expect(bggSearchNote({ kind: 'ok', matches: [{ bggId: 1, title: 'A', year: null, url: '' }], rawHits: 3, queries: 1 }, 'a')).toBeNull();
  });
  it('validates an add-by-name request', () => {
    expect(parseNameRequest({ title: '  Terraforming   Mars ', year: '2016' })).toEqual({ title: 'Terraforming Mars', year: 2016 });
    expect(parseNameRequest({ title: 'Tiny Epic X', year: '' })).toEqual({ title: 'Tiny Epic X', year: null });
    expect(parseNameRequest({ title: 'a' })).toBeNull();
    expect(parseNameRequest({ title: 'Ok game', year: '20x' })).toBeNull();
    expect(parseNameRequest({ title: 'x'.repeat(81) })).toBeNull();
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
