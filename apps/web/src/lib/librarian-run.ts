import { DRAFT_SYSTEM, MIN_DRAFT_PAGE_CHARS, VERIFY_SYSTEM, parseDrafts, parseVerdict, screenDraft } from '@rogue/core';
import { agentsEnabled, enqueueOrOpenJob, getJob, runNextJob, type JobState } from './agent-jobs';
import { ensureMigrated, getAi, getPool } from './services';
import { loadSourcePages } from './page-text';

export interface LibrarianStatus { running: boolean; game: string; page: number; pages: number; drafted: number; published: number; rejected: { reason: string; body: string }[]; startedAt: string; finishedAt?: string; error?: string }
let status: LibrarianStatus | null = null;
export const librarianStatus = (): LibrarianStatus | null => status;

const RULEBOOK_SQL = `SELECT d.id doc_id, d.edition_id, s.id source_id, s.text_path FROM documents d JOIN sources s ON s.id=d.source_id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
       WHERE g.slug=$1 AND d.kind='rulebook' AND s.text_path IS NOT NULL AND s.availability='available' ORDER BY d.id LIMIT 1`;

/** The rulebook source the Librarian drafts from for a game, or null when none is ingested and available. */
export async function librarianSourceId(gameSlug: string): Promise<number | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(RULEBOOK_SQL, [gameSlug])).rows[0];
  return r ? Number(r.source_id) : null;
}

/**
 * Start drafting for a game. With the agents sidecar on, this queues a `librarian_draft` job for the Nanobot Librarian (ADR 0002)
 * and returns its id; otherwise the in-process runLibrarian below is the fallback.
 */
export async function startLibrarian(gameSlug: string, sourceId?: number): Promise<{ mode: 'agent'; jobId: number } | { mode: 'local' } | { error: string }> {
  if (!agentsEnabled()) { void runLibrarian(gameSlug); return { mode: 'local' }; }
  return queueLibrarianJob(gameSlug, sourceId);
}

/** The given source id if it is an available rulebook of this game, else null. */
async function gameRulebookSource(gameSlug: string, sourceId: number): Promise<number | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = await pool.query(`SELECT s.id FROM documents d JOIN sources s ON s.id=d.source_id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
    WHERE g.slug=$1 AND s.id=$2 AND d.kind='rulebook' AND s.text_path IS NOT NULL AND s.availability='available' LIMIT 1`, [gameSlug, sourceId]);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/** Queue (or find the open) `librarian_draft` job for a game's rulebook. */
export async function queueLibrarianJob(gameSlug: string, onlySourceId?: number): Promise<{ mode: 'agent'; jobId: number } | { error: string }> {
  // By default the first rulebook; an explicit source (e.g. the English copy of a game whose first rulebook is German) must be one of this game's rulebooks.
  const sourceId = onlySourceId ? await gameRulebookSource(gameSlug, onlySourceId) : await librarianSourceId(gameSlug);
  if (!sourceId) return { error: 'no ingested, available rulebook for this game' };
  const jobId = await enqueueOrOpenJob('librarian_draft', sourceId);
  if (jobId === null) return { error: 'could not queue the Librarian job' };
  void runNextJob(); // start now if the queue is idle; otherwise the worker tick picks it up
  return { mode: 'agent', jobId };
}

/** One line of progress for a Librarian agent job, from its status and result counters. */
export function describeLibrarianJob(j: JobState): string {
  const r = j.result as { pages?: number; lastPage?: number; drafted?: number; published?: number; rejected?: number };
  const counts = `${r.published ?? 0} cited facts published, ${r.rejected ?? 0} rejected by the gates`;
  if (j.status === 'queued') return `Librarian agent: queued (job #${j.id})${j.error ? `, retrying after: ${j.error.slice(0, 80)}` : ''}`;
  if (j.status === 'running') return `Librarian agent drafting: page ${r.lastPage ?? '-'} (${r.pages ?? '?'} pages to read), ${counts}`;
  if (j.status === 'failed') return `Librarian agent failed: ${(j.error ?? 'unknown').slice(0, 120)}`;
  return `${j.status === 'done' ? 'done' : 'needs a person'}: ${counts}`;
}

/** Wait for a Librarian job to end, reporting progress. Gives up waiting (the job carries on) after `maxMinutes`. */
export async function waitForLibrarianJob(jobId: number, onProgress: (text: string) => unknown, maxMinutes = 240): Promise<JobState | null> {
  for (let waited = 0; waited < maxMinutes * 60_000; waited += 15_000) {
    const j = await getJob(jobId);
    if (!j) return null;
    await onProgress(describeLibrarianJob(j));
    if (j.status !== 'queued' && j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return getJob(jobId);
}

/**
 * Librarian v0 (in-process fallback when the agents sidecar is off): for each page of a game's ingested rulebook, ask the chat model for cited claims, then
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
    const doc = (await pool.query(RULEBOOK_SQL, [gameSlug])).rows[0];
    if (!doc) throw new Error('no ingested, available rulebook for this game');
    // Effective text: repaired pages in, unreadable pages out (quality curation), so claims are not drafted from OCR noise.
    const sp = await loadSourcePages(Number(doc.source_id)); if (!sp) throw new Error('text file missing');
    const pages = sp.pages;
    status.pages = pages.size;
    const known = new Set<string>((await pool.query('SELECT lower(c.quote) q FROM citations c JOIN claims cl ON cl.id=c.claim_id WHERE cl.edition_id=$1', [doc.edition_id])).rows.map((r: { q: string }) => r.q));

    for (const [page, text] of pages) {
      status.page = page;
      if (text.length < MIN_DRAFT_PAGE_CHARS) continue;
      let drafts;
      try {
        const r = await ai.chat({ temperature: 0, maxTokens: 4000, messages: [{ role: 'system', content: DRAFT_SYSTEM }, { role: 'user', content: `Rulebook page ${page}:\n\n${text.slice(0, 6000)}` }] });
        drafts = parseDrafts(r.text);
      } catch (e) { status.rejected.push({ reason: `page ${page} model error: ${(e as Error).message.slice(0, 120)}`, body: '' }); continue; }
      for (const d of drafts) {
        status.drafted++;
        const gate = screenDraft(d, text, known);
        if (gate) { status.rejected.push({ reason: `p.${page} ${gate}`, body: d.body }); continue; }
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
