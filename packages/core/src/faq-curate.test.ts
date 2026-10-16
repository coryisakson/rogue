import { describe, expect, it } from 'vitest';
import { judgeCanonical, numbersIn, type FaqCandidate } from './faq-curate.js';

const url = 'https://example.com/rules.pdf';
const candidates: FaqCandidate[] = [
  { question_norm: 'how many cards do i draw', question: 'How many cards do I draw?', answer: 'You draw 2 cards at the end of your turn.', sources: [{ page: 4, url, title: 'Rules' }], up: 4, total: 5, status: null },
  { question_norm: 'how many cards are drawn each turn', question: 'How many cards are drawn each turn?', answer: 'Draw 2 player cards (p.4).', sources: [{ page: 4, url, title: 'Rules' }, { page: 5, url, title: 'Rules' }], up: 3, total: 3, status: 'kept' },
  { question_norm: 'can i trade cards', question: 'Can I trade cards?', answer: 'Yes, 1 card per action.', sources: [{ page: 7, url, title: 'Rules' }], up: 3, total: 4, status: 'hidden' },
];
const valid = { question: 'How many cards do I draw each turn?', answer: 'At the end of your turn you draw 2 player cards.', source_qnorms: ['how many cards do i draw', 'how many cards are drawn each turn'], citations: [{ page: 4, url }] };

describe('judgeCanonical', () => {
  it('accepts a valid merge and copies the cited source', () => {
    const r = judgeCanonical(valid, candidates);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source_qnorms).toHaveLength(2); expect(r.citations).toEqual([{ page: 4, url, section: null, title: 'Rules' }]); }
  });
  it('rejects an invented citation or none at all', () => {
    expect(judgeCanonical({ ...valid, citations: [{ page: 9, url }] }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, citations: [{ page: 4, url: 'https://other.example/x' }] }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, citations: [] }, candidates).ok).toBe(false);
    // p.5 backs the second merged answer, so it is allowed.
    expect(judgeCanonical({ ...valid, citations: [{ page: 5, url }] }, candidates).ok).toBe(true);
  });
  it('rejects an invented number', () => {
    expect(judgeCanonical({ ...valid, answer: 'You draw 3 player cards.' }, candidates).ok).toBe(false);
  });
  it('rejects a question of another game, a hidden one, or one already merged', () => {
    expect(judgeCanonical({ ...valid, source_qnorms: ['what is the meaning of life'] }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, source_qnorms: ['can i trade cards'], citations: [{ page: 7, url }], answer: 'Yes, 1 card.' }, candidates).ok).toBe(false);
    expect(judgeCanonical(valid, candidates, new Set(['how many cards do i draw'])).ok).toBe(false);
    expect(judgeCanonical({ ...valid, source_qnorms: [] }, candidates).ok).toBe(false);
  });
  it('rejects an empty or over-long answer and an over-long question', () => {
    expect(judgeCanonical({ ...valid, answer: '   ' }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, answer: 'draw '.repeat(130) }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, question: 'q'.repeat(201) }, candidates).ok).toBe(false);
    expect(judgeCanonical({ ...valid, question: '' }, candidates).ok).toBe(false);
  });
  it('reads numbers as written', () => {
    expect(numbersIn('Draw 2, then 1.5 or 1,000 cards (p.4).')).toEqual(['2', '1.5', '1,000', '4']);
  });
});
