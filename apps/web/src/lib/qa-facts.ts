import { buildQaFact } from '@rogue/core';
import { tally } from './faq';
import { ensureMigrated, getPool } from './services';

export interface QaFactsResult { created: number; skipped: number; reasons: Record<string, number> }

/**
 * User Q&A become facts: every well-rated, cited chat answer for a game is stored as a 'qa' claim with status needs_review
 * (never published here; an admin or the Curator approves it). Each cited page becomes a citation on the matching document.
 * Idempotent: a Q&A already stored for that edition is skipped. A row whose sources match no document is skipped, so no
 * claim is ever stored without a source.
 */
export async function createQaFacts(game: string): Promise<QaFactsResult> {
  const out: QaFactsResult = { created: 0, skipped: 0, reasons: {} };
  const skip = (reason: string) => { out.skipped++; out.reasons[reason] = (out.reasons[reason] ?? 0) + 1; };
  const pool = getPool(); if (!pool) return out;
  await ensureMigrated();
  const rows = await tally(game);
  for (const row of rows) {
    const fact = buildQaFact(row);
    if (!fact) { skip('not eligible'); continue; }
    // A source URL can belong to several editions' documents; the oldest document wins so repeated runs pick the same one.
    const docs = (await pool.query(
      `SELECT DISTINCT ON (s.url) s.url, d.id doc_id, d.edition_id FROM documents d JOIN sources s ON s.id=d.source_id
       JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
       WHERE g.slug=$1 AND s.url = ANY($2::text[]) ORDER BY s.url, d.id`,
      [game, [...new Set(fact.citations.map((c) => c.url))]])).rows as { url: string; doc_id: string; edition_id: string }[];
    const byUrl = new Map(docs.map((d) => [d.url, d]));
    const matched = fact.citations.filter((c) => byUrl.has(c.url));
    if (matched.length === 0) { skip('no matching document'); continue; }
    // One claim belongs to one edition: the first cited source decides it, and only sources of that edition are cited.
    const editionId = byUrl.get(matched[0].url)!.edition_id;
    const cites = matched.filter((c) => byUrl.get(c.url)!.edition_id === editionId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query("SELECT 1 FROM claims WHERE edition_id=$1 AND topic='qa' AND md5(body)=md5($2) LIMIT 1", [editionId, fact.body]);
      const cl = exists.rowCount ? null : await client.query(
        "INSERT INTO claims(edition_id, topic, body, status, created_by) VALUES ($1,'qa',$2,'needs_review','qa-facts') ON CONFLICT (edition_id, md5(body)) DO NOTHING RETURNING id",
        [editionId, fact.body]);
      if (!cl?.rowCount) { await client.query('ROLLBACK'); skip('already stored'); continue; }
      for (const c of cites) {
        await client.query('INSERT INTO citations(claim_id, document_id, locator) VALUES ($1,$2,$3)', [cl.rows[0].id, byUrl.get(c.url)!.doc_id, c.locator]);
      }
      await client.query('COMMIT');
      out.created++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['qa-facts', 'qa_facts_run', { game, ...out }]);
  return out;
}
