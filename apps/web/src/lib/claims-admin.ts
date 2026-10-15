import { findDuplicates } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

/** Reject (not delete) claims so history and ratings stay; rejected claims disappear from every public view. */
export async function rejectClaims(opts: { ids?: number[]; createdBy?: string; reason: string; dry: boolean }) {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  if (!opts.ids?.length && !opts.createdBy) throw new Error('give ids=1,2,3 or created_by=prefix');
  const rows = (await pool.query(
    "SELECT id, left(body, 80) body FROM claims WHERE status='published' AND (id = ANY($1::bigint[]) OR ($2::text IS NOT NULL AND created_by LIKE $2 || '%')) ORDER BY id",
    [opts.ids ?? [], opts.createdBy ?? null])).rows;
  if (!opts.dry && rows.length) {
    await pool.query("UPDATE claims SET status='rejected' WHERE id = ANY($1::bigint[])", [rows.map((r: { id: number }) => r.id)]);
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['admin', 'reject_claims', { reason: opts.reason, ids: rows.map((r: { id: number }) => r.id) }]);
  }
  return { dry: opts.dry, count: rows.length, claims: rows };
}

/** Reject near-duplicate published claims within one game (see findDuplicates). */
export async function dedupeClaims(gameSlug: string, dry: boolean) {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const rows = (await pool.query(
    `SELECT c.id, c.topic, c.player_count, c.body, c.created_by FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 AND c.status='published' ORDER BY c.id`, [gameSlug])).rows;
  const dups = findDuplicates(rows.map((r: any) => ({ id: Number(r.id), topic: r.topic, playerCount: r.player_count, body: r.body, createdBy: r.created_by })));
  const byId = new Map(rows.map((r: any) => [Number(r.id), r.body as string]));
  if (!dry && dups.length) {
    await pool.query("UPDATE claims SET status='superseded' WHERE id = ANY($1::bigint[])", [dups.map((d) => d.drop)]);
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['admin', 'dedupe_claims', { game: gameSlug, dropped: dups }]);
  }
  return { dry, total: rows.length, duplicates: dups.map((d) => ({ ...d, dropBody: (byId.get(d.drop) ?? '').slice(0, 90), keepBody: (byId.get(d.keep) ?? '').slice(0, 90) })) };
}
