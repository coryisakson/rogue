import { describe, expect, it } from 'vitest';
import { acceptPageChoice, looksLikeTable, pagesNeedingExtractReview, wordOverlap } from './extract.js';
import { scorePage } from './index.js';

const PROSE = 'Each player draws two cards at the end of the turn. If you draw an epidemic card, resolve it at once and then continue with the next player in order.';
const OCR_PROSE = 'Each player draws two cards at the end of their turn. If you draw an Epidemic card, resolve it at once, then continue with the next player in order.';

describe('pagesNeedingExtractReview', () => {
  const scoresOf = (m: Map<number, string>) => new Map([...m].map(([p, t]) => [p, scorePage(t)]));

  it('skips clean pages where text layer and OCR agree, and empty pages', () => {
    const tl = new Map([[1, PROSE], [2, '']]);
    const ocr = new Map([[1, OCR_PROSE]]);
    expect(pagesNeedingExtractReview(scoresOf(tl), tl, ocr)).toEqual([]);
  });
  it('flags strong disagreement, garbled text, tables and very short pages', () => {
    const tl = new Map([
      [1, PROSE],
      [2, 'x7 q# zz ## kk 11 lm np rr tt vv ww qq zz ## %% bb cc dd ff gg hh jj'],
      [3, 'Cards   Players   Hand\nA   2   4\nB   3   3\nC   4   2\nD   5   2'],
      [4, 'Turn summary box text'],
    ]);
    const ocr = new Map([[1, 'Setup the board, shuffle the infection deck and place research stations in Atlanta before anyone moves pawns around.']]);
    const got = pagesNeedingExtractReview(scoresOf(tl), tl, ocr);
    const by = new Map(got.map((u) => [u.page, u.reasons]));
    expect(by.get(1)).toContain('disagree');
    expect(by.get(2)).toContain('garbled');
    expect(by.get(3)).toContain('table');
    expect(by.get(4)).toEqual(['short']);
  });
  it('caps the list and puts the most unsure first', () => {
    const tl = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, `Short caption number ${i}`] as [number, string]));
    tl.set(11, 'x7 q# zz ## kk 11 lm np rr tt vv ww qq zz ## %% bb cc dd ff gg hh jj');
    const got = pagesNeedingExtractReview(scoresOf(tl), tl, new Map(), 3);
    expect(got).toHaveLength(3);
    expect(got[0]!.page).toBe(11);
  });
});

describe('extract helpers', () => {
  it('measures word overlap and table shape', () => {
    expect(wordOverlap(PROSE, OCR_PROSE)).toBeGreaterThan(0.8);
    expect(wordOverlap(PROSE, 'completely different words here')).toBeLessThan(0.2);
    expect(looksLikeTable('| a | b |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |')).toBe(true);
    expect(looksLikeTable(PROSE)).toBe(false);
  });
});

describe('acceptPageChoice', () => {
  const c = { textLayer: PROSE, ocr: OCR_PROSE };
  it('accepts a plain pick of either candidate with provenance', () => {
    const d = acceptPageChoice(c, { choice: 'ocr', reason: 'text layer reads columns out of order' });
    expect(d).toMatchObject({ accepted: true, choice: 'ocr', text: OCR_PROSE, provenance: 'extractor:text layer reads columns out of order' });
    expect(acceptPageChoice(c, { choice: 'text_layer', reason: 'exact text' })).toMatchObject({ accepted: true, text: PROSE });
  });
  it('refuses unknown choices, missing reasons and missing OCR', () => {
    expect(acceptPageChoice(c, { choice: 'both', reason: 'x y z' }).accepted).toBe(false);
    expect(acceptPageChoice(c, { choice: 'ocr' }).accepted).toBe(false);
    expect(acceptPageChoice({ textLayer: PROSE, ocr: null }, { choice: 'ocr', reason: 'better' }).accepted).toBe(false);
    expect(acceptPageChoice({ textLayer: PROSE, ocr: null }, { choice: 'merge', text: PROSE, reason: 'better' }).accepted).toBe(false);
  });
  it('accepts a merge that only reuses candidate words (any case)', () => {
    const merged = 'Each player draws two cards at the end of their turn. If you draw an EPIDEMIC card, resolve it at once and then continue with the next player in order.';
    expect(acceptPageChoice(c, { choice: 'merge', text: merged, reason: 'best of both' })).toMatchObject({ accepted: true, choice: 'merge', text: merged });
  });
  it('rejects a merge with an invented word', () => {
    const d = acceptPageChoice(c, { choice: 'merge', text: OCR_PROSE.replace('Epidemic', 'Outbreak'), reason: 'best of both' });
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toContain('outbreak');
  });
  it('rejects a changed or dropped number', () => {
    const tl = 'Each player draws 2 cards and may hold at most 7 cards in hand at the end of the turn.';
    const oc = 'Each player draws 2 cards and may hold at most 7 cards in hand at the end of their turn.';
    expect(acceptPageChoice({ textLayer: tl, ocr: oc }, { choice: 'merge', text: tl.replace('7', '8'), reason: 'merge' }).accepted).toBe(false);
    expect(acceptPageChoice({ textLayer: tl, ocr: oc }, { choice: 'merge', text: tl.replace('7', '2'), reason: 'merge' }).accepted).toBe(false); // 7 dropped
    expect(acceptPageChoice({ textLayer: tl, ocr: oc }, { choice: 'merge', text: oc, reason: 'merge' }).accepted).toBe(true);
  });
  it('rejects a merge outside +/-30% of the longer candidate', () => {
    expect(acceptPageChoice(c, { choice: 'merge', text: 'Each player draws two cards at the end of the turn.', reason: 'short' }).accepted).toBe(false);
    expect(acceptPageChoice(c, { choice: 'merge', text: `${PROSE} ${PROSE}`, reason: 'long' }).accepted).toBe(false);
  });
});
