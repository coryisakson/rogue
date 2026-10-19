import { describe, it, expect } from 'vitest';
import { questionLang, preferLang } from './question-lang.js';

describe('questionLang', () => {
  it('detects English and German', () => {
    expect(questionLang('Which roles are in the game?')).toBe('en');
    expect(questionLang('Welche Rollen gibt es im Spiel?')).toBe('de');
  });
  it('returns null when unclear', () => { expect(questionLang('Pandemic roles')).toBeNull(); });
});

describe('preferLang', () => {
  const hits = [{ lang: 'en', id: 1 }, { lang: 'de', id: 2 }, { lang: 'en-US', id: 3 }];
  it('keeps the wanted language', () => { expect(preferLang(hits, 'en').map((h) => h.id)).toEqual([1, 3]); });
  it('never filters to nothing', () => { expect(preferLang(hits, 'fr')).toHaveLength(3); });
  it('passes through without a wish', () => { expect(preferLang(hits, null)).toHaveLength(3); });
});
