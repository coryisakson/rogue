import { describe, expect, it } from 'vitest';
import { MIN_TEXT_LAYER_SCORE, ocrModeFromEnv, pickPagesForOcr, textLayerQuality } from './index.js';

// Short original sample sentences (not rulebook text) in the languages Rogue ingests.
const en = 'Each player takes a hand of five cards. On your turn, draw one card and then play a card or pass. I win if a pile runs out.';
const de = 'Jeder Spieler erhält fünf Karten. In deinem Zug ziehst du eine Karte und spielst dann eine Karte aus oder passt.';
const es = 'Cada jugador recibe cinco cartas. En tu turno, roba una carta y luego juega una carta o pasa. El juego termina y se cuenta.';
const it_ = 'Ogni giocatore riceve cinque carte. Nel tuo turno pesca una carta e poi gioca una carta o passa, e il gioco continua.';
const zh = '每位玩家获得五张牌。在你的回合中，抽一张牌，然后打出一张牌或者跳过。当牌堆用完时游戏结束，得分最高的玩家获胜。';
const ja = '各プレイヤーはカードを五枚受け取ります。手番では一枚引いてから一枚出すか、パスします。山札がなくなると終了です。';
const spaced = 'T h e  g a m e  e n d s  w h e n  t h e  l a s t  c a r d  i s  d r a w n  a n d  s c o r e s  a r e  c o u n t e d';
const replacement = `${en} ${'�'.repeat(40)} ${''.repeat(30)}`;
const mojibake = '#$%& ()*+ ,-./ 0123 !"#$ %&()* +,-. /01 :;<= >?@[ ]^_` {|}~ ab#$ %&cd ()*+ ef,- ./gh '.repeat(3);
const consonants = 'xvbrt kplmn drstq zvklp grtsn mpldr vnkst prdlk tzrbn xwqpl kvrst plmnd sdfgh jklzx cvbnm qwrtz';

describe('textLayerQuality', () => {
  it.each([['en', en], ['de', de], ['es', es], ['it', it_]])('keeps clean %s text', (_, text) => {
    const q = textLayerQuality(text);
    expect(q.score).toBeGreaterThanOrEqual(0.9);
    expect(q.reasons).toEqual([]);
  });
  it.each([['zh', zh], ['ja', ja]])('keeps clean %s text (no word-token penalty)', (_, text) => {
    expect(textLayerQuality(text).score).toBe(1);
  });
  it('keeps mixed CJK with Latin terms', () => {
    expect(textLayerQuality(`${zh} 使用 Pandemic 规则 v2，见 page 3。`).score).toBeGreaterThanOrEqual(0.9);
  });
  it('flags empty and near-empty pages', () => {
    expect(textLayerQuality('')).toEqual({ score: 0, chars: 0, reasons: ['empty'] });
    expect(textLayerQuality('  12 \n').reasons).toEqual(['empty']);
  });
  it('flags spaced-out text', () => {
    const q = textLayerQuality(spaced);
    expect(q.score).toBeLessThan(MIN_TEXT_LAYER_SCORE);
    expect(q.reasons).toContain('spaced-out');
  });
  it('flags replacement and private-use glyphs', () => {
    const q = textLayerQuality(replacement);
    expect(q.score).toBe(0);
    expect(q.reasons).toContain('bad-glyphs');
  });
  it('flags symbol soup', () => {
    expect(textLayerQuality(mojibake).reasons).toContain('symbols');
  });
  it('flags vowel-less letter runs', () => {
    expect(textLayerQuality(consonants).reasons).toContain('few-words');
  });
  it('tolerates all-caps headings and numbers', () => {
    expect(textLayerQuality(`SETUP 1. ${en} HTML XP 2-4 players, 30 min.`).score).toBeGreaterThanOrEqual(0.9);
  });
});

describe('pickPagesForOcr', () => {
  const pages = [en, '', spaced, zh, replacement];
  it('auto OCRs only empty or garbled pages', () => {
    const r = pickPagesForOcr(pages);
    expect(r.ocrPages).toEqual([2, 3, 5]);
    expect(r.decisions.map((d) => d.source)).toEqual(['text', 'ocr', 'ocr', 'text', 'ocr']);
    expect(r.decisions[0]).toMatchObject({ page: 1, reasons: [] });
  });
  it('all OCRs every page but still scores them', () => {
    const r = pickPagesForOcr(pages, { mode: 'all' });
    expect(r.ocrPages).toEqual([1, 2, 3, 4, 5]);
    expect(r.decisions[0]?.score).toBeGreaterThan(0.9);
  });
  it('off never OCRs', () => { expect(pickPagesForOcr(pages, { mode: 'off' }).ocrPages).toEqual([]); });
  it('honours a custom score threshold', () => { expect(pickPagesForOcr([en], { minScore: 1.01 }).ocrPages).toEqual([1]); });
  it('handles no pages', () => { expect(pickPagesForOcr([])).toEqual({ ocrPages: [], decisions: [] }); });
});

describe('ocrModeFromEnv', () => {
  it('defaults to auto', () => { expect(ocrModeFromEnv({})).toBe('auto'); });
  it('reads ROGUE_OCR_MODE', () => { expect(ocrModeFromEnv({ ROGUE_OCR_MODE: ' OFF ' })).toBe('off'); });
  it('keeps ROGUE_OCR_ALL_PAGES=1 as an alias for all', () => { expect(ocrModeFromEnv({ ROGUE_OCR_ALL_PAGES: '1' })).toBe('all'); });
  it('lets ROGUE_OCR_MODE win over the alias', () => { expect(ocrModeFromEnv({ ROGUE_OCR_MODE: 'auto', ROGUE_OCR_ALL_PAGES: '1' })).toBe('auto'); });
  it('ignores unknown values', () => { expect(ocrModeFromEnv({ ROGUE_OCR_MODE: 'sometimes', ROGUE_OCR_ALL_PAGES: '' })).toBe('auto'); });
});
