import { describe, expect, it } from 'vitest';
import { buildQaFact, QA_MAX_ANSWER, qaClaimBody, qaEligibility, qaLocator, type QaRow } from './qa-facts.js';

const src = { page: 4, section: 'Setup', title: 'Rules', url: 'https://ex.com/rules.pdf' };
const row = (o: Partial<QaRow> = {}): QaRow => ({ question: 'How many cards?', answer: 'Seven.', sources: [src], total: 5, up: 4, status: null, ...o });

describe('qa-facts eligibility', () => {
  it('accepts a well-rated, cited answer', () => expect(qaEligibility(row())).toEqual({ ok: true }));
  it('needs enough votes and helpful share (same thresholds as the public FAQ)', () => {
    expect(qaEligibility(row({ total: 2, up: 2 })).ok).toBe(false);
    expect(qaEligibility(row({ total: 5, up: 2 })).ok).toBe(false);
  });
  it('skips admin-hidden questions', () => expect(qaEligibility(row({ status: 'hidden' }))).toEqual({ ok: false, reason: 'hidden by an admin' }));
  it('accepts kept questions', () => expect(qaEligibility(row({ status: 'kept' })).ok).toBe(true));
  it('needs at least one source with a page', () => {
    expect(qaEligibility(row({ sources: null })).ok).toBe(false);
    expect(qaEligibility(row({ sources: [] })).ok).toBe(false);
    expect(qaEligibility(row({ sources: [{ ...src, page: null }] })).ok).toBe(false);
    expect(qaEligibility(row({ sources: [{ ...src, page: 0 }] })).ok).toBe(false);
  });
  it('rejects empty text', () => expect(qaEligibility(row({ answer: '  ' })).ok).toBe(false));
});

describe('qa-facts body and locators', () => {
  it('builds a one-line Q/A body', () => expect(qaClaimBody(' How many\ncards? ', 'Seven,\n\n each turn.')).toBe('Q: How many cards? A: Seven, each turn.'));
  it('cuts very long answers', () => {
    const b = qaClaimBody('Q?', 'x'.repeat(QA_MAX_ANSWER + 50));
    expect(b.endsWith('…')).toBe(true);
    expect(b.length).toBe('Q: Q? A: '.length + QA_MAX_ANSWER);
  });
  it('formats locators with and without section', () => {
    expect(qaLocator(src)).toBe('p.4 Setup');
    expect(qaLocator({ ...src, section: null })).toBe('p.4');
    expect(qaLocator({ ...src, section: '  Turn   order ' })).toBe('p.4 Turn order');
  });
  it('buildQaFact keeps paged sources once each', () => {
    const fact = buildQaFact(row({ sources: [src, { ...src }, { ...src, page: null }, { ...src, page: 9, section: null }] }));
    expect(fact).toEqual({
      body: 'Q: How many cards? A: Seven.',
      citations: [{ url: src.url, page: 4, locator: 'p.4 Setup' }, { url: src.url, page: 9, locator: 'p.9' }],
    });
  });
  it('buildQaFact returns null for ineligible rows', () => expect(buildQaFact(row({ status: 'hidden' }))).toBeNull());
});
