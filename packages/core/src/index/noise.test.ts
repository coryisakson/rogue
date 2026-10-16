import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker.js';
import { filterNoise, filterPagesNoise, isLabelLine, isSymbolLine, looksLikeSentence, repeatedEdgeLines } from './noise.js';

const prose = 'Each player takes 4 actions on their turn, then draws 2 player cards.';

describe('line tests', () => {
  it('recognises prose, including wrapped fragments', () => {
    expect(looksLikeSentence(prose)).toBe(true);
    expect(looksLikeSentence('of the research station')).toBe(true);
    expect(looksLikeSentence('Lima.')).toBe(true);
    expect(looksLikeSentence('Atlanta Chicago Montreal')).toBe(false);
    expect(looksLikeSentence('2–4')).toBe(false);
  });
  it('recognises symbol and label lines', () => {
    for (const s of ['2–4', '★ ★ ★', '+1', '• •', '12', '©']) expect(isSymbolLine(s)).toBe(true);
    expect(isSymbolLine('draw 2')).toBe(false);
    expect(isLabelLine('Atlanta Chicago Montreal')).toBe(true);
    expect(isLabelLine('Ho Chi Minh City')).toBe(true);
    expect(isLabelLine('EPIDEMIC')).toBe(true);
    expect(isLabelLine('Hong Kong Bangkok Jakarta Manila Sydney')).toBe(false); // too long to be one label
    expect(isLabelLine('draw cards')).toBe(false);
  });
});

describe('filterNoise', () => {
  it('drops a column of map city labels but keeps the rules around it', () => {
    const page = ['Atlanta', 'Chicago', 'Montreal', 'New York', 'Washington', 'Atlanta Chicago Montreal', prose].join('\n');
    const r = filterNoise(page);
    expect(r.text).toBe(prose);
    expect(r.droppedLines).toEqual(['Atlanta', 'Chicago', 'Montreal', 'New York', 'Washington', 'Atlanta Chicago Montreal']);
  });
  it('drops card icon text and stray symbols', () => {
    const page = [prose, 'EPIDEMIC', '★ ★', '+1', 'Infect', 'Intensify'].join('\n');
    const r = filterNoise(page);
    expect(r.text).toBe(prose);
    expect(r.droppedLines).toEqual(['EPIDEMIC', '★ ★', '+1', 'Infect', 'Intensify']);
  });
  it('keeps headings followed by prose, including caps headings split over lines', () => {
    const page = 'SETUP\nPlace the board in the middle of the table.\n\nCONTINGENCY\nPLANNER\nDISPATCHER\nThe Dispatcher may move pawns.';
    const r = filterNoise(page);
    expect(r.text).toBe(page);
    expect(r.droppedLines).toEqual([]);
  });
  it('never drops a sentence, even short or repeated', () => {
    const page = 'Discard.\nYou win!\nOutbreaks: move the marker.';
    expect(filterNoise(page, new Set(['discard.'])).text).toBe(page);
  });
  it('keeps blank lines between paragraphs', () => {
    expect(filterNoise(`${prose}\n\n12\n\n${prose}`).text).toBe(`${prose}\n\n${prose}`);
  });
});

describe('repeated headers and footers', () => {
  const pages = [1, 2, 3, 4].map((n) => `Pandemic Rules\n${prose}\nThe game ends when players cure all 4 diseases.\nZ-Man Games ${n}`);
  it('finds lines on half the pages in the header/footer zone, ignoring page numbers', () => {
    const rep = repeatedEdgeLines(pages);
    expect(rep.has('pandemic rules')).toBe(true);
    expect(rep.has('z-man games #')).toBe(true);
  });
  it('needs at least 3 pages', () => {
    expect(repeatedEdgeLines(pages.slice(0, 2)).size).toBe(0);
  });
  it('removes them from every page and keeps the prose', () => {
    const out = filterPagesNoise(new Map(pages.map((p, i) => [i + 1, p])));
    for (const [n, r] of out) {
      expect(r.text).toBe(`${prose}\nThe game ends when players cure all 4 diseases.`);
      expect(r.droppedLines).toEqual(['Pandemic Rules', `Z-Man Games ${n}`]);
    }
  });
});

describe('chunkText applies the filter', () => {
  it('chunks hold rules prose, not map labels', () => {
    const text = `\n\n=== page 1 ===\nAtlanta\nChicago\nMontreal\nNew York\nWashington\nLondon\n${prose}`;
    const c = chunkText(text);
    expect(c).toHaveLength(1);
    expect(c[0]!.text).toBe(prose);
  });
});
