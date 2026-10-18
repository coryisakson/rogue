/**
 * Admin hard delete of a source (/admin/sources, Cory 2026-10-18: some sources are inaccurate and must go).
 * Pure helpers: which claims lose their only evidence, whether a stored answer cites the source, and the confirm form.
 * The database work lives in apps/web/src/lib/source-delete.ts.
 */

/** One citation of a claim, reduced to the source it points at. */
export interface ClaimCitation { claimId: number; sourceId: number }

/**
 * Claims that cite only `sourceId` are rejected (no claim without a source); claims that also cite another source
 * stay and just lose the citations to this one. Both lists are sorted and without duplicates.
 */
export function planClaimRejections(citations: ClaimCitation[], sourceId: number): { reject: number[]; keep: number[] } {
  const touched = new Set<number>();
  const elsewhere = new Set<number>();
  for (const c of citations) {
    if (c.sourceId === sourceId) touched.add(c.claimId);
    else elsewhere.add(c.claimId);
  }
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  return {
    reject: sorted([...touched].filter((id) => !elsewhere.has(id))),
    keep: sorted([...touched].filter((id) => elsewhere.has(id))),
  };
}

/** Does a stored answer's source list (chat answer or canonical FAQ entry) cite this URL? */
export function citesUrl(sources: { url?: unknown }[] | null | undefined, url: string): boolean {
  return Array.isArray(sources) && sources.some((s) => s && s.url === url);
}

export const SOURCE_DELETE_REASON_MAX = 300;

export interface SourceDeleteForm { sourceId: number; game: string; reason: string; allowReingest: boolean }

/** Form errors by code: the POST handler redirects back with ?err=<code> and the page shows the message (no free text in the URL). */
export const SOURCE_DELETE_ERRORS = {
  id: 'Bad source id.',
  game: 'Pick a game first.',
  confirm: 'Type the source id exactly to confirm the delete.',
  really: 'Tick the box to confirm the delete.',
  reason: `Give a short reason (3 to ${SOURCE_DELETE_REASON_MAX} characters; it goes to the audit log).`,
  missing: 'That source does not exist (any more) or does not belong to this game.',
} as const;
export type SourceDeleteError = keyof typeof SOURCE_DELETE_ERRORS;

/**
 * The delete form must repeat the source id in `confirm` and tick `really` (a stray click or a replayed form for a
 * different row cannot delete anything), and give a reason for the audit log.
 */
export function parseSourceDeleteForm(f: Record<string, unknown>): { ok: true; value: SourceDeleteForm } | { ok: false; code: SourceDeleteError } {
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '').trim();
  const id = str('source');
  if (!/^[1-9][0-9]{0,15}$/.test(id)) return { ok: false, code: 'id' };
  const game = str('game');
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return { ok: false, code: 'game' };
  if (str('confirm') !== id) return { ok: false, code: 'confirm' };
  if (str('really') !== 'yes') return { ok: false, code: 'really' };
  const reason = str('reason').replace(/\s+/g, ' ');
  if (reason.length < 3 || reason.length > SOURCE_DELETE_REASON_MAX) return { ok: false, code: 'reason' };
  return { ok: true, value: { sourceId: Number(id), game, reason, allowReingest: str('reingest') === 'yes' } };
}
