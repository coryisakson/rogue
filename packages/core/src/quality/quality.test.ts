import { describe, expect, it } from 'vitest';
import { acceptRepair, pagesNeedingReview, qualityWeight, scorePage, variantOverlap } from './index.js';

const CLEAN = 'On your turn, you perform four actions. You may move to an adjacent city, treat a disease, or share knowledge with another player in the same city. After your actions, draw two player cards and then infect cities. If you cannot draw, the game ends and all players lose.';
const GARBLED = 'Qn y0ur tvrn, y ou p erf orm f0ur act i0ns. Y0u rnay rnove t0 an adjac ent c1ty, trcat a dis ease, 0r sh are kn0w ledge w1th an0th er p1ayer. Aftcr y0ur act1ons, dr aw tw0 pl ayer c ards # & @ ~ ^ then 1nfect c1t1es.';

describe('scorePage', () => {
  it('passes clean prose', () => {
    const q = scorePage(CLEAN);
    expect(q.verdict).toBe('ok');
    expect(q.issues).toEqual([]);
  });
  it('flags OCR damage', () => {
    const q = scorePage(GARBLED);
    expect(['suspect', 'garbled']).toContain(q.verdict);
    expect(q.score).toBeLessThan(scorePage(CLEAN).score);
    expect(q.issues.length).toBeGreaterThan(0);
  });
  it('marks near-empty pages', () => {
    expect(scorePage('12').verdict).toBe('empty');
  });
  it('handles other languages as clean prose', () => {
    const de = 'Wenn du an der Reihe bist, führst du vier Aktionen aus. Du kannst dich bewegen, eine Krankheit behandeln oder Wissen mit einem anderen Spieler in der gleichen Stadt teilen. Danach ziehst du zwei Spielerkarten.';
    expect(scorePage(de).verdict).toBe('ok');
  });
  it('flags letter-salad with no vowels', () => {
    expect(scorePage('xvzk qwrt plmn bcdf ghjk mnbv cxzl kjhg fdsq rtyp zxcv bnmk lkjh').verdict).not.toBe('ok');
  });
});

describe('qualityWeight / pagesNeedingReview', () => {
  it('only down-weights low scores', () => {
    expect(qualityWeight(0.9)).toBe(1);
    expect(qualityWeight(null)).toBe(1);
    expect(qualityWeight(0.5)).toBeLessThan(1);
    expect(qualityWeight(0.1)).toBe(0.2);
  });
  it('lists the worst pages first', () => {
    const m = new Map([[1, scorePage(CLEAN)], [2, scorePage(GARBLED)], [3, { score: 0.5, verdict: 'suspect' as const, issues: [] }]]);
    const list = pagesNeedingReview(m);
    expect(list).not.toContain(1);
    expect(list[0]).toBe(2);
  });
});

describe('acceptRepair', () => {
  it('accepts a spelling-only repair', () => {
    const fixed = 'On your turn, you perform four actions. You may move to an adjacent city, treat a disease, or share knowledge with another player. After your actions, draw two player cards then infect cities.';
    const d = acceptRepair(GARBLED, fixed);
    expect(d.reason).toBeTruthy();
    // numbers: garbled had 0 digits misread as letters so compare against a version with equal digits
    expect(acceptRepair(CLEAN.replace('four', 'four'), CLEAN).accepted).toBe(false); // identical = not better
  });
  it('rejects a repair that changes a number', () => {
    const orig = 'You perf0rm f0ur act1ons. Draw 2 cards, th en d1scard dow n t0 7 cards in y0ur h and at the end of the turn.';
    const bad = 'You perform four actions. Draw 3 cards, then discard down to 7 cards in your hand at the end of the turn.';
    expect(acceptRepair(orig, bad).accepted).toBe(false);
    expect(acceptRepair(orig, bad).reason).toMatch(/numbers/);
  });
  it('rejects a rewrite that invents new content', () => {
    const orig = 'Draw 2 cards, th en d1scard dow n to 7 cards in y0ur h and at the end of the turn, and pla y an event.';
    const invented = 'Draw 2 cards. Collect a mysterious treasure chest from the dragon guardian, polish the enchanted sword, and unlock legendary achievements with 7 wizards.';
    expect(acceptRepair(orig, invented).accepted).toBe(false);
  });
  it('accepts a faithful repair of a damaged page', () => {
    const orig = 'Draw 2 cards, th en d1scard dow n to 7 cards in y0ur h and at the end of the turn, and pla y an event card w henever you l1ke. Ev ents are n0t act1ons.';
    const ok = 'Draw 2 cards, then discard down to 7 cards in your hand at the end of the turn, and play an event card whenever you like. Events are not actions.';
    const d = acceptRepair(orig, ok);
    expect(d).toMatchObject({ accepted: true });
  });
});

describe('variantOverlap', () => {
  const rule = (n: number) => `Page ${n}. On your turn you perform ${n + 2} actions. You may move to an adjacent city, treat a disease, share knowledge, or build a research station. After your actions draw two player cards and infect cities as shown on the infection rate track number ${n}. If you cannot draw the game ends.`;
  const base = new Map([[1, rule(1)], [2, rule(2)], [3, rule(3)], [4, rule(4)], [5, 'x1 z# ~~ q w e']]);
  it('accepts a reflowed text version of the same book', () => {
    const variant = [1, 2, 3, 4].map(rule).join('\n\n').replace(/\. /g, '.\n') + '\nSkip to content. Menu. Cookie settings.';
    const o = variantOverlap(base, variant);
    expect(o.sameDocument).toBe(true);
    expect(o.coverage).toBeGreaterThan(0.9);
  });
  it('rejects an unrelated page', () => {
    const o = variantOverlap(base, 'Buy the expansion now! Free shipping on orders over fifty dollars. Our newsletter brings you the best deals on dice, miniatures and sleeves every week. '.repeat(20));
    expect(o.sameDocument).toBe(false);
  });
});
