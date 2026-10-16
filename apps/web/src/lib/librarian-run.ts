import { DRAFT_SYSTEM, VERIFY_SYSTEM, parseDrafts, parseVerdict, quoteOnPage } from '@rogue/core';
import { ensureMigrated, getAi, getPool } from './services';
import { loadSourcePages } from './page-text';

export interface LibrarianStatus { running: boolean; game: string; page: number; pages: number; drafted: number; published: number; rejected: { reason: string; body: string }[]; startedAt: string; finishedAt?: string; error?: string }
let status: LibrarianStatus | null = null;
export const librarianStatus = (): LibrarianStatus | null => status;

/**
 * Librarian v0: for each page of a game's ingested rulebook, ask the chat model for cited claims, then
 * (1) require the quote to appear verbatim on that page, (2) ask the model to verify claim vs quote,
 * (3) publish only if both pass. Everything is attributed to created_by = librarian:<model> so it can be reviewed or bulk-rejected.
 */
export async function runLibrarian(gameSlug: string): Promise<void> {
  if (status?.running) return;
  const pool = getPool(); const ai = getAi();
  status = { running: true, game: gameSlug, page: 0, pages: 0, drafted: 0, published: 0, rejected: [], startedAt: new Date().toISOString() };
  try {
    if (!pool || !ai) throw new Error('database or AI not configured');
    await ensureMigrated();
    const doc = (await pool.query(
      `SELECT d.id doc_id, d.edition_id, s.id source_id, s.text_path FROM documents d JOIN sources s ON s.id=d.source_id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
       WHERE g.slug=$1 AND d.kind='rulebook' AND s.text_path IS NOT NULL AND s.availability='available' ORDER BY d.id LIMIT 1`, [gameSlug])).rows[0];
    if (!doc) throw new Error('no ingested, available rulebook for this game');
    // Effective text: repaired pages in, unreadable pages out (quality curation), so claims are not drafted from OCR noise.
    const sp = await loadSourcePages(Number(doc.source_id)); if (!sp) throw new Error('text file missing');
    const pages = sp.pages;
    status.pages = pages.size;
    const known = new Set<string>((await pool.query('SELECT lower(c.quote) q FROM citations c JOIN claims cl ON cl.id=c.claim_id WHERE cl.edition_id=$1', [doc.edition_id])).rows.map((r: { q: string }) => r.q));

    for (const [page, text] of pages) {
      status.page = page;
      if (text.length < 200) continue;
      let drafts;
      try {
        const r = await ai.chat({ temperature: 0, maxTokens: 4000, messages: [{ role: 'system', content: DRAFT_SYSTEM }, { role: 'user', content: `Rulebook page ${page}:\n\n${text.slice(0, 6000)}` }] });
        drafts = parseDrafts(r.text);
      } catch (e) { status.rejected.push({ reason: `page ${page} model error: ${(e as Error).message.slice(0, 120)}`, body: '' }); continue; }
      for (const d of drafts) {
        status.drafted++;
        if (!quoteOnPage(d.quote, text)) { status.rejected.push({ reason: `p.${page} quote not verbatim`, body: d.body }); continue; }
        if (known.has(d.quote.toLowerCase())) { status.rejected.push({ reason: `p.${page} already covered`, body: d.body }); continue; }
        let ok = false;
        try {
          const v = await ai.chat({ temperature: 0, maxTokens: 1500, messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: `Claim: ${d.body}\n\nQuote: ${d.quote}` }] });
          ok = parseVerdict(v.text);
        } catch { ok = false; }
        if (!ok) { status.rejected.push({ reason: `p.${page} verifier: not supported`, body: d.body }); continue; }
        const cl = await pool.query(
          "INSERT INTO claims(edition_id, topic, player_count, body, status, created_by) VALUES ($1,$2,$3,$4,'draft',$5) ON CONFLICT (edition_id, md5(body)) DO NOTHING RETURNING id",
          [doc.edition_id, d.topic, d.playerCount, d.body, `librarian:${process.env['ROGUE_AI_CHAT_MODEL'] ?? 'local'}`]);
        if (!cl.rowCount) continue;
        await pool.query('INSERT INTO citations(claim_id, document_id, locator, quote) VALUES ($1,$2,$3,$4)', [cl.rows[0].id, doc.doc_id, `p.${page}`, d.quote]);
        await pool.query("UPDATE claims SET status='published' WHERE id=$1", [cl.rows[0].id]);
        known.add(d.quote.toLowerCase());
        status.published++;
      }
    }
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['librarian', 'draft_claims', { game: gameSlug, drafted: status.drafted, published: status.published, rejected: status.rejected.length }]);
  } catch (e) { status.error = (e as Error).message; }
  finally { status!.running = false; status!.finishedAt = new Date().toISOString(); }
}
