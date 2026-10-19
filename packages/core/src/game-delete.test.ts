import { describe, expect, it } from 'vitest';
import { gameDeleteBlock, parseGameDeleteForm } from './game-delete.js';

describe('game delete: allowed only for an empty game', () => {
  it('allows a game without sources, documents or published facts', () => {
    expect(gameDeleteBlock({ sources: 0, documents: 0, publishedClaims: 0 })).toBeNull();
  });
  it('refuses a game with any source or document', () => {
    expect(gameDeleteBlock({ sources: 1, documents: 0, publishedClaims: 0 })).toBe('sources');
    expect(gameDeleteBlock({ sources: 0, documents: 2, publishedClaims: 0 })).toBe('sources');
    expect(gameDeleteBlock({ sources: 1, documents: 1, publishedClaims: 5 })).toBe('sources');
  });
  it('refuses a game with published facts', () => {
    expect(gameDeleteBlock({ sources: 0, documents: 0, publishedClaims: 1 })).toBe('claims');
  });
});

describe('game delete: confirm form (security)', () => {
  const ok = { game: 'azul', confirm: 'azul', really: 'yes' };
  it('accepts a matching slug and the ticked box', () => {
    expect(parseGameDeleteForm(ok)).toEqual({ ok: true, value: { game: 'azul' } });
    expect(parseGameDeleteForm({ ...ok, confirm: ' azul ' })).toEqual({ ok: true, value: { game: 'azul' } });
  });
  it('refuses a bad slug', () => {
    for (const game of ['', 'Azul', '../x', 'a'.repeat(81), 'a b']) expect(parseGameDeleteForm({ ...ok, game, confirm: game })).toEqual({ ok: false, code: 'game' });
    expect(parseGameDeleteForm({ ...ok, game: 7 })).toEqual({ ok: false, code: 'game' });
  });
  it('refuses a missing or different confirmation', () => {
    expect(parseGameDeleteForm({ ...ok, confirm: '' })).toEqual({ ok: false, code: 'confirm' });
    expect(parseGameDeleteForm({ ...ok, confirm: 'Azul' })).toEqual({ ok: false, code: 'confirm' });
    expect(parseGameDeleteForm({ ...ok, confirm: 'pandemic' })).toEqual({ ok: false, code: 'confirm' });
  });
  it('refuses without the ticked box', () => {
    expect(parseGameDeleteForm({ ...ok, really: '' })).toEqual({ ok: false, code: 'really' });
    expect(parseGameDeleteForm({ game: 'azul', confirm: 'azul' })).toEqual({ ok: false, code: 'really' });
  });
});
