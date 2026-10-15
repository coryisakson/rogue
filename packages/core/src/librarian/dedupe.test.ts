import { describe, expect, it } from 'vitest';
import { findDuplicates, similarity } from './dedupe.js';

const c = (id: number, body: string, createdBy = 'librarian:x', topic = 'setup', playerCount: number | null = null) => ({ id, topic, playerCount, body, createdBy });

describe('dedupe', () => {
  it('similarity is high for paraphrases, low for different facts', () => {
    expect(similarity('Each player starts with 3 cards in a 3 player game', 'In a 3 player game each player starts with 3 cards')).toBeGreaterThan(0.7);
    expect(similarity('Build a research station by discarding a city card', 'Treat disease removes one cube')).toBeLessThan(0.2);
  });
  it('drops the librarian copy and keeps the hand-written claim', () => {
    const d = findDuplicates([
      c(10, 'In a 3-player game, players receive 3 cards.', 'librarian:x'),
      c(2, 'In a 3-player game each player starts with 3 cards.', 'hermes-seed'),
    ]);
    expect(d).toEqual([expect.objectContaining({ drop: 10, keep: 2 })]);
  });
  it('never merges across topics or player counts', () => {
    const body = 'Each player starts with 3 cards in the game.';
    expect(findDuplicates([c(1, body), c(2, body, 'librarian:x', 'turn')])).toEqual([]);
    expect(findDuplicates([c(1, body, 'librarian:x', 'setup', 3), c(2, body, 'librarian:x', 'setup', 4)])).toEqual([]);
  });
});
