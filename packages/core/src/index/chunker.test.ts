import { describe, expect, it } from 'vitest';
import { chunkText, splitJoinedHeadings, orQuery, rrf, sectionHeadings, splitPages } from './chunker.js';

const sample = `\n\n=== page 1 ===\n${'Alpha rule sentence. '.repeat(120)}\n\n=== page 2 ===\nShort page two text here, long enough.\n\n=== page 3 ===\n  `;

describe('chunker', () => {
  it('splits pages and keeps numbers', () => {
    const p = splitPages(sample);
    expect([...p.keys()]).toEqual([1, 2, 3]);
  });
  it('chunks never cross pages, respect size and overlap, skip empty pages', () => {
    const c = chunkText(sample, { target: 500, overlap: 80 });
    expect(c.every((x) => x.text.length <= 500)).toBe(true);
    expect(c.filter((x) => x.page === 1).length).toBeGreaterThan(3);
    expect(c.filter((x) => x.page === 2)).toHaveLength(1);
    expect(c.some((x) => x.page === 3)).toBe(false);
    expect(c.map((x) => x.ord)).toEqual(c.map((_, i) => i));
  });
  it('covers every character of a page (no gaps)', () => {
    const body = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} here.`).join(' ');
    const c = chunkText(`\n\n=== page 1 ===\n${body}`, { target: 300, overlap: 50 });
    const joined = c.map((x) => x.text).join(' ');
    for (let i = 0; i < 80; i++) expect(joined).toContain(`number ${i} `);
  });
  it('works for non-latin text', () => {
    const c = chunkText(`\n\n=== page 1 ===\n${'ゲームの準備をします。'.repeat(100)}`, { target: 300, overlap: 40 });
    expect(c.length).toBeGreaterThan(1);
  });
  it('rrf merges ranked lists', () => {
    expect(rrf([['a', 'b', 'c'], ['b', 'a', 'd']])[0]).toBe('a');
    expect(rrf([['x'], ['y']])).toHaveLength(2);
  });
  it('orQuery keeps content words and is tsquery-safe', () => {
    expect(orQuery('How do I get rid of a disease for good?')).toBe('get | rid | disease | good');
    expect(orQuery("what's (a:b) & !c")).not.toMatch(/[():&!']/);
    expect(orQuery('ゲーム 準備')).toBe('ゲーム | 準備');
    expect(orQuery('the of a')).toBe('');
    expect(orQuery('retaining exhausts')).toBe('retain:* | exhaust:*');
  });
});

describe('sectionHeadings', () => {
  it('reads the first line after each marker', () => {
    const m = sectionHeadings("\n\n=== page 1 ===\nIntro\nbody\n\n=== page 2 ===\nWhat's in the box\n7 Role Cards");
    expect(m.get(1)).toBe('Intro'); expect(m.get(2)).toBe("What's in the box");
  });
});

describe('splitJoinedHeadings', () => {
  it('separates neighbouring two-line headings using "the <Name>" in the text', () => {
    const body = 'CONTINGENCY PLANNER\nThe Contingency Planner may take a card.\nCONTINGENCY\nPLANNER\nDISPATCHER\nThe Dispatcher may move pawns.\nQUARANTINE\nSPECIALIST\nThe Quarantine Specialist stops cubes.';
    const out = splitJoinedHeadings(body).split('\n');
    expect(out).toContain('CONTINGENCY PLANNER');
    expect(out).toContain('DISPATCHER');
    expect(out).toContain('QUARANTINE SPECIALIST');
    expect(out).not.toContain('CONTINGENCY PLANNER DISPATCHER');
  });
  it('leaves single caps lines and normal text alone', () => {
    expect(splitJoinedHeadings('ROLES\nEach player has a role.')).toBe('ROLES\nEach player has a role.');
  });
});
