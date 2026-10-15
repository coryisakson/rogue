import { describe, expect, it } from 'vitest';
import { classifyLink, extractLinks, findTermsLink, flagTerms, rankCandidates } from './index.js';

const page = `
<a href="/terms/">Terms of Use</a>
<a href="https://cdn.example.com/files/Pandemic_Rulebook.pdf">Rulebook</a>
<a href='https://cdn.example.com/files/Pandemic_Rulebook.pdf#page=2'>again</a>
<a href="/files/Pandemic_Solo_Rules.pdf"><span>Solo &amp; variant</span></a>
<a href="/files/Pandemic_Puzzle_1.pdf">Puzzle 1</a>
<a href="/files/pandemic-faq.pdf">FAQ</a>
<a href="/files/Quick_Start_Guide.pdf">Quick start</a>
<a href="/shop">Buy now</a>
<a href="mailto:hi@example.com">Mail</a>
<a href="/rules-faq">Rules FAQ page</a>
<a href="/about">About us</a>`;

describe('scout links', () => {
  const links = extractLinks(page, 'https://pub.example.com/game/pandemic/');
  it('extracts, resolves and dedupes links, skipping mailto', () => {
    expect(links.map((l) => l.url)).toContain('https://pub.example.com/files/Pandemic_Solo_Rules.pdf');
    expect(links.filter((l) => l.url.endsWith('Pandemic_Rulebook.pdf'))).toHaveLength(1);
    expect(links.some((l) => l.url.startsWith('mailto'))).toBe(false);
    expect(links.find((l) => l.url.includes('Solo'))?.text).toBe('Solo & variant');
  });
  it('ranks the rulebook first and scenarios last, dropping plain web links', () => {
    const r = rankCandidates(links, 'Pandemic');
    expect(r[0]?.role).toBe('rulebook');
    expect(r[0]?.url).toContain('Pandemic_Rulebook.pdf');
    expect(r[r.length - 1]?.role).toBe('scenario');
    expect(r.some((c) => c.url.endsWith('/about') || c.url.endsWith('/shop'))).toBe(false);
    expect(r.map((c) => c.role)).toEqual(expect.arrayContaining(['faq', 'quickstart', 'variant']));
  });
  it('classifies a web FAQ page lower than a PDF but keeps it', () => {
    const c = classifyLink({ url: 'https://pub.example.com/rules-faq', text: 'Rules FAQ page' });
    expect(c?.role).toBe('faq');
    expect(c?.isPdf).toBe(false);
  });
  it('finds the terms link', () => {
    expect(findTermsLink(links)?.url).toBe('https://pub.example.com/terms/');
  });
});

describe('terms flags', () => {
  const terms = `Welcome to our site. You may not use any robot, spider or scraper to access the site. 
    You may not use the content to train an artificial intelligence model. Reproduction of any material without written permission is prohibited.
    We love games. Shipping takes five days.`;
  it('flags bot, ai and copy clauses and ignores the rest', () => {
    const kinds = flagTerms(terms).map((f) => f.kind);
    expect(kinds).toContain('bot');
    expect(kinds).toContain('ai');
    expect(kinds).toContain('copy');
    expect(flagTerms('We love games. Shipping takes five days.')).toEqual([]);
  });
});
