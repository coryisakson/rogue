import { ocrProviderFromEnv, pagesNeedingExtractReview, scorePage, type PageCandidates, type PageQuality } from '@rogue/core';
import { agentsEnabled, enqueueOrOpenJob, getJob, runNextJob, type JobRow, type JobState } from './agent-jobs';
import { loadSourcePages } from './page-text';
import { pdfTextLayer } from './pdf-adapter';
import { ensureMigrated, getPool, ipv4Fetch, storage } from './services';
import { settingsEnv } from './settings';

/**
 * Extract review (ADR 0005; the Reviewer's `extract_review` skill, ADR 0007). For the few PDF pages code is unsure about, the
 * agent compares the PDF text layer with OCR text and proposes which to keep (or a merge); acceptPageChoice in core decides.
 *
 * Both candidates are rebuilt on demand instead of storing a second text file: the text layer is re-read from the private PDF
 * copy (fast, no model), and the stored page text is the other candidate when ingest used OCR for it. When ingest kept the text
 * layer, OCR runs on demand for that page only (at most OCR_PER_JOB per job). Accepted choices become page overrides
 * (method 'extract'), so loadSourcePages and indexSource see them like Quality Curator repairs.
 */
export type StoredFrom = 'text_layer' | 'ocr';
const OCR_PER_JOB = 8;
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

// Text layers of recently reviewed PDFs, by content hash (a job reads the same file page after page).
const layerCache = new Map<string, string[]>();
async function textLayerOf(privatePath: string, hash: string): Promise<string[] | null> {
  const hit = layerCache.get(hash); if (hit) return hit;
  const pdf = await storage.get(privatePath); if (!pdf) return null;
  const pages = await pdfTextLayer(new Uint8Array(pdf));
  if (layerCache.size >= 4) layerCache.delete(layerCache.keys().next().value!);
  layerCache.set(hash, pages);
  return pages;
}

interface PdfSource { privatePath: string; hash: string }
async function pdfSource(sourceId: number): Promise<PdfSource | null> {
  const s = (await getPool()!.query('SELECT private_path, content_type, content_hash FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!s?.private_path || !s.content_hash || !/pdf/i.test(String(s.content_type ?? ''))) return null;
  return { privatePath: String(s.private_path), hash: String(s.content_hash) };
}

/**
 * Find the unsure pages of a PDF source and record them in page_extract (same file hash only; earlier choices are kept).
 * Pages already repaired by the Quality Curator or left out as unusable are not offered. Returns how many pages are still open.
 */
export async function prepareExtractReview(sourceId: number): Promise<{ open: number; unsure: number } | { error: string }> {
  const pool = getPool(); if (!pool) return { error: 'database not available' };
  await ensureMigrated();
  const src = await pdfSource(sourceId); if (!src) return { error: 'only PDF sources have a text layer and OCR to compare' };
  const sp = await loadSourcePages(sourceId); if (!sp) return { error: 'this source has no stored text' };
  const layer = await textLayerOf(src.privatePath, src.hash); if (!layer) return { error: 'the private PDF copy is missing' };
  const repaired = new Set<number>((await pool.query("SELECT page FROM page_overrides WHERE source_id=$1 AND content_hash=$2 AND method <> 'extract'", [sourceId, src.hash])).rows.map((r) => Number(r.page)));
  const scores = new Map<number, PageQuality>(); const textLayer = new Map<number, string>(); const ocr = new Map<number, string>();
  const stored = new Map<number, StoredFrom>();
  for (const [page, text] of sp.raw) {
    if (sp.unusable.has(page) || repaired.has(page)) continue;
    const tl = layer[page - 1] ?? '';
    // Ingest stored either the text layer as is or OCR text; anything that differs from the text layer came from OCR.
    const from: StoredFrom = norm(text) === norm(tl) ? 'text_layer' : 'ocr';
    stored.set(page, from);
    scores.set(page, scorePage(text));
    textLayer.set(page, tl);
    if (from === 'ocr') ocr.set(page, text);
  }
  const unsure = pagesNeedingExtractReview(scores, textLayer, ocr);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM page_extract WHERE source_id=$1 AND content_hash <> $2', [sourceId, src.hash]);
    for (const u of unsure) {
      await client.query(
        `INSERT INTO page_extract(source_id, page, content_hash, stored, reasons) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (source_id, page) DO UPDATE SET reasons=EXCLUDED.reasons, stored=EXCLUDED.stored WHERE page_extract.choice IS NULL`,
        [sourceId, u.page, src.hash, stored.get(u.page), u.reasons]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { open: (await openExtractPages(sourceId)).length, unsure: unsure.length };
}

export interface OpenExtractPage { page: number; stored: StoredFrom; reasons: string[] }
/** Unsure pages of a source not yet decided, for the current file. */
export async function openExtractPages(sourceId: number): Promise<OpenExtractPage[]> {
  return (await getPool()!.query(
    `SELECT pe.page, pe.stored, pe.reasons FROM page_extract pe JOIN sources s ON s.id=pe.source_id AND s.content_hash=pe.content_hash
     WHERE pe.source_id=$1 AND pe.choice IS NULL ORDER BY cardinality(pe.reasons) DESC, pe.page LIMIT 30`, [sourceId])).rows
    .map((r) => ({ page: Number(r.page), stored: r.stored as StoredFrom, reasons: r.reasons as string[] }));
}

const ocrCalls = new Map<number, number>();
const ocrCache = new Map<string, string>();

/** Both candidate texts of one open page of a running extract_review job. */
export async function pageCandidates(job: JobRow, page: number): Promise<PageCandidates & { stored: StoredFrom; reasons: string[]; ocrNote?: string }> {
  const row = (await openExtractPages(job.source_id)).find((p) => p.page === page);
  if (!row) throw new Error(`page ${page} is not open for review (not listed by get_job, or already decided)`);
  const src = await pdfSource(job.source_id); if (!src) throw new Error('this source is not a PDF');
  const layer = await textLayerOf(src.privatePath, src.hash); if (!layer) throw new Error('the private PDF copy is missing');
  const textLayer = layer[page - 1] ?? '';
  if (row.stored === 'ocr') {
    const sp = await loadSourcePages(job.source_id);
    return { textLayer, ocr: sp?.raw.get(page) ?? null, stored: row.stored, reasons: row.reasons };
  }
  // Ingest kept the text layer: OCR this page now (slow, limited), so there is something to compare.
  const key = `${src.hash}:${page}`;
  let ocr = ocrCache.get(key) ?? null;
  let ocrNote: string | undefined;
  if (ocr === null) {
    const provider = ocrProviderFromEnv(settingsEnv(), ipv4Fetch);
    const n = ocrCalls.get(job.id) ?? 0;
    if (provider.name === 'none') ocrNote = 'No OCR engine is configured; only the text layer is available.';
    else if (n >= OCR_PER_JOB) ocrNote = `OCR limit for this job (${OCR_PER_JOB} pages) reached; only the text layer is available.`;
    else {
      ocrCalls.set(job.id, n + 1);
      const pdf = await storage.get(src.privatePath); if (!pdf) throw new Error('the private PDF copy is missing');
      try { ocr = await provider.recognizePage({ pdf: new Uint8Array(pdf), pageNumber: page }); ocrCache.set(key, ocr); }
      catch (e) { ocrNote = `OCR failed: ${(e as Error).message.slice(0, 120)}`; }
      if (ocrCache.size > 200) ocrCache.delete(ocrCache.keys().next().value!);
    }
  }
  return { textLayer, ocr, stored: row.stored, reasons: row.reasons, ...(ocrNote ? { ocrNote } : {}) };
}

/** Record the agent's accepted choice for a page. */
export async function recordChoice(sourceId: number, page: number, choice: string, reason: string, provenance: string): Promise<void> {
  await getPool()!.query('UPDATE page_extract SET choice=$3, reason=$4, created_by=$5, reviewed_at=now() WHERE source_id=$1 AND page=$2', [sourceId, page, choice, reason, provenance.slice(0, 240)]);
}

/** Admin button and after-ingest trigger. Queues a job only when there are open pages and the agents are on. */
export async function startExtractReview(sourceId: number): Promise<{ mode: 'agent'; jobId: number; open: number } | { mode: 'off' | 'nothing' } | { error: string }> {
  if (!agentsEnabled()) return { mode: 'off' };
  const prep = await prepareExtractReview(sourceId);
  if ('error' in prep) return prep;
  if (prep.open === 0) return { mode: 'nothing' };
  const jobId = await enqueueOrOpenJob('extract_review', sourceId);
  if (jobId === null) return { error: 'could not queue the review job' };
  void runNextJob();
  return { mode: 'agent', jobId, open: prep.open };
}

/** After an ingest stored new text: review unsure pages in the background (never blocks the ingest; agents only). */
export function reviewAfterIngest(sourceId: number): void {
  if (!agentsEnabled()) return;
  void startExtractReview(sourceId).catch((e) => console.warn('[extract-review] after ingest failed:', (e as Error).message));
}

export interface ExtractReviewSummary { unsure: number; reviewed: number; changed: number; open: number; job: JobState | null }
/** What the extract viewer shows: pages flagged, reviewed and changed for the current file, and the latest job. */
export async function extractReviewSummary(sourceId: number): Promise<ExtractReviewSummary | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const c = (await pool.query(
    `SELECT count(*)::int unsure, count(pe.choice)::int reviewed, count(*) FILTER (WHERE pe.choice IS NOT NULL AND pe.choice <> pe.stored)::int changed
     FROM page_extract pe JOIN sources s ON s.id=pe.source_id AND s.content_hash=pe.content_hash WHERE pe.source_id=$1`, [sourceId])).rows[0];
  const last = (await pool.query("SELECT id FROM agent_jobs WHERE kind='extract_review' AND source_id=$1 ORDER BY id DESC LIMIT 1", [sourceId])).rows[0];
  return { unsure: c.unsure, reviewed: c.reviewed, changed: c.changed, open: c.unsure - c.reviewed, job: last ? await getJob(Number(last.id)) : null };
}
