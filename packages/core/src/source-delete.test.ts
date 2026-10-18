import { describe, expect, it } from 'vitest';
import { citesUrl, parseSourceDeleteForm, planClaimRejections } from './source-delete.js';

describe('source delete: claim plan', () => {
  it('rejects claims cited only by the deleted source and keeps claims with another source', () => {
    const plan = planClaimRejections([
      { claimId: 3, sourceId: 7 }, { claimId: 3, sourceId: 7 }, // two citations, same source: still only this source
      { claimId: 1, sourceId: 7 }, { claimId: 1, sourceId: 9 },
      { claimId: 2, sourceId: 9 },
      { claimId: 4, sourceId: 7 },
    ], 7);
    expect(plan).toEqual({ reject: [3, 4], keep: [1] });
  });
  it('touches nothing when no claim cites the source', () => {
    expect(planClaimRejections([{ claimId: 1, sourceId: 2 }], 7)).toEqual({ reject: [], keep: [] });
    expect(planClaimRejections([], 7)).toEqual({ reject: [], keep: [] });
  });
});

describe('source delete: cached answers', () => {
  const url = 'https://example.com/rules.pdf';
  it('finds the url in a stored source list', () => {
    expect(citesUrl([{ url: 'https://other.example/a' }, { url }], url)).toBe(true);
    expect(citesUrl([{ url: 'https://other.example/a' }], url)).toBe(false);
    expect(citesUrl(null, url)).toBe(false);
    expect(citesUrl([], url)).toBe(false);
  });
});

describe('source delete: confirm form (security)', () => {
  const base = { source: '12', game: 'pandemic', confirm: '12', really: 'yes', reason: 'wrong edition, inaccurate' };
  it('accepts a complete form', () => {
    expect(parseSourceDeleteForm(base)).toEqual({ ok: true, value: { sourceId: 12, game: 'pandemic', reason: 'wrong edition, inaccurate', allowReingest: false } });
    const r = parseSourceDeleteForm({ ...base, reingest: 'yes' });
    expect(r.ok && r.value.allowReingest).toBe(true);
  });
  it('needs the source id repeated exactly in confirm', () => {
    for (const confirm of ['', '13', '012', '12 ; DROP', undefined]) expect(parseSourceDeleteForm({ ...base, confirm }).ok).toBe(false);
  });
  it('reports a stable error code the page can show', () => {
    expect(parseSourceDeleteForm({ ...base, confirm: '1' })).toEqual({ ok: false, code: 'confirm' });
    expect(parseSourceDeleteForm({ ...base, reason: '' })).toEqual({ ok: false, code: 'reason' });
  });
  it('needs the confirm box ticked', () => {
    expect(parseSourceDeleteForm({ ...base, really: undefined }).ok).toBe(false);
    expect(parseSourceDeleteForm({ ...base, really: 'on' }).ok).toBe(false);
  });
  it('refuses bad ids, bad game slugs and odd field types', () => {
    for (const source of ['0', '-1', '1.5', 'abc', '', '1e3', '99999999999999999']) expect(parseSourceDeleteForm({ ...base, source, confirm: source }).ok).toBe(false);
    for (const game of ['', 'Pandemic', '../x', 'a b']) expect(parseSourceDeleteForm({ ...base, game }).ok).toBe(false);
    expect(parseSourceDeleteForm({ ...base, source: 12 as unknown as string }).ok).toBe(false);
  });
  it('needs a short reason, collapses whitespace and caps the length', () => {
    expect(parseSourceDeleteForm({ ...base, reason: ' ' }).ok).toBe(false);
    expect(parseSourceDeleteForm({ ...base, reason: 'x'.repeat(301) }).ok).toBe(false);
    const r = parseSourceDeleteForm({ ...base, reason: '  bad\n\n scan ' });
    expect(r.ok && r.value.reason).toBe('bad scan');
  });
});
