import { describe, expect, it } from 'vitest';
import { judgeSourcePick, latestPicks, scoutJudgementNotes, type PickContext } from './judge.js';

const ctx: PickContext = {
  candidates: ['https://files.cdnhost.net/game-rules.pdf', 'https://www.publisher.com/game/faq'],
  publisherPage: 'https://www.publisher.com/game',
  approvedHosts: ['files.cdnhost.net'],
  robots: 'allowed',
};
const pick = (url: string, role = 'rulebook', reason = 'official rules PDF linked from the game page') => judgeSourcePick({ url, role, reason }, ctx);

describe('judgeSourcePick', () => {
  it('accepts a listed candidate on an approved host', () => {
    const p = pick('https://files.cdnhost.net/game-rules.pdf');
    expect(p.status).toBe('accepted');
  });
  it('rejects a foreign host that was not listed', () => {
    expect(pick('https://other-site.com/game-rules.pdf').status).toBe('rejected');
  });
  it('rejects an invented URL, even on a listed host', () => {
    expect(pick('https://files.cdnhost.net/made-up.pdf').status).toBe('rejected');
  });
  it('allows an unlisted address on the publisher page\'s own site, but only as needs_human when the site is unapproved', () => {
    const p = pick('https://www.publisher.com/game/errata', 'errata', 'errata page on the publisher site');
    expect(p.status).toBe('needs_human');
    expect(p.why).toMatch(/not approved/);
  });
  it('makes a listed candidate on an unapproved site needs_human', () => {
    expect(pick('https://www.publisher.com/game/faq', 'faq').status).toBe('needs_human');
  });
  it('rejects bad roles, missing reasons, aggregators and robots blocks', () => {
    expect(pick('https://files.cdnhost.net/game-rules.pdf', 'review').status).toBe('rejected');
    expect(pick('https://files.cdnhost.net/game-rules.pdf', 'rulebook', '  ').status).toBe('rejected');
    expect(judgeSourcePick({ url: 'https://boardgamegeek.com/file/1', role: 'rulebook', reason: 'x' }, { ...ctx, candidates: ['https://boardgamegeek.com/file/1'] }).status).toBe('rejected');
    expect(judgeSourcePick({ url: ctx.candidates[0], role: 'rulebook', reason: 'x' }, { ...ctx, robots: 'blocked' }).status).toBe('rejected');
    expect(judgeSourcePick({ url: 'http://files.cdnhost.net/game-rules.pdf', role: 'rulebook', reason: 'x' }, ctx).status).toBe('rejected');
    expect(judgeSourcePick({ url: 42, role: 'rulebook', reason: 'x' }, ctx).status).toBe('rejected');
  });
  it('never accepts when robots could not be checked', () => {
    expect(judgeSourcePick({ url: ctx.candidates[0], role: 'rulebook', reason: 'x' }, { ...ctx, robots: 'unknown' }).status).toBe('needs_human');
  });
});

describe('scout judgement notes', () => {
  const a = pick('https://files.cdnhost.net/game-rules.pdf');
  const f = pick('https://www.publisher.com/game/faq', 'faq', 'FAQ page');
  it('keeps the last decision per URL', () => {
    const later = { ...a, role: 'errata' };
    expect(latestPicks([a, f, later]).map((p) => p.role)).toEqual(['faq', 'errata']);
  });
  it('lists kept picks and warns when the rulebook differs from the request', () => {
    const notes = scoutJudgementNotes([a, f], 'done', 'https://other.com/rules.pdf');
    expect(notes.some((n) => n.includes('faq https://www.publisher.com/game/faq') && n.includes('needs you'))).toBe(true);
    expect(notes.some((n) => n.includes('different rulebook'))).toBe(true);
    expect(scoutJudgementNotes([a], 'done', a.url).some((n) => n.includes('different'))).toBe(false);
  });
  it('falls back to the code ranking when the job failed or picked nothing', () => {
    expect(scoutJudgementNotes([a], 'failed', null)[0]).toMatch(/code ranking/);
    expect(scoutJudgementNotes([pick('https://x.org/a.pdf')], 'done', null)[0]).toMatch(/found no official/);
  });
});
