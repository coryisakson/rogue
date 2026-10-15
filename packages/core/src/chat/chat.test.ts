import { describe, expect, it } from 'vitest';
import { badCitations, buildPrompt, citedPages, isAggregateQuestion, namedSections } from './chat.js';

describe('chat helpers', () => {
  const ex = [{ page: 2, text: 'Deal  cards.' }, { page: 6, text: 'Hand limit 7.' }];
  it('buildPrompt numbers excerpts with pages', () => {
    const p = buildPrompt('Hand limit?', ex);
    expect(p).toContain('[1] (p.2) Deal cards.');
    expect(p).toContain('[2] (p.6) Hand limit 7.');
    expect(p.endsWith('Question: Hand limit?')).toBe(true);
  });
  it('citedPages parses variants', () => {
    expect(citedPages('Seven (p.6) and also p. 2, p.2.')).toEqual([6, 2]);
    expect(citedPages('no cites')).toEqual([]);
  });
  it('badCitations flags pages that were never retrieved', () => {
    expect(badCitations('See (p.6) and (p.9).', ex)).toEqual([9]);
    expect(badCitations('See (p.6).', ex)).toEqual([]);
  });
  it('detects list and count questions', () => {
    expect(isAggregateQuestion('how many roles are there in pandemic')).toBe(true);
    expect(isAggregateQuestion('List all the roles')).toBe(true);
    expect(isAggregateQuestion('Wie viele Rollen gibt es?')).toBe(true);
    expect(isAggregateQuestion('What is the hand limit?')).toBe(false);
    expect(isAggregateQuestion('Who goes first?')).toBe(false);
  });
  it('web-page sections are cited as s.N and shown by heading', () => {
    const web = [{ page: 2, text: '7 Role Cards', section: "What's in the box" }, { page: 6, text: 'x' }];
    expect(buildPrompt('q', web)).toContain('(s.2 "What\'s in the box")');
    expect(buildPrompt('q', web)).toContain('(p.6)');
    expect(badCitations('Seven roles (s.2), hand (p.6).', web)).toEqual([]);
    expect(badCitations('See (p.2).', web)).toEqual([2]);
    expect(badCitations('See (s.6).', web)).toEqual(['s.6']);
    expect(namedSections('Seven roles (s.2).', web)).toBe('Seven roles ("What\'s in the box").');
  });
});
