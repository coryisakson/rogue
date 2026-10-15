/** Parse the claim review form (approve / reject / edit). Returns an error string for anything unusable. */
export type ReviewAction =
  | { kind: 'approve'; claimId: number }
  | { kind: 'reject'; claimId: number; reason: string }
  | { kind: 'edit'; claimId: number; body: string };

export const MAX_CLAIM_CHARS = 600;

export function parseReview(form: { get(k: string): unknown }): ReviewAction | { error: string } {
  const claimId = Number(form.get('claim'));
  if (!Number.isInteger(claimId) || claimId < 1) return { error: 'bad claim id' };
  const text = (k: string) => String(form.get(k) ?? '').replace(/\s+/g, ' ').trim();
  switch (form.get('action')) {
    case 'approve': return { kind: 'approve', claimId };
    case 'reject': return { kind: 'reject', claimId, reason: text('reason').slice(0, 300) || 'rejected in review' };
    case 'edit': {
      const body = text('body');
      // Why a cap: claims are short facts, never pasted rulebook text (rights rule 2).
      if (body.length < 10 || body.length > MAX_CLAIM_CHARS) return { error: `claim must be 10-${MAX_CLAIM_CHARS} characters` };
      return { kind: 'edit', claimId, body };
    }
    default: return { error: 'unknown action' };
  }
}
