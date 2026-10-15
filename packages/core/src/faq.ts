/** Rules-chat FAQ rules. Pure functions so the thresholds are tested and easy to change. */

/** Votes needed before a question is public (also protects the asker: one person's question never goes public alone). */
export const FAQ_MIN_VOTES = 3;
/** Public FAQ needs at least this share of helpful votes; below LOW_SHARE the admin is asked to look. */
export const FAQ_MIN_SHARE = 0.6;
export const FAQ_LOW_SHARE = 0.5;

/** Same question typed slightly differently should count as one: lower-case, no punctuation, single spaces. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** "9 of 13 found this helpful" */
export function helpfulLabel(up: number, total: number): string {
  return `${up} of ${total} found this helpful`;
}

export function isFaqVisible(up: number, total: number, status: string | null): boolean {
  return status !== 'hidden' && total >= FAQ_MIN_VOTES && up / total >= FAQ_MIN_SHARE;
}

/** Needs an admin decision: enough votes, mostly unhelpful, not yet hidden or marked fine. */
export function needsFaqReview(up: number, total: number, status: string | null): boolean {
  return status == null && total >= FAQ_MIN_VOTES && up / total < FAQ_LOW_SHARE;
}

/** Admin form: question key + game + action hide|keep (+ reason for hide). */
export function parseFaqAction(form: { get(k: string): unknown }): { game: string; qnorm: string; action: 'hide' | 'keep'; reason: string } | { error: string } {
  const game = String(form.get('game') ?? '');
  const qnorm = String(form.get('q') ?? '');
  const action = String(form.get('action') ?? '');
  const reason = String(form.get('reason') ?? '').trim().slice(0, 300);
  if (!/^[a-z0-9-]{1,60}$/.test(game) || !qnorm || qnorm.length > 300) return { error: 'Bad question' };
  if (action !== 'hide' && action !== 'keep') return { error: 'Bad action' };
  if (action === 'hide' && reason.length < 3) return { error: 'Give a reason for removing it' };
  return { game, qnorm, action, reason };
}
