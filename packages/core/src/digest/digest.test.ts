import { describe, it, expect } from 'vitest';
import { isRecheckDue, formatDigest } from './digest';

describe('isRecheckDue', () => {
  it('runs when never run, after 04:00 UTC', () => {
    expect(isRecheckDue(new Date('2026-10-15T05:00:00Z'))).toBe(true);
  });
  it('waits before 04:00 UTC', () => {
    expect(isRecheckDue(new Date('2026-10-15T02:00:00Z'))).toBe(false);
  });
  it('waits until 7 days have passed', () => {
    expect(isRecheckDue(new Date('2026-10-20T05:00:00Z'), '2026-10-15T05:00:00Z')).toBe(false);
    expect(isRecheckDue(new Date('2026-10-22T05:00:00Z'), '2026-10-15T05:00:00Z')).toBe(true);
  });
  it('treats a garbage timestamp as never run', () => {
    expect(isRecheckDue(new Date('2026-10-15T05:00:00Z'), 'nope')).toBe(true);
  });
});

describe('formatDigest', () => {
  it('summarises and lists only sources needing attention', () => {
    const t = formatDigest([
      { url: 'https://a/ok.pdf', outcome: 'unchanged', detail: '' },
      { url: 'https://a/gone.pdf', outcome: 'unavailable', detail: '404' },
    ], '2026-10-15');
    expect(t).toContain('unchanged: 1, unavailable: 1');
    expect(t).toContain('gone.pdf');
    expect(t).not.toContain('ok.pdf');
  });
  it('stays under the Discord limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ url: 'https://x/' + 'a'.repeat(300) + i, outcome: 'changed', detail: 'd' }));
    expect(formatDigest(many, 'd').length).toBeLessThan(2000);
  });
});
