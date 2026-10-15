import { describe, expect, it } from 'vitest';
import { curatorDecision } from './curator.js';

describe('curatorDecision', () => {
  it('restores when quote is present and supported', () => expect(curatorDecision({ quoteFound: true, supported: true, judgeConfirmsWrong: null })).toBe('restore'));
  it('keeps when quote is gone and no judge', () => expect(curatorDecision({ quoteFound: false, supported: null, judgeConfirmsWrong: null })).toBe('keep'));
  it('keeps when not supported but no judge', () => expect(curatorDecision({ quoteFound: true, supported: false, judgeConfirmsWrong: null })).toBe('keep'));
  it('rejects only with judge confirmation', () => {
    expect(curatorDecision({ quoteFound: false, supported: null, judgeConfirmsWrong: true })).toBe('reject');
    expect(curatorDecision({ quoteFound: true, supported: false, judgeConfirmsWrong: true })).toBe('reject');
  });
  it('keeps when judge disagrees', () => expect(curatorDecision({ quoteFound: false, supported: false, judgeConfirmsWrong: false })).toBe('keep'));
  it('never rejects a supported claim even if judge says wrong', () => expect(curatorDecision({ quoteFound: true, supported: true, judgeConfirmsWrong: true })).toBe('restore'));
  it('keeps when the first-pass model errored', () => expect(curatorDecision({ quoteFound: true, supported: null, judgeConfirmsWrong: null })).toBe('keep'));
});
