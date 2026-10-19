import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WIKI_DEFAULT_MAX_PAGES, WIKI_HARD_MAX_PAGES, addCrawlLinks, clampMaxPages, detectWiki, extractWikiLinks, extractWikiPage, inWikiScope,
  isCrawlPlan, isJunkWikiUrl, isWikiIndexUrl, isWikiStopStatus, looksLikeBotWall, nextCrawlItem, normaliseWikiUrl, parseWikiImport, parseWikiPageList, planCrawl,
  splitWikiSources, wikiExtractedSource, wikiScope,
} from './index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const BS = 'https://wiki.example-bookstack.org';
const MW = 'https://wiki.example-mw.org';

describe('detectWiki', () => {
  it('recognises BookStack, MediaWiki and anything else', () => {
    expect(detectWiki(fixture('bookstack-page.html'), `${BS}/books/core-rules/page/combat`)).toBe('bookstack');
    expect(detectWiki(fixture('bookstack-book.html'), `${BS}/books/core-rules`)).toBe('bookstack');
    expect(detectWiki(fixture('mediawiki-page.html'), `${MW}/wiki/Setup/Two_players`)).toBe('mediawiki');
    expect(detectWiki('<html><body class="mediawiki"><p>x</p></body></html>', `${MW}/x`)).toBe('mediawiki');
    expect(detectWiki('<html><head><title>Rules</title></head><body><main><p>Hi</p></main></body></html>', 'https://rules.example.com/')).toBe('generic');
  });
});

describe('wiki links', () => {
  it('normalises: no fragment, no tracking parameters, no trailing slash', () => {
    expect(normaliseWikiUrl('/books/a/page/b/#x', BS)).toBe(`${BS}/books/a/page/b`);
    expect(normaliseWikiUrl('page?utm_source=x&fbclid=1&id=3', `${BS}/books/a/`)).toBe(`${BS}/books/a/page?id=3`);
    expect(normaliseWikiUrl('mailto:x@y.z', BS)).toBeNull();
    expect(normaliseWikiUrl('https://a.example.com/', BS)).toBe('https://a.example.com/');
  });

  it('drops wiki tools, accounts and MediaWiki namespaces', () => {
    for (const u of [`${BS}/login`, `${BS}/register`, `${BS}/search?term=x`, `${BS}/books/a/page/b/edit`, `${BS}/books/a/page/b/revisions`,
      `${BS}/books/a/page/b/export/pdf`, `${BS}/user/admin`, `${BS}/tags?name=x`, `${MW}/wiki/Special:Random`, `${MW}/wiki/Talk:Setup`,
      `${MW}/wiki/File:Board.png`, `${MW}/wiki/User:Bob`, `${MW}/index.php?title=Rules&action=history`, `${MW}/wiki/Rules?oldid=3`, `${BS}/uploads/x.png`]) {
      expect(isJunkWikiUrl(u), u).toBe(true);
    }
    for (const u of [`${BS}/books/a/page/combat`, `${BS}/books/a/chapter/turns`, `${MW}/wiki/Rules`, `${MW}/wiki/Category:Setup`, `${BS}/books?page=2`]) expect(isJunkWikiUrl(u), u).toBe(false);
  });

  it('scopes to the host and the start URL path prefix', () => {
    expect(wikiScope(`${BS}/books/core-rules/page/combat`)).toEqual({ host: 'wiki.example-bookstack.org', prefix: '/books/core-rules/' });
    expect(wikiScope(`${BS}/`).prefix).toBe('/');
    expect(wikiScope(`${BS}/shelves/allies`).prefix).toBe('/');
    expect(wikiScope(`${MW}/wiki/Main_Page`).prefix).toBe('/wiki/');
    expect(wikiScope('https://x.example.com/rules/intro.html').prefix).toBe('/rules/');
    expect(inWikiScope(`${BS}/books/core-rules/page/x`, `${BS}/books/core-rules`)).toBe(true);
    expect(inWikiScope(`${BS}/books/core-rules`, `${BS}/books/core-rules/page/x`)).toBe(true);
    expect(inWikiScope(`${BS}/books/core-rules-2/page/x`, `${BS}/books/core-rules`)).toBe(false);
    expect(inWikiScope(`${BS}/books/other/page/x`, `${BS}/books/core-rules`)).toBe(false);
    expect(inWikiScope('https://evil.example.com/books/core-rules/page/x', `${BS}/books/core-rules`)).toBe(false);
  });

  it('extracts in-scope page links from a BookStack book page in reading order', () => {
    const links = extractWikiLinks(fixture('bookstack-book.html'), `${BS}/books/core-rules`, `${BS}/books/core-rules`);
    expect(links).toEqual([
      `${BS}/books/core-rules/page/introduction`,
      `${BS}/books/core-rules/chapter/turn-structure`,
      `${BS}/books/core-rules/page/combat`,
      `${BS}/books/core-rules/page/movement`,
      `${BS}/books/core-rules/page/glossary`,
    ]);
  });

  it('extracts MediaWiki article links and skips namespaces, edit and old-revision links', () => {
    const links = extractWikiLinks(fixture('mediawiki-page.html'), `${MW}/wiki/Setup/Two_players`, `${MW}/wiki/Main_Page`);
    expect(links).toEqual([`${MW}/wiki/Neutral_faction`, `${MW}/wiki/Rules`, `${MW}/wiki/Category:Setup`, `${MW}/wiki/Main_Page`]);
  });

  it('marks listing pages (root, books, chapters, categories) as index pages', () => {
    for (const u of [`${BS}/`, `${BS}/books`, `${BS}/books/core-rules`, `${BS}/shelves/allies`, `${BS}/books/core-rules/chapter/turns`, `${MW}/wiki/Category:Setup`, `${MW}/wiki/Main_Page`]) expect(isWikiIndexUrl(u), u).toBe(true);
    for (const u of [`${BS}/books/core-rules/page/combat`, `${MW}/wiki/Rules`, 'https://x.example.com/rules/intro.html']) expect(isWikiIndexUrl(u), u).toBe(false);
  });

  it('validates a pasted page list: same host, no tools, deduplicated, capped', () => {
    const ok = parseWikiPageList(`${BS}/books/a/page/x\n\n${BS}/books/a/page/x#top\n  ${BS}/books/b/page/y  `, `${BS}/books/a`, 10);
    expect(ok).toEqual({ ok: true, urls: [`${BS}/books/a/page/x`, `${BS}/books/b/page/y`] });
    expect(parseWikiPageList('https://other.example.com/x', `${BS}/`, 10).ok).toBe(false);
    expect(parseWikiPageList(`${BS}/login`, `${BS}/`, 10).ok).toBe(false);
    expect(parseWikiPageList(`http://wiki.example-bookstack.org/books/a`, `${BS}/`, 10).ok).toBe(false);
    expect(parseWikiPageList('', `${BS}/`, 10).ok).toBe(false);
    expect(parseWikiPageList(`${BS}/a\n${BS}/b`, `${BS}/`, 1).ok).toBe(false);
  });
});

describe('planCrawl', () => {
  it('clamps the page cap: default 150, hard cap 500', () => {
    expect(clampMaxPages(undefined)).toBe(WIKI_DEFAULT_MAX_PAGES);
    expect(clampMaxPages('abc')).toBe(150);
    expect(clampMaxPages(0)).toBe(150);
    expect(clampMaxPages(9999)).toBe(WIKI_HARD_MAX_PAGES);
    expect(clampMaxPages('25')).toBe(25);
  });

  it('crawls breadth first, deduplicated, inside the scope', () => {
    const plan = planCrawl({ startUrl: `${BS}/books/core-rules`, mode: 'site' });
    expect(plan.maxDepth).toBe(4);
    expect(nextCrawlItem(plan)).toEqual({ url: `${BS}/books/core-rules`, depth: 0 });
    expect(addCrawlLinks(plan, [`${BS}/books/core-rules/page/a`, `${BS}/books/core-rules/page/b`, `${BS}/books/other/page/c`, `${BS}/books/core-rules/page/a#x`, `${BS}/login`], 0)).toBe(2);
    expect(addCrawlLinks(plan, [`${BS}/books/core-rules`, `${BS}/books/core-rules/page/b`], 0)).toBe(0); // already seen
    expect(nextCrawlItem(plan)?.url).toBe(`${BS}/books/core-rules/page/a`);
    addCrawlLinks(plan, [`${BS}/books/core-rules/page/d`], 1);
    expect(plan.queue.map((q) => [q.url.split('/').pop(), q.depth])).toEqual([['b', 1], ['d', 2]]);
    expect(isCrawlPlan(JSON.parse(JSON.stringify(plan)))).toBe(true);
    expect(isCrawlPlan({ queue: [] })).toBe(false);
  });

  it('stops at the depth cap and the page cap', () => {
    const plan = planCrawl({ startUrl: `${BS}/`, mode: 'site', maxPages: 3, maxDepth: 1 });
    nextCrawlItem(plan);
    expect(addCrawlLinks(plan, [`${BS}/books/a`, `${BS}/books/b`, `${BS}/books/c`, `${BS}/books/d`], 0)).toBe(2); // room for 2 more
    expect(addCrawlLinks(plan, [`${BS}/books/e`], 1)).toBe(0); // depth 1 is the cap
    expect(nextCrawlItem(plan)).not.toBeNull();
    expect(nextCrawlItem(plan)).not.toBeNull();
    expect(nextCrawlItem(plan)).toBeNull();
    expect(plan.visited).toBe(3);
  });

  it('mode pages visits exactly the listed pages and follows no links', () => {
    const plan = planCrawl({ startUrl: `${BS}/books/a`, mode: 'pages', urls: [`${BS}/books/a/page/x`, `${BS}/books/b/page/y`, 'https://other.example.com/z'] });
    expect(plan.maxDepth).toBe(0);
    expect(plan.queue.map((q) => q.url)).toEqual([`${BS}/books/a/page/x`, `${BS}/books/b/page/y`]);
    nextCrawlItem(plan);
    expect(addCrawlLinks(plan, [`${BS}/books/a/page/new`], 0)).toBe(0);
  });
});

describe('wiki page text', () => {
  it('BookStack: page body only, breadcrumb title, markdown table, no nav/comments/edit links', () => {
    const p = extractWikiPage(fixture('bookstack-page.html'), `${BS}/books/core-rules/page/combat`);
    expect(p.kind).toBe('bookstack');
    expect(p.title).toBe('Core Rules > Turn Structure > Combat');
    const all = p.sections.map((s) => `${s.heading}\n${s.body}`).join('\n');
    expect(p.sections.map((s) => s.heading)).toEqual(['Combat', 'Battle steps', 'Unit strength']);
    expect(all).toContain('a battle begins');
    expect(all).toContain('- Both players reveal their battle cards.');
    expect(all).toContain('| Unit | Strength | Cost |\n| --- | --- | --- |\n| Infantry | 1 | 2 gold |\n| Cavalry | 2 | 4 gold |');
    for (const junk of ['Book Navigation', 'Great page', 'Revisions', 'Updated 2 days ago', 'Log in', 'editor note', 'Powered by', 'Skip to main']) expect(all).not.toContain(junk);
  });

  it('MediaWiki: content text only, no TOC, edit links, references, navbox or footer; subpage breadcrumb', () => {
    const p = extractWikiPage(fixture('mediawiki-page.html'), `${MW}/wiki/Setup/Two_players`);
    expect(p.kind).toBe('mediawiki');
    expect(p.title).toBe('Setup > Two players');
    const all = p.sections.map((s) => `${s.heading}\n${s.body}`).join('\n');
    expect(p.sections.map((s) => s.heading)).toEqual(['Two players', 'Board']);
    expect(all).toContain('remove the neutral faction cards');
    expect(all).toContain('- Each player takes 10 workers.');
    expect(all).toContain('| Players | Workers |\n| --- | --- |\n| 2 | 10 |');
    for (const junk of ['Contents', '[edit]', 'edit', 'Errata 2023', 'navigation:', 'Retrieved from', 'Categories', 'Random page', 'last edited', '[1]']) expect(all).not.toContain(junk);
  });

  it('generic: main region, page title without the site name', () => {
    const p = extractWikiPage('<html><head><title>Scoring - Fan Rules</title></head><body><nav>Home</nav><main><h1>Scoring</h1><p>Each crown is 1 point.</p></main><footer>(c)</footer></body></html>', 'https://fan.example.com/rules/scoring');
    expect(p.kind).toBe('generic');
    expect(p.title).toBe('Scoring');
    expect(p.sections).toEqual([{ heading: 'Scoring', body: 'Each crown is 1 point.' }]);
  });

  it('builds the "=== page N ===" text the ingest path stores, and refuses an empty page', () => {
    const x = wikiExtractedSource(fixture('bookstack-page.html'), `${BS}/books/core-rules/page/combat`);
    expect(x.pageCount).toBe(3);
    expect(x.text).toMatch(/^\n\n=== page 1 ===\nCombat\n/);
    expect(x.locators[1]).toBe('section: Battle steps');
    expect(x.title).toBe('Core Rules > Turn Structure > Combat');
    expect(() => wikiExtractedSource('<html><body><nav>only nav</nav></body></html>', `${BS}/x`)).toThrow();
  });

  it('spots bot walls and stop statuses', () => {
    expect(looksLikeBotWall('<html><head><title>Just a moment...</title></head><body></body></html>')).toBe(true);
    expect(looksLikeBotWall('<div class="g-recaptcha" data-sitekey="x"></div>')).toBe(true);
    expect(looksLikeBotWall(fixture('bookstack-page.html'))).toBe(false);
    expect(isWikiStopStatus(403)).toBe(true);
    expect(isWikiStopStatus(429)).toBe(true);
    expect(isWikiStopStatus(404)).toBe(false);
  });
});

describe('wiki import form', () => {
  it('parses whole-wiki and selected-pages imports', () => {
    const site = parseWikiImport({ startUrl: `${BS}/books/core-rules#x`, mode: 'site', maxPages: '9999', publisher: '' });
    expect(site).toEqual({ ok: true, value: { startUrl: `${BS}/books/core-rules`, mode: 'site', urls: [], maxPages: 500, language: 'en', publisher: 'wiki.example-bookstack.org', force: false } });
    const pages = parseWikiImport({ startUrl: `${BS}/`, mode: 'pages', pages: `${BS}/books/a/page/x`, language: 'de', publisher: 'Allies Wiki', force: 'yes' });
    expect(pages.ok && pages.value).toMatchObject({ mode: 'pages', urls: [`${BS}/books/a/page/x`], language: 'de', publisher: 'Allies Wiki', force: true, maxPages: 150 });
    expect(parseWikiImport({ startUrl: 'http://wiki.example.org/' }).ok).toBe(false);
    expect(parseWikiImport({ startUrl: 'https://10.0.0.1/' }).ok).toBe(false);
    expect(parseWikiImport({ startUrl: `${BS}/`, language: 'fr' }).ok).toBe(false);
    expect(parseWikiImport({ startUrl: `${BS}/`, mode: 'pages', pages: 'https://other.example.com/a' }).ok).toBe(false);
  });

  it('splits wiki pages off a source list', () => {
    const s = [{ id: 1, kind: 'rulebook' }, { id: 2, kind: 'wiki' }, { id: 3, kind: 'wiki' }, { id: 4, kind: null }];
    expect(splitWikiSources(s)).toEqual({ other: [{ id: 1, kind: 'rulebook' }, { id: 4, kind: null }], wiki: [{ id: 2, kind: 'wiki' }, { id: 3, kind: 'wiki' }] });
  });
});
