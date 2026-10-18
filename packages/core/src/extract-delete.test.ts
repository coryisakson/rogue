import { describe, expect, it } from 'vitest';
import { canDeleteTextFile, extractDeleteHasWork, parseExtractDeleteForm, planExtractDelete } from './extract-delete.js';

describe('extract delete: confirm form (security)', () => {
  const base = { source: '12', game: 'pandemic', confirm: '12', really: 'yes', reason: 'garbled OCR' };
  it('accepts a whole-extract form and a single-page form', () => {
    expect(parseExtractDeleteForm(base)).toEqual({ ok: true, value: { sourceId: 12, game: 'pandemic', page: null, reason: 'garbled OCR' } });
    const r = parseExtractDeleteForm({ ...base, page: '7' });
    expect(r.ok && r.value.page).toBe(7);
  });
  it('needs the source id repeated and the box ticked', () => {
    for (const confirm of ['', '13', '012', undefined]) expect(parseExtractDeleteForm({ ...base, confirm })).toEqual({ ok: false, code: 'confirm' });
    expect(parseExtractDeleteForm({ ...base, really: 'on' })).toEqual({ ok: false, code: 'really' });
  });
  it('refuses bad ids, game slugs and page numbers', () => {
    for (const source of ['0', '-1', 'abc', '', '1e3']) expect(parseExtractDeleteForm({ ...base, source, confirm: source }).ok).toBe(false);
    for (const game of ['', 'Pandemic', '../x']) expect(parseExtractDeleteForm({ ...base, game })).toEqual({ ok: false, code: 'game' });
    for (const page of ['0', '-2', '1.5', 'x', '5001', '99999']) expect(parseExtractDeleteForm({ ...base, page })).toEqual({ ok: false, code: 'page' });
    expect(parseExtractDeleteForm({ ...base, source: 12 as unknown as string }).ok).toBe(false);
  });
  it('needs a short reason and collapses whitespace', () => {
    expect(parseExtractDeleteForm({ ...base, reason: ' ' })).toEqual({ ok: false, code: 'reason' });
    expect(parseExtractDeleteForm({ ...base, reason: 'x'.repeat(301) }).ok).toBe(false);
    const r = parseExtractDeleteForm({ ...base, reason: ' bad \n scan ' });
    expect(r.ok && r.value.reason).toBe('bad scan');
  });
});

describe('extract delete: plan', () => {
  it('whole extract: text and everything derived, never the source itself', () => {
    const p = planExtractDelete(null);
    expect(p).toEqual({ scope: 'source', chunks: true, textFile: true, pageQuality: true, pageOverrides: true, textVariants: true, answers: true });
    expect(Object.keys(p)).not.toContain('sourceRow');
  });
  it('one page: only its chunks', () => {
    expect(planExtractDelete(3)).toEqual({ scope: 'page', chunks: true, textFile: false, pageQuality: false, pageOverrides: false, textVariants: false, answers: true });
  });
  it('refuses a no-op', () => {
    expect(extractDeleteHasWork(planExtractDelete(null), { hasText: false, chunks: 0 })).toBe(false);
    expect(extractDeleteHasWork(planExtractDelete(null), { hasText: true, chunks: 0 })).toBe(true);
    expect(extractDeleteHasWork(planExtractDelete(null), { hasText: false, chunks: 4 })).toBe(true);
    expect(extractDeleteHasWork(planExtractDelete(2), { hasText: true, chunks: 0 })).toBe(false);
    expect(extractDeleteHasWork(planExtractDelete(2), { hasText: true, chunks: 1 })).toBe(true);
  });
  it('keeps a text file another source still uses', () => {
    expect(canDeleteTextFile('private/sources/abc.txt', 0)).toBe(true);
    expect(canDeleteTextFile('private/sources/abc.txt', 1)).toBe(false);
    expect(canDeleteTextFile(null, 0)).toBe(false);
  });
});
