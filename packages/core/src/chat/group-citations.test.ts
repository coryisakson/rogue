import { describe, expect, it } from 'vitest';
import { groupCitations, pageList, type CitationSource } from './group-citations.js';

const src = (page: number | null, url = 'https://pub.example/rules.pdf', extra: Partial<CitationSource> = {}): CitationSource =>
  ({ page, printed: null, section: null, title: 'Rulebook', url, publisher: 'Pub', quote: `quote p${page}`, ...extra });

describe('groupCitations', () => {
  it('lists each document once and dedupes repeated pages', () => {
    const g = groupCitations([src(7), src(7), src(4)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.pages).toEqual(['4', '7']);
  });
  it('orders pages numerically, not by rank or text', () => {
    expect(groupCitations([src(9), src(10), src(4), src(7)])[0]!.pages).toEqual(['4', '7', '9', '10']);
  });
  it('keeps the printed page note and treats it as one page', () => {
    expect(groupCitations([src(7, undefined, { printed: 5 }), src(3, undefined, { printed: 3 })])[0]!.pages).toEqual(['3', '7 (printed 5)']);
  });
  it('drops unknown pages but keeps the document', () => {
    const g = groupCitations([src(null), src(0), src(Number.NaN)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.pages).toEqual([]);
    expect(pageList(g[0]!.pages)).toBe('');
  });
  it('shows section names for web sources', () => {
    expect(groupCitations([src(2, 'https://pub.example/faq', { section: 'Setup' }), src(1, 'https://pub.example/faq', { section: 'Turn order' })])[0]!.pages).toEqual(['Turn order', 'Setup']);
  });
  it('keeps documents apart, in order of their best hit, with the first quote', () => {
    const g = groupCitations([src(5, 'https://a.example/x.pdf'), src(2, 'https://b.example/y.pdf', { title: 'FAQ' }), src(1, 'https://a.example/x.pdf')]);
    expect(g.map((d) => d.url)).toEqual(['https://a.example/x.pdf', 'https://b.example/y.pdf']);
    expect(g[0]!.pages).toEqual(['1', '5']);
    expect(g[0]!.quote).toBe('quote p5');
    expect(g[1]!.title).toBe('FAQ');
  });
  it('skips empty quotes when choosing the document quote', () => {
    expect(groupCitations([src(1, undefined, { quote: '  ' }), src(2)])[0]!.quote).toBe('quote p2');
  });
});

describe('pageList', () => {
  it('formats one or many pages', () => {
    expect(pageList(['4'])).toBe('p. 4');
    expect(pageList(['4', '7', '9'])).toBe('pp. 4, 7, 9');
  });
});
