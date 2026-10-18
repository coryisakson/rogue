import { planClaimRejections, type ClaimCitation } from '@rogue/core';
import { forgetAnswersCiting } from './chat';
import { ensureMigrated, getPool, storage } from './services';
import type pg from 'pg';

/**
 * Admin hard delete of one source (/admin/games/<slug>/sources, Cory 2026-10-18: some sources are inaccurate and must be removed).
 * Unlike takedown() (lifecycle.ts), the sources row itself goes, with everything derived from it:
 *   - claims cited ONLY by this source are rejected ('source deleted'); claims with other sources just lose these citations;
 *   - citations, documents, chunks, agent jobs, rights grants, page quality/overrides and text variants of this source;
 *   - stored chat answers and canonical FAQ entries that cite its URL stop being served (text cleared / hidden);
 *   - the private copy and the extracted text on disk.
 * Unless the admin allows re-ingest, the URL is tombstoned (ingest, recheck and "add source" all refuse tombstoned URLs,
 * also for static seeds and approved game requests) and its admin-added seed row is removed. retired_at (0040) is not
 * enough here: it lives on the sources row, which is deleted.
 */

export interface SourceDeletePreview { id: number; url: string; title: string | null; chunks: number; claimsRejected: number; claimsKept: number }
export interface SourceDeleteResult extends SourceDeletePreview { files: number; tombstoned: boolean; answersHidden: number; faqHidden: number }

type Q = Pick<pg.PoolClient, 'query'>;

/**
 * Stored answers that cite the URL: chat answers lose their text (the FAQ tally only shows rows with text, like answers
 * with a citation warning), canonical FAQ entries are hidden. Also used by the extract delete (lib/extract-delete.ts);
 * the caller runs forgetAnswersCiting(url) after its commit.
 */
export async function hideAnswersCiting(q: Q, url: string): Promise<{ answersHidden: number; faqHidden: number }> {
  const cited = JSON.stringify([{ url }]);
  const answersHidden = (await q.query('UPDATE chat_answers SET answer=NULL, sources=NULL WHERE answer IS NOT NULL AND sources @> $1::jsonb', [cited])).rowCount ?? 0;
  const faqHidden = (await q.query("UPDATE faq_canonical SET status='hidden' WHERE status='published' AND sources @> $1::jsonb", [cited])).rowCount ?? 0;
  return { answersHidden, faqHidden };
}

/** What a delete would do: shown on the confirm form, and recomputed inside the delete transaction. */
async function plan(q: Q, sourceId: number, lock = false) {
  const s = (await q.query(`SELECT id, url, title, private_path, text_path FROM sources WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [sourceId])).rows[0];
  if (!s) return null;
  // Every citation of every claim that cites this source, so we can tell "only this source" from "also another one".
  const cites: ClaimCitation[] = (await q.query(
    `SELECT ci.claim_id, d.source_id FROM citations ci JOIN documents d ON d.id=ci.document_id
     WHERE ci.claim_id IN (SELECT ci2.claim_id FROM citations ci2 JOIN documents d2 ON d2.id=ci2.document_id WHERE d2.source_id=$1)`, [sourceId],
  )).rows.map((r) => ({ claimId: Number(r.claim_id), sourceId: Number(r.source_id) }));
  const claims = planClaimRejections(cites, sourceId);
  const chunks = Number((await q.query('SELECT count(*)::int n FROM chunks WHERE source_id=$1', [sourceId])).rows[0].n);
  return { s, claims, chunks };
}

/** The delete form names a game; refuse a source id from another game (stale page, edited form). */
export async function sourceInGame(slug: string, sourceId: number): Promise<boolean> {
  const pool = getPool(); if (!pool) return false;
  const r = await pool.query('SELECT 1 FROM documents d JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND d.source_id=$2', [slug, sourceId]);
  return !!r.rowCount;
}

export async function sourceDeletePreview(sourceId: number): Promise<SourceDeletePreview | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const p = await plan(pool, sourceId);
  if (!p) return null;
  return { id: Number(p.s.id), url: p.s.url, title: p.s.title, chunks: p.chunks, claimsRejected: p.claims.reject.length, claimsKept: p.claims.keep.length };
}

/** Permanently delete a source and everything derived from it, in one transaction; files are removed after the commit. */
export async function deleteSource(sourceId: number, actor: string, reason: string, allowReingest = false): Promise<SourceDeleteResult | null> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const c = await pool.connect();
  let out: SourceDeleteResult;
  let paths: string[];
  try {
    await c.query('BEGIN');
    const p = await plan(c, sourceId, true);
    if (!p) { await c.query('ROLLBACK'); return null; }
    const { s, claims, chunks } = p;
    paths = [s.private_path, s.text_path].filter((x): x is string => !!x);
    const n = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rowCount ?? 0;

    await n("UPDATE claims SET status='rejected', rejected_reason='source deleted', rejected_by=$2 WHERE id = ANY($1::bigint[]) AND status <> 'rejected'", [claims.reject, actor]);
    await n('DELETE FROM citations WHERE document_id IN (SELECT id FROM documents WHERE source_id=$1)', [sourceId]);
    await n('UPDATE claim_disproofs SET source_id=NULL WHERE source_id=$1', [sourceId]); // keep the evidence text, drop the link
    const grants = await n('DELETE FROM rights_grants WHERE source_id=$1', [sourceId]);
    await n('DELETE FROM documents WHERE source_id=$1', [sourceId]);
    await n('DELETE FROM chunks WHERE source_id=$1', [sourceId]);
    const jobs = await n('DELETE FROM agent_jobs WHERE source_id=$1', [sourceId]);
    // page_quality, page_overrides and text_variants (as the PDF) cascade; runtime_sources.replaces_source_id and
    // text_variants.variant_source_id are set to NULL by their foreign keys.

    const { answersHidden, faqHidden } = await hideAnswersCiting(c, s.url);

    let tombstoned = false;
    if (!allowReingest) {
      if (!(await c.query('SELECT 1 FROM tombstones WHERE url=$1', [s.url])).rowCount) {
        await c.query('INSERT INTO tombstones(url, reason) VALUES ($1,$2)', [s.url, `source deleted by ${actor}: ${reason}`]);
      }
      tombstoned = true;
      await n('DELETE FROM runtime_sources WHERE url=$1', [s.url]);
      // A text version (found by the Scout) that pointed at this URL must not stay 'accepted', or allSeeds() keeps listing it.
      await n("UPDATE text_variants SET status='rejected', reason=COALESCE(reason,'') || ' (source deleted by an admin)' WHERE url=$1 AND status='accepted'", [s.url]);
    }
    await n('DELETE FROM sources WHERE id=$1', [sourceId]);

    out = {
      id: Number(s.id), url: s.url, title: s.title, chunks, claimsRejected: claims.reject.length, claimsKept: claims.keep.length,
      files: paths.length, tombstoned, answersHidden, faqHidden,
    };
    // Counts and ids only; never source text.
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'source_deleted', {
      sourceId, url: s.url, reason, chunks, claimsRejected: claims.reject.length, claimsKept: claims.keep.length, rejectedClaimIds: claims.reject,
      files: paths.length, rightsGrants: grants, agentJobs: jobs, answersHidden, faqHidden, tombstoned, allowReingest,
    }]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
  // Files cannot roll back, so they go only after the commit. A missing file is fine.
  for (const path of paths) await storage.delete(path).catch(() => false);
  forgetAnswersCiting(out.url);
  return out;
}
