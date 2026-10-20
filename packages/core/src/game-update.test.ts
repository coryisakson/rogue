import { describe, expect, it } from 'vitest';
import {
  GAME_UPDATE_STEPS, finalUpdateStatus, initialStepRecords, isStepRecords, needsDrafting, nextStep, orderSteps, parseUpdateSteps,
  sourcesToDraft, stepCounts, updateProgressText, type StepRecord,
} from './game-update.js';

describe('game update step selection', () => {
  it('"all" selects every step in run order', () => {
    expect(parseUpdateSteps(['all'])).toEqual({ ok: true, steps: [...GAME_UPDATE_STEPS] });
    expect(parseUpdateSteps(['draft', 'all'])).toEqual({ ok: true, steps: [...GAME_UPDATE_STEPS] });
  });
  it('single steps come back in run order without duplicates', () => {
    expect(parseUpdateSteps(['rebuild', 'recheck', 'rebuild'])).toEqual({ ok: true, steps: ['recheck', 'rebuild'] });
    expect(parseUpdateSteps([' draft '])).toEqual({ ok: true, steps: ['draft'] });
  });
  it('rejects no step and unknown steps', () => {
    expect(parseUpdateSteps([])).toMatchObject({ ok: false });
    expect(parseUpdateSteps(['', ' '])).toMatchObject({ ok: false });
    expect(parseUpdateSteps(['recheck', 'delete'])).toMatchObject({ ok: false });
  });
  it('orders steps as recheck, ingest, extract, draft, supersede, rebuild', () => {
    expect(orderSteps(['rebuild', 'supersede', 'draft', 'extract', 'ingest', 'recheck'])).toEqual(['recheck', 'ingest', 'extract', 'draft', 'supersede', 'rebuild']);
  });
});

describe('game update records and progress', () => {
  it('starts pending and resumes at the first unfinished step (a running step after a restart runs again)', () => {
    const r = initialStepRecords(['rebuild', 'recheck']);
    expect(r).toEqual([{ step: 'recheck', status: 'pending', line: '' }, { step: 'rebuild', status: 'pending', line: '' }]);
    expect(nextStep(r)?.step).toBe('recheck');
    const resumed: StepRecord[] = [{ step: 'recheck', status: 'ok', line: '3 rechecked' }, { step: 'rebuild', status: 'running', line: '' }];
    expect(nextStep(resumed)?.step).toBe('rebuild');
    expect(nextStep([{ step: 'recheck', status: 'skipped', line: '' }])).toBeNull();
  });
  it('validates stored step lists', () => {
    expect(isStepRecords(initialStepRecords(['draft']))).toBe(true);
    expect(isStepRecords([])).toBe(false);
    expect(isStepRecords([{ step: 'nope', status: 'ok', line: '' }])).toBe(false);
    expect(isStepRecords([{ step: 'draft', status: 'weird', line: '' }])).toBe(false);
    expect(isStepRecords({})).toBe(false);
  });
  it('writes one progress line while running and totals when finished', () => {
    const r: StepRecord[] = [
      { step: 'recheck', status: 'ok', line: '' }, { step: 'ingest', status: 'skipped', line: '' }, { step: 'extract', status: 'running', line: '' },
    ];
    expect(updateProgressText(r, 'waiting for job #4')).toBe('step 3/3 (Extractor review of unsure PDF pages): waiting for job #4; 1 ok, 1 skipped, 0 failed');
    r[2]!.status = 'failed';
    expect(updateProgressText(r)).toBe('finished: 1 ok, 1 skipped, 1 failed');
    expect(stepCounts(r)).toEqual({ ok: 1, skipped: 1, failed: 1, pending: 0 });
    expect(finalUpdateStatus(r)).toBe('failed');
    r[2]!.status = 'ok';
    expect(finalUpdateStatus(r)).toBe('done');
  });
});

describe('which sources need drafting', () => {
  const src = { sourceId: 32, kind: 'rulebook', available: true, hasText: true, claims: 0 };
  it('drafts an available rulebook or wiki page with text and no claims', () => {
    expect(needsDrafting(src, false)).toBe(true);
    expect(needsDrafting({ ...src, kind: 'wiki' }, false)).toBe(true);
  });
  it('does not redraft a drafted source unless asked', () => {
    expect(needsDrafting({ ...src, claims: 12 }, false)).toBe(false);
    expect(needsDrafting({ ...src, claims: 12 }, true)).toBe(true);
  });
  it('never drafts unavailable, retired, text-less or non-rules sources', () => {
    expect(needsDrafting({ ...src, available: false }, true)).toBe(false);
    expect(needsDrafting({ ...src, hasText: false }, true)).toBe(false);
    expect(needsDrafting({ ...src, kind: 'faq' }, true)).toBe(false);
  });
  it('lists source ids ascending (Space Base: 32 drafted, retired 11 not)', () => {
    expect(sourcesToDraft([src, { ...src, sourceId: 11, available: false }, { ...src, sourceId: 5, claims: 3 }, src], false)).toEqual([32]);
    expect(sourcesToDraft([src, { ...src, sourceId: 5, claims: 3 }], true)).toEqual([5, 32]);
  });
});
