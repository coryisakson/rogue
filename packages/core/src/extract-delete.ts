/**
 * Admin delete of an extract (/admin/games/<slug>/extracts, Cory 2026-10-18: clean up garbage extractions).
 * An "extract" is a source's extracted text and what was derived from it: chunks, page quality, page overrides and
 * text-version proposals. The sources row, the private file and the URL stay, so the source shows as "not extracted"
 * and can be re-ingested or re-indexed. Pure helpers here; the database work is in apps/web/src/lib/extract-delete.ts.
 */

export const EXTRACT_DELETE_REASON_MAX = 300;
/** Highest page number the form accepts (rulebooks are far shorter; this only stops absurd input). */
export const EXTRACT_PAGE_MAX = 5000;

/** `page` null = the whole extract of the source; a number = only that page's chunks. */
export interface ExtractDeleteForm { sourceId: number; game: string; page: number | null; reason: string }

/** Form errors by code: the POST handler redirects back with ?err=<code> (no free text in the URL). */
export const EXTRACT_DELETE_ERRORS = {
  id: 'Bad source id.',
  game: 'Pick a game first.',
  page: `Bad page number (1 to ${EXTRACT_PAGE_MAX}).`,
  confirm: 'Type the source id exactly to confirm the delete.',
  really: 'Tick the box to confirm the delete.',
  reason: `Give a short reason (3 to ${EXTRACT_DELETE_REASON_MAX} characters; it goes to the audit log).`,
  missing: 'That source does not exist (any more) or does not belong to this game.',
  nothing: 'Nothing to delete: that source has no extract (or no chunks on that page).',
} as const;
export type ExtractDeleteError = keyof typeof EXTRACT_DELETE_ERRORS;

/** Same rules as the source delete form: repeat the source id, tick the box, give a reason; `page` is optional. */
export function parseExtractDeleteForm(f: Record<string, unknown>): { ok: true; value: ExtractDeleteForm } | { ok: false; code: ExtractDeleteError } {
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '').trim();
  const id = str('source');
  if (!/^[1-9][0-9]{0,15}$/.test(id)) return { ok: false, code: 'id' };
  const game = str('game');
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return { ok: false, code: 'game' };
  const pageRaw = str('page');
  let page: number | null = null;
  if (pageRaw) {
    if (!/^[1-9][0-9]{0,3}$/.test(pageRaw) || Number(pageRaw) > EXTRACT_PAGE_MAX) return { ok: false, code: 'page' };
    page = Number(pageRaw);
  }
  if (str('confirm') !== id) return { ok: false, code: 'confirm' };
  if (str('really') !== 'yes') return { ok: false, code: 'really' };
  const reason = str('reason').replace(/\s+/g, ' ');
  if (reason.length < 3 || reason.length > EXTRACT_DELETE_REASON_MAX) return { ok: false, code: 'reason' };
  return { ok: true, value: { sourceId: Number(id), game, page, reason } };
}

/** What a delete removes. The sources row, private file, URL, documents and citations are never in it. */
export interface ExtractDeletePlan {
  scope: 'source' | 'page';
  chunks: boolean;
  /** Clear sources.text_path and delete the text file (whole extract only). */
  textFile: boolean;
  pageQuality: boolean;
  pageOverrides: boolean;
  textVariants: boolean;
  /** Stored chat answers / FAQ entries citing the source stop being served (their text came from the old chunks). */
  answers: boolean;
}

/** Whole extract: everything derived from the text. One page: only that page's chunks (a re-index brings them back). */
export function planExtractDelete(page: number | null): ExtractDeletePlan {
  const whole = page === null;
  return { scope: whole ? 'source' : 'page', chunks: true, textFile: whole, pageQuality: whole, pageOverrides: whole, textVariants: whole, answers: true };
}

/** Is there anything to delete? Refuses a no-op so the audit log only records real deletes. */
export function extractDeleteHasWork(plan: ExtractDeletePlan, state: { hasText: boolean; chunks: number }): boolean {
  return plan.scope === 'source' ? state.hasText || state.chunks > 0 : state.chunks > 0;
}

/**
 * The text file path is the file's hash, so two sources with the same bytes share it. Delete the file only when no
 * other source still points at it.
 */
export function canDeleteTextFile(textPath: string | null, otherSourcesUsingIt: number): boolean {
  return !!textPath && otherSourcesUsingIt === 0;
}
