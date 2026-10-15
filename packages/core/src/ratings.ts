/** Parse the rating form. Returns null for anything that is not a whole claim id and 1..5 stars. */
export function parseRating(form: { get(k: string): unknown }): { claimId: number; stars: number } | null {
  const claimId = Number(form.get('claim'));
  const stars = Number(form.get('stars'));
  if (!Number.isInteger(claimId) || claimId < 1 || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
  return { claimId, stars };
}

/** "4.3 (12)" style label; null when nobody has rated yet. */
export function ratingLabel(avg: number | null | undefined, count: number | null | undefined): string | null {
  if (!count || avg == null) return null;
  return `${avg.toFixed(1)} \u2605 (${count})`;
}

/** Parse the chat-answer vote form: whole answer id and verdict "up" or "down". */
export function parseAnswerVote(form: { get(k: string): unknown }): { answerId: number; helpful: boolean } | null {
  const answerId = Number(form.get('answer'));
  const v = String(form.get('vote') ?? '');
  if (!Number.isInteger(answerId) || answerId < 1 || (v !== 'up' && v !== 'down')) return null;
  return { answerId, helpful: v === 'up' };
}
