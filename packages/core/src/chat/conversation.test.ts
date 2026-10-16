import { describe, expect, it } from 'vitest';
import { loadServices } from '../config.js';
import { DailyCounter } from '../security/ratelimit.js';
import { buildPrompt } from './chat.js';
import {
  MAX_THREAD_TURNS, THREAD_LIMIT_MESSAGE, answerMaxTokens, checkChatBudget, historyBlock, parseHistory, parseRewrite,
  rewriteQuestion, stripCitations, trimHistory, type ChatTurn,
} from './conversation.js';

const turn = (i: number, a = `Answer ${i} (p.${i}).`): ChatTurn => ({ q: `Question ${i}?`, a });

describe('parseHistory', () => {
  it('keeps only well-formed string pairs, clipped, last 12', () => {
    const raw = [...Array.from({ length: 20 }, (_, i) => turn(i)), { q: 5 }, null, { q: 'x'.repeat(999), a: 'y'.repeat(9999) }];
    const h = parseHistory(raw);
    expect(h.length).toBe(MAX_THREAD_TURNS - 2); // 12 newest entries, two of them malformed
    expect(h.at(-1)!.q.length).toBe(300);
    expect(h.at(-1)!.a.length).toBe(4000);
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory([{ q: '  ', a: 'x' }])).toEqual([]);
  });
});

describe('trimHistory', () => {
  it('strips citation blocks before measuring', () => {
    expect(stripCitations('Hand limit is 7 (p.6). Discard (pp. 4, 7) down. See "Setup" (s.2).')).toBe('Hand limit is 7. Discard down. See "Setup".');
    expect(trimHistory([turn(1)])).toEqual([{ q: 'Question 1?', a: 'Answer 1.' }]);
  });
  it('keeps the most recent turns in order, at most maxTurns', () => {
    const h = trimHistory(Array.from({ length: 10 }, (_, i) => turn(i)), { maxTurns: 6, maxChars: 4000 });
    expect(h.map((t) => t.q)).toEqual([4, 5, 6, 7, 8, 9].map((i) => `Question ${i}?`));
  });
  it('truncates the oldest kept answer to fit maxChars and drops older turns', () => {
    const long = (i: number) => ({ q: `Q${i}`, a: 'w'.repeat(100) });
    const h = trimHistory([long(1), long(2), long(3)], { maxChars: 150 });
    expect(h.map((t) => t.q)).toEqual(['Q2', 'Q3']);
    expect(h[1]!.a.length).toBe(100);
    expect(h[0]!.a.endsWith('…')).toBe(true);
    expect(h.reduce((n, t) => n + t.q.length + t.a.length, 0)).toBeLessThanOrEqual(150);
  });
  it('returns nothing for an empty thread', () => {
    expect(trimHistory([])).toEqual([]);
    expect(historyBlock([])).toBe('');
  });
});

describe('answer prompt with history', () => {
  it('puts the conversation first and keeps the original question', () => {
    const p = buildPrompt('And the medic?', [{ page: 3, text: 'Medic removes all cubes.' }], {
      conversation: historyBlock([{ q: 'What does treat disease do?', a: 'Remove 1 cube.' }]), standalone: 'What does the Medic do when treating disease?',
    });
    expect(p.startsWith('Conversation so far:\nUser: What does treat disease do?\nAssistant: Remove 1 cube.')).toBe(true);
    expect(p).toContain('Question: And the medic?\n(Read as: What does the Medic do when treating disease?)');
  });
});

describe('rewriteQuestion', () => {
  const history = [{ q: 'What does the Medic do?', a: 'Removes all cubes of one colour.' }];
  const result = (text: string) => ({ text, model: 'm', promptTokens: 40, completionTokens: 12 });
  it('skips the model when there is no history', async () => {
    let called = false;
    const ai = { chat: async () => { called = true; return result('x'); } };
    expect((await rewriteQuestion(ai, [], 'How many actions?')).standalone).toBe('How many actions?');
    expect(called).toBe(false);
  });
  it('uses the standalone question without thinking and a tiny budget', async () => {
    let req: any;
    const ai = { chat: async (r: any) => { req = r; return result('Standalone question: "Can the Medic remove cubes on a cured disease?"\n'); } };
    const r = await rewriteQuestion(ai, history, 'and when cured?');
    expect(r).toEqual({ standalone: 'Can the Medic remove cubes on a cured disease?', promptTokens: 40, completionTokens: 12, rewritten: true });
    expect(req).toMatchObject({ temperature: 0, maxTokens: 120, reasoning: 'none' });
    expect(req.messages[1].content).toContain('Last question: and when cured?');
  });
  it('falls back to the raw question when the model fails or returns junk', async () => {
    const boom = { chat: async () => { throw new Error('HTTP 503'); } };
    expect(await rewriteQuestion(boom, history, 'and when cured?')).toMatchObject({ standalone: 'and when cured?', rewritten: false });
    const empty = { chat: async () => result('  \n ') };
    expect((await rewriteQuestion(empty, history, 'and when cured?')).standalone).toBe('and when cured?');
    expect(parseRewrite('x'.repeat(400), 'raw')).toBe('raw');
    expect((await rewriteQuestion(null, history, 'raw q')).standalone).toBe('raw q');
  });
});

describe('checkChatBudget', () => {
  it('counts turns and warns from turn 10', () => {
    expect(checkChatBudget({ priorTurns: 0, usedToday: 0, dailyLimit: 60 })).toEqual({ ok: true, turn: 1, warn: false });
    expect(checkChatBudget({ priorTurns: 9, usedToday: 0, dailyLimit: 60 })).toEqual({ ok: true, turn: 10, warn: true });
    expect(checkChatBudget({ priorTurns: 11, usedToday: 0, dailyLimit: 60 })).toEqual({ ok: true, turn: 12, warn: true });
  });
  it('refuses a 13th turn, for admins too', () => {
    expect(checkChatBudget({ priorTurns: 12, usedToday: 0, dailyLimit: 60, admin: true })).toEqual({ ok: false, limit: 'thread', message: THREAD_LIMIT_MESSAGE });
  });
  it('enforces the daily limit except for admins', () => {
    expect(checkChatBudget({ priorTurns: 0, usedToday: 60, dailyLimit: 60 })).toMatchObject({ ok: false, limit: 'daily' });
    expect(checkChatBudget({ priorTurns: 0, usedToday: 59, dailyLimit: 60 }).ok).toBe(true);
    expect(checkChatBudget({ priorTurns: 0, usedToday: 500, dailyLimit: 60, admin: true }).ok).toBe(true);
  });
  it('daily counter resets at UTC midnight', () => {
    let t = Date.UTC(2026, 9, 16, 23, 59);
    const c = new DailyCounter(() => t);
    expect(c.count('u1')).toBe(0);
    c.add('u1');
    expect(c.add('u1')).toBe(2);
    expect(c.count('u2')).toBe(0);
    t = Date.UTC(2026, 9, 17, 0, 1);
    expect(c.count('u1')).toBe(0);
  });
});

describe('answer reasoning config', () => {
  it('defaults to low thinking and 60 asks a day', () => {
    expect(loadServices({})).toMatchObject({ aiAnswerReasoning: 'low', chatDailyLimit: 60 });
    expect(loadServices({ ROGUE_AI_ANSWER_REASONING: 'none', ROGUE_CHAT_DAILY_LIMIT: '5' })).toMatchObject({ aiAnswerReasoning: 'none', chatDailyLimit: 5 });
    expect(loadServices({ ROGUE_AI_ANSWER_REASONING: 'bogus', ROGUE_CHAT_DAILY_LIMIT: '-1' })).toMatchObject({ aiAnswerReasoning: 'low', chatDailyLimit: 60 });
  });
  it('lowers the answer cap with less thinking; list answers stay wide', () => {
    expect(answerMaxTokens(false, 'none')).toBeLessThan(answerMaxTokens(false, 'low'));
    expect(answerMaxTokens(false, 'low')).toBeLessThan(answerMaxTokens(false, 'default'));
    expect(answerMaxTokens(true, 'none')).toBe(4000);
  });
});
