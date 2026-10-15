import type { ReviewAction } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

export interface QueueItem { id: string; game: string; topic: string; player_count: number | null; body: string; created_by: string; locator: string | null; quote: string | null; source_title: string; source_url: string }

/**
 * Exceptions only (docs/CURATION_POLICY.md): humans are not asked to check every claim. A claim lands here when
 * (a) it is in needs_review (source changed, or an agent was unsure), or (b) users rated it low (avg <= 2 from >= 3 ratings).
 * Claims a person already approved (verified_at set) stay out until their status changes again.
 */
export async function reviewQueue(game: string | null, limit: number, offset: number): Promise<{ total: number; items: QueueItem[] }> {
  const pool = getPool(); if (!pool) return { total: 0, items: [] };
  await ensureMigrated();
  const lowRated = `(SELECT count(*) >= 3 AND avg(stars) <= 2 FROM claim_ratings cr WHERE cr.claim_id=c.id)`;
  const where = `c.status IN ('published','needs_review') AND (c.status='needs_review' OR (c.verified_at IS NULL AND ${lowRated})) AND ($1::text IS NULL OR g.slug=$1)`;
  const from = `FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id
     LEFT JOIN citations ci ON ci.claim_id=c.id LEFT JOIN documents d ON d.id=ci.document_id LEFT JOIN sources s ON s.id=d.source_id`;
  const total = (await pool.query(`SELECT count(*)::int n ${from} WHERE ${where}`, [game])).rows[0].n as number;
  const items = (await pool.query(
    `SELECT c.id, g.slug game, c.topic, c.player_count, c.body, c.created_by, ci.locator, ci.quote, s.title source_title, s.url source_url
     ${from} WHERE ${where} ORDER BY c.id LIMIT $2 OFFSET $3`, [game, limit, offset])).rows;
  return { total, items };
}

/** Apply one review decision and write the audit entry. Edits keep the citation and mark the claim human-reviewed. */
export async function applyReview(a: ReviewAction, adminId: number): Promise<boolean> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const actor = `user:${adminId}`;
  let res;
  if (a.kind === 'approve') res = await pool.query("UPDATE claims SET verified_at=now(), status='published' WHERE id=$1 AND status IN ('published','needs_review')", [a.claimId]);
  else if (a.kind === 'edit') res = await pool.query("UPDATE claims SET body=$2, verified_at=now(), status='published' WHERE id=$1 AND status IN ('published','needs_review')", [a.claimId, a.body]);
  else res = await pool.query("UPDATE claims SET status='rejected', rejected_reason=$2, rejected_by=$3 WHERE id=$1 AND status IN ('published','needs_review')", [a.claimId, a.reason, actor]);
  if (!res.rowCount) return false;
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, `review_${a.kind}`, a]);
  return true;
}
