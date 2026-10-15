import { describe, expect, it } from 'vitest';
import { parseDrafts, parseVerdict, quoteOnPage } from './librarian.js';

describe('librarian helpers', () => {
  it('quoteOnPage ignores case, whitespace and curly quotes but not content', () => {
    const page = 'Players   start with\nthree cards each.  The player with the highest city population\u2019s first.';
    expect(quoteOnPage('players start with three cards each', page)).toBe(true);
    expect(quoteOnPage("highest city population's first", page)).toBe(true);
    expect(quoteOnPage('players start with four cards each', page)).toBe(false);
    expect(quoteOnPage('short', 'short')).toBe(false); // too short to prove anything
  });
  it('parseDrafts keeps valid claims only', () => {
    const reply = 'Sure!\n```json\n[{"topic":"setup","player_count":3,"body":"Each player starts with three cards.","quote":"3-player game 3 cards"},{"topic":"bogus","body":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","quote":"q"},{"topic":"turn","body":"short","quote":"q"},{"topic":"goal","player_count":99,"body":"Win by finding every cure together.","quote":"win or lose together"}]\n```';
    const d = parseDrafts(reply);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ topic: 'setup', playerCount: 3 });
    expect(d[1]?.playerCount).toBeNull();
    expect(parseDrafts('no json')).toEqual([]);
    expect(parseDrafts('[not json]')).toEqual([]);
  });
  it('parseVerdict is strict', () => {
    expect(parseVerdict('SUPPORTED')).toBe(true);
    expect(parseVerdict(' supported.')).toBe(true);
    expect(parseVerdict('NOT_SUPPORTED')).toBe(false);
    expect(parseVerdict('Not supported because')).toBe(false);
    expect(parseVerdict('maybe')).toBe(false);
  });
});
