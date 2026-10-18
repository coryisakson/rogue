import { canDeleteTextFile, extractDeleteHasWork, planExtractDelete } from '@rogue/core';
import { forgetAnswersCiting } from './chat';
import { hideAnswersCiting } from './source-delete';
import { ensureMigrated, getPool, storage } from './services';

/**
 * Admin delete of an extract (/admin/games/<slug>/extracts, Cory 2026-10-18). Removes a source's extracted text and what
 * was derived from it (chunks, page quality, page overrides, text-version proposals) but keeps the sources row, the
 * private file and the URL, so the source shows as "not extracted" and "Re-ingest now" makes it again. Claims and their
 * citations stay: they cite the document, which still exists. Stored answers citing the URL are hidden like a source
 * delete does (their text came from the old chunks). One page: only that page's chunks; a re-index brings them back.
 * The rules for what goes are in planExtractDelete (packages/core/src/extract-delete.ts).
 */

export interface ExtractDeletePreview { id: number; url: string; title: string | null; hasText: boolean; chunks: number; pageChunks: number | null }
export interface ExtractDeleteResult extends ExtractDeletePreview { page: number | null; textFile: boolean; pageQuality: number; overrides: number; variants: number; answersHidden: number; faqHidden: number }

export async function extractDeletePreview(sourceId: number, page: number | null = null): Promise<ExtractDeletePreview | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `SELECT s.id, s.url, s.title, s.text_path IS NOT NULL has_text,
       (SELECT count(*)::int FROM chunks c WHERE c.source_id=s.id) chunks,
       (SELECT count(*)::int FROM chunks c WHERE c.source_id=s.id AND c.page=$2) page_chunks
     FROM sources s WHERE s.id=$1`, [sourceId, page ?? 0])).rows[0];
  if (!r) return null;
  return { id: Number(r.id), url: r.url, title: r.title, hasText: !!r.has_text, chunks: Number(r.chunks), pageChunks: page === null ? null : Number(r.page_chunks) };
}

/**
 * Delete the extract (or one page's chunks) in one transaction; the text file goes after the commit. Returns null when
 * the source is gone, 'nothing' when there is nothing to delete (no audit entry for a no-op).
 */
export async function deleteExtract(sourceId: number, page: number | null, actor: string, reason: string): Promise<ExtractDeleteResult | 'nothing' | null> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const plan = planExtractDelete(page);
  const c = await pool.connect();
  let out: ExtractDeleteResult;
  let removeFile: string | null = null;
  try {
    await c.query('BEGIN');
    const s = (await c.query('SELECT id, url, title, text_path FROM sources WHERE id=$1 FOR UPDATE', [sourceId])).rows[0];
    if (!s) { await c.query('ROLLBACK'); return null; }
    const n = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rowCount ?? 0;
    const allChunks = Number((await c.query('SELECT count(*)::int n FROM chunks WHERE source_id=$1', [sourceId])).rows[0].n);
    const target = plan.scope === 'page' ? Number((await c.query('SELECT count(*)::int n FROM chunks WHERE source_id=$1 AND page=$2', [sourceId, page])).rows[0].n) : allChunks;
    if (!extractDeleteHasWork(plan, { hasText: !!s.text_path, chunks: target })) { await c.query('ROLLBACK'); return 'nothing'; }

    const chunks = plan.scope === 'page' ? await n('DELETE FROM chunks WHERE source_id=$1 AND page=$2', [sourceId, page]) : await n('DELETE FROM chunks WHERE source_id=$1', [sourceId]);
    const pageQuality = plan.pageQuality ? await n('DELETE FROM page_quality WHERE source_id=$1', [sourceId]) : 0;
    const overrides = plan.pageOverrides ? await n('DELETE FROM page_overrides WHERE source_id=$1', [sourceId]) : 0;
    const variants = plan.textVariants ? await n('DELETE FROM text_variants WHERE source_id=$1', [sourceId]) : 0;
    let textFile = false;
    if (plan.textFile && s.text_path) {
      const others = Number((await c.query('SELECT count(*)::int n FROM sources WHERE text_path=$1 AND id<>$2', [s.text_path, sourceId])).rows[0].n);
      if (canDeleteTextFile(s.text_path, others)) removeFile = s.text_path;
      await n('UPDATE sources SET text_path=NULL WHERE id=$1', [sourceId]);
      // Queued curator/scout jobs would only fail on the missing text.
      await n("UPDATE agent_jobs SET status='failed', error='extract deleted by an admin' WHERE source_id=$1 AND status='queued'", [sourceId]);
      textFile = true;
    }
    const { answersHidden, faqHidden } = await hideAnswersCiting(c, s.url);
    out = {
      id: Number(s.id), url: s.url, title: s.title, hasText: !!s.text_path, chunks, pageChunks: plan.scope === 'page' ? chunks : null,
      page, textFile, pageQuality, overrides, variants, answersHidden, faqHidden,
    };
    // Counts and ids only; never text.
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'extract_deleted', {
      sourceId, url: s.url, reason, scope: plan.scope, page, chunks, textFile, fileRemoved: !!removeFile, pageQuality, overrides, variants, answersHidden, faqHidden,
    }]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
  // Files cannot roll back, so the text goes only after the commit. The private copy stays for re-indexing.
  if (removeFile) await storage.delete(removeFile).catch(() => false);
  forgetAnswersCiting(out.url);
  return out;
}
