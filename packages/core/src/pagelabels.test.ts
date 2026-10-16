import { describe, expect, it } from 'vitest';
import { detectPageLabels, formatPageCite, lineCandidates, pageCandidates } from './pagelabels.js';

const body = 'Each player draws cards and takes turns.\nThe active player may move.\nMore rule text follows here.';

describe('lineCandidates', () => {
  it('reads standalone numbers and common footer forms', () => {
    expect(lineCandidates('7')).toEqual([7]);
    expect(lineCandidates('Page 7')).toEqual([7]);
    expect(lineCandidates('page 7 of 20')).toEqual([7]);
    expect(lineCandidates('- 7 -')).toEqual([7]);
    expect(lineCandidates('12  Setup')).toEqual([12]);
    expect(lineCandidates('Rules of Play  13')).toEqual([13]);
  });
  it('ignores mid-line numbers, long lines and roman numerals', () => {
    expect(lineCandidates('draw 3 cards')).toEqual([]);
    expect(lineCandidates('At the start of your turn, the active player must draw 3')).toEqual([]);
    expect(lineCandidates('iv')).toEqual([]);
  });
  it('only looks at the first and last two lines', () => {
    expect(pageCandidates('Title\nintro\n5\nmore\nend\nfoot')).toEqual([]);
    expect(pageCandidates('Title\nintro\nmid\nmore\nfoot\n9')).toEqual([9]);
  });
});

describe('detectPageLabels', () => {
  it('finds a constant offset after a cover and front matter', () => {
    const pages = ['Pandemic\nRulebook', 'Contents\nii', ...[1, 2, 3, 4, 5, 6].map((n) => `${body}\n${n}`)];
    const r = detectPageLabels(pages);
    expect(r.offset).toBe(2);
    expect(r.labels).toEqual([null, null, 1, 2, 3, 4, 5, 6]);
    expect(r.confidence).toBe(1);
  });
  it('labels a page without a footer by the offset, and tolerates one odd page', () => {
    const pages = [1, 2, 3, 4, 5, 6].map((n) => (n === 3 ? body : n === 5 ? `${body}\n99` : `${body}\nPage ${n}`));
    const r = detectPageLabels(pages);
    expect(r.offset).toBe(0);
    expect(r.labels).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('returns all null when there are no numbers', () => {
    const r = detectPageLabels([body, body, body, body]);
    expect(r.labels).toEqual([null, null, null, null]);
    expect(r.offset).toBeNull();
    expect(r.confidence).toBe(0);
  });
  it('does not count numbers in body text', () => {
    const rule = (n: number) => `Setup\nPlace ${n} tokens on the board.\n${body}\ndraw ${n + 2} cards\nthen discard 1 card each.`;
    expect(detectPageLabels([1, 2, 3, 4, 5, 6, 7].map(rule)).labels.every((l) => l === null)).toBe(true);
  });
  it('rejects inconsistent noisy numbers', () => {
    const pages = [7, 3, 12, 1, 40, 2].map((n) => `${body}\n${n}`);
    expect(detectPageLabels(pages).labels.every((l) => l === null)).toBe(true);
  });
  it('gives up on two-page spreads (no constant offset)', () => {
    const pages = ['Cover', ...[1, 2, 3, 4, 5, 6].map((i) => `${body}\n${2 * i}   ${2 * i + 1}`)];
    expect(detectPageLabels(pages).labels.every((l) => l === null)).toBe(true);
  });
  it('handles short docs', () => {
    expect(detectPageLabels([`${body}\n1`, `${body}\n2`]).labels).toEqual([1, 2]);
    expect(detectPageLabels(['Cover', `${body}\n1`, `${body}\n2`, `${body}\n3`]).labels).toEqual([null, 1, 2, 3]);
    expect(detectPageLabels([`${body}\n1`]).labels).toEqual([null]);
    expect(detectPageLabels([]).labels).toEqual([]);
  });
});

describe('formatPageCite', () => {
  it('shows the printed number only when it differs', () => {
    expect(formatPageCite(7, null)).toBe('p.7');
    expect(formatPageCite(7, 7)).toBe('p.7');
    expect(formatPageCite(7, 5)).toBe('p.7 (printed 5)');
  });
});
