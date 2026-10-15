import { describe, expect, it } from 'vitest';
import { parseReview } from './review.js';

const f = (o: Record<string, string>) => new URLSearchParams(o);
describe('parseReview', () => {
  it('approves', () => expect(parseReview(f({ claim: '5', action: 'approve' }))).toEqual({ kind: 'approve', claimId: 5 }));
  it('rejects with default reason', () => expect(parseReview(f({ claim: '5', action: 'reject' }))).toEqual({ kind: 'reject', claimId: 5, reason: 'rejected in review' }));
  it('keeps a reason', () => expect(parseReview(f({ claim: '5', action: 'reject', reason: ' wrong  page ' }))).toMatchObject({ reason: 'wrong page' }));
  it('edits and normalises whitespace', () => expect(parseReview(f({ claim: '5', action: 'edit', body: 'Each player\n draws  four cards.' }))).toEqual({ kind: 'edit', claimId: 5, body: 'Each player draws four cards.' }));
  it('refuses too short or too long edits', () => {
    expect('error' in parseReview(f({ claim: '5', action: 'edit', body: 'short' }))).toBe(true);
    expect('error' in parseReview(f({ claim: '5', action: 'edit', body: 'x'.repeat(601) }))).toBe(true);
  });
  it('refuses bad ids and actions', () => {
    for (const o of [{ claim: '0', action: 'approve' }, { claim: 'x', action: 'approve' }, { claim: '1', action: 'nuke' }, {}])
      expect('error' in parseReview(f(o as Record<string, string>))).toBe(true);
  });
});
