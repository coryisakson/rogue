import type { ReviewAction } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

export interface QueueItem { id: string; game: string; topic: string; player_count: number | null; body: string; created_by: string; locator: string | null; quote: string | null; source_title: string; source_url: string }

/** Published claims nobody has checked yet (verified_at is empty), oldest first. Draft/needs_review claims are included too. */
export async function reviewQueue(game: string | null, limit: number, offset: number): Promise<{ total: number; items: QueueItem[] }> {
  const pool = getPool(); if (!pool) return { total: 0, items: [] };
  await ensureMigrated();
  const where = `c.verified_at IS NULL AND c.status IN ('published','needs_review') AND ($1::text IS NULL OR g.slug=$1)`;
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
