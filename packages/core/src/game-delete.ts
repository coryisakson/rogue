/**
 * Admin delete of a game that has nothing in it (/admin/games/<slug>/sources, task admin-all-games): a game row with no
 * source, no document and no published fact, e.g. created by "Add as new game" or a request whose fetch never worked.
 * Pure helpers: whether the delete is allowed and the confirm form. The database work lives in apps/web/src/lib/game-delete.ts.
 */

/** What the game still has; any source, document or published fact blocks the delete (no claim may lose its source). */
export interface GameDeleteCounts { sources: number; documents: number; publishedClaims: number }

export const GAME_DELETE_ERRORS = {
  game: 'Bad game.',
  confirm: 'Type the game slug exactly to confirm the delete.',
  really: 'Tick the box to confirm the delete.',
  sources: 'This game still has sources. Delete them first; only a game without sources can be deleted.',
  claims: 'This game has published facts. Only a game without sources or published facts can be deleted.',
  missing: 'That game does not exist (any more).',
} as const;
export type GameDeleteError = keyof typeof GAME_DELETE_ERRORS;

/** Allowed only when the game has no source, no document and no published fact. Sources are reported before facts. */
export function gameDeleteBlock(c: GameDeleteCounts): GameDeleteError | null {
  if (c.sources > 0 || c.documents > 0) return 'sources';
  if (c.publishedClaims > 0) return 'claims';
  return null;
}

/**
 * The delete form must repeat the game slug in `confirm` and tick `really`, so a stray click or a form replayed for
 * another game cannot delete anything.
 */
export function parseGameDeleteForm(f: Record<string, unknown>): { ok: true; value: { game: string } } | { ok: false; code: GameDeleteError } {
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '').trim();
  const game = str('game');
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return { ok: false, code: 'game' };
  if (str('confirm') !== game) return { ok: false, code: 'confirm' };
  if (str('really') !== 'yes') return { ok: false, code: 'really' };
  return { ok: true, value: { game } };
}
