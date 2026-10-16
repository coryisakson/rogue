import { describe, expect, it } from 'vitest';
import { classifyNoAnswer, improvementQueue, parseUnansweredAction, unansweredKey } from './unanswered.js';
const src = [{ page: 3 }];
const f = (o: Record<string, string>) => ({ get: (k: string) => o[k] });
describe('unanswered', () => {
  it('classifies errors, no sources and empty answers', () => {
    expect(classifyNoAnswer({ error: new Error('AI offline') })).toBe('error');
    expect(classifyNoAnswer({ answer: 'I could not find anything about this in the indexed rulebook for this game.', sources: [] })).toBe('no_sources');
    expect(classifyNoAnswer({ answer: '   ', sources: src })).toBe('empty');
  });
  it('classifies refusals without citations', () => {
    expect(classifyNoAnswer({ answer: 'The excerpts do not contain this rule. Please check the official rulebook.', sources: src })).toBe('refusal');
    expect(classifyNoAnswer({ answer: "I can't find the answer in the provided excerpts.", sources: src })).toBe('refusal');
    expect(classifyNoAnswer({ answer: 'This is not covered by the rulebook excerpts.', sources: src })).toBe('refusal');
  });
  it('treats cited or plain answers as answered', () => {
    expect(classifyNoAnswer({ answer: 'You draw 2 cards at the end of your turn (p.4).', sources: src })).toBeNull();
    expect(classifyNoAnswer({ answer: 'The excerpts do not mention trading, but each player may share knowledge (p.7).', sources: src })).toBeNull();
    expect(classifyNoAnswer({ answer: 'Yes, you may move through any city.', sources: src })).toBeNull();
  });
  it('dedupes the same question per game, however it was typed', () => {
    expect(unansweredKey('pandemic', 'Can I TRADE cards??')).toEqual(unansweredKey('pandemic', '  can i trade cards '));
    expect(unansweredKey('pandemic', 'Can I trade cards?')).not.toEqual(unansweredKey('slay-the-spire', 'Can I trade cards?'));
    expect(unansweredKey('pandemic', '?!')).toBeNull();
    expect(unansweredKey('Bad Game', 'Can I trade cards?')).toBeNull();
  });
  it('merges both reasons into one queue, most affected first', () => {
    const q = improvementQueue([
      { reason: 'low_rating' as const, game_slug: 'p', question_norm: 'a', question: 'A', count: 3 },
      { reason: 'no_answer' as const, game_slug: 'p', question_norm: 'b', question: 'B', count: 5 },
    ]);
    expect(q.map((x) => x.reason)).toEqual(['no_answer', 'low_rating']);
  });
  it('parses the admin form', () => {
    expect(parseUnansweredAction(f({ game: 'pandemic', q: 'can i trade', action: 'dismiss' }))).toEqual({ game: 'pandemic', qnorm: 'can i trade', action: 'dismiss' });
    expect(parseUnansweredAction(f({ game: 'pandemic', q: 'x', action: 'hide' }))).toHaveProperty('error');
  });
});
