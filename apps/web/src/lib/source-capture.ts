import { createHash } from 'node:crypto';
import {
  CAPTURE_MAX_CHARS, CAPTURE_MAX_FILE_BYTES, CAPTURE_METHOD, captureEditionLabel, captureFileType, checkCapturedText, htmlAdapter,
  splitCapturedText, type CaptureError, type CaptureForm,
} from '@rogue/core';
import { pdfAdapter } from './pdf-adapter';
import { indexSource } from './rules-index';
import { ensureMigrated, getPool, storage } from './services';

/**
 * Admin capture from the browser (/admin/capture; docs/CAPTURE.md). The admin opened a bot-walled page in their own browser
 * and pasted its text, uploaded a file saved from it, or sent it with the bookmarklet. Same steps as an admin-added link
 * (game-sources.ts addGameSource) minus the network: nothing is fetched. Gates kept: tombstones win, the admin confirmed the
 * site's terms (parseCaptureForm), the source stays link_only, and a fetched source is never overwritten by a capture.
 * The host is NOT added to approved_hosts: capturing a page gives Rogue no permission to fetch from that site.
 * Text is stored like ingest.ts does (private text file, "=== page N ===" markers), then chunked and embedded (rules-index).
 */

export interface CapturedText { text: string; pages: number; contentType: string; bytes: Uint8Array; ext: string | null }

/** Turn the pasted text or the uploaded file into stored text, or a refusal code. Exactly one of the two may be given. */
export async function readCapture(pasted: string, file: File | null): Promise<{ ok: true; value: CapturedText } | { ok: false; code: CaptureError }> {
  const hasPaste = pasted.trim().length > 0;
  if (hasPaste && file) return { ok: false, code: 'both' };
  let out: CapturedText;
  if (file) {
    if (file.size > CAPTURE_MAX_FILE_BYTES) return { ok: false, code: 'toolarge' };
    const type = captureFileType(file.name);
    if (!type) return { ok: false, code: 'file' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = type === 'application/pdf' ? 'pdf' : type === 'text/html' ? 'html' : 'txt';
    if (type === 'text/plain') {
      const raw = new TextDecoder('utf-8').decode(bytes);
      if (raw.length > CAPTURE_MAX_CHARS) return { ok: false, code: 'toolarge' };
      out = { ...splitCapturedText(raw), contentType: 'text/plain', bytes, ext };
    } else {
      // Saved web pages and PDFs go through the same adapters as fetched ones (headings become sections, PDF pages stay pages).
      try {
        const x = await (type === 'text/html' ? htmlAdapter : pdfAdapter).extract(bytes, type);
        out = { text: x.text, pages: x.pageCount, contentType: type, bytes, ext };
      } catch { return { ok: false, code: 'unreadable' }; }
    }
  } else {
    if (pasted.length > CAPTURE_MAX_CHARS) return { ok: false, code: 'toolarge' };
    out = { ...splitCapturedText(pasted), contentType: 'text/plain', bytes: new TextEncoder().encode(pasted), ext: null };
  }
  const refusal = checkCapturedText(out.text);
  return refusal ? { ok: false, code: refusal } : { ok: true, value: out };
}

/** Last indexing outcome per captured source id, for the sources page (in memory; the audit log keeps the record). */
const captureProgress = new Map<number, string>();
export const captureStatus = (sourceId: number): string | null => captureProgress.get(sourceId) ?? null;

export type CaptureResult = { ok: true; sourceId: number; chars: number; pages: number; recapture: boolean } | { ok: false; code: CaptureError };

/** Store a capture as a source of the game (or replace the text of an earlier capture of the same URL), then index it. */
export async function captureSource(form: CaptureForm, captured: CapturedText, adminId: number): Promise<CaptureResult> {
  const pool = getPool(); if (!pool) return { ok: false, code: 'db' };
  await ensureMigrated();
  const game = (await pool.query('SELECT id FROM games WHERE slug=$1', [form.game])).rows[0];
  if (!game) return { ok: false, code: 'game' };
  if ((await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [form.url])).rowCount) return { ok: false, code: 'tombstoned' };
  const old = (await pool.query(
    `SELECT s.id, s.capture_method, s.text_path,
       EXISTS (SELECT 1 FROM documents d JOIN editions e ON e.id=d.edition_id WHERE d.source_id=s.id AND e.game_id=$2) in_game
     FROM sources s WHERE s.url=$1`, [form.url, game.id])).rows[0];
  if (old && !old.in_game) return { ok: false, code: 'othergame' };
  // A source Rogue fetched itself keeps its fetched text; a capture only replaces an earlier capture or an empty source.
  if (old && old.capture_method !== CAPTURE_METHOD && old.text_path) return { ok: false, code: 'fetched' };
  if (!old && (await pool.query('SELECT 1 FROM runtime_sources WHERE url=$1', [form.url])).rowCount) return { ok: false, code: 'queued' };

  const sha = createHash('sha256').update(captured.bytes).digest('hex');
  const textPath = `private/sources/${sha}.txt`;
  // An uploaded file keeps a private copy like a fetched one (never served); pasted text has no other original.
  const privatePath = captured.ext && captured.ext !== 'txt' ? `private/sources/${sha}.${captured.ext}` : null;
  if (privatePath) await storage.put(privatePath, captured.bytes);
  await storage.put(textPath, new TextEncoder().encode(captured.text));

  const chars = captured.text.length;
  const c = await pool.connect();
  let sourceId: number;
  try {
    await c.query('BEGIN');
    sourceId = Number((await c.query(
      `INSERT INTO sources (url, title, language, authority, rights_status, content_hash, fetched_at, private_path, text_path, page_count, content_type, capture_method, captured_by, captured_at)
       VALUES ($1,$2,$3,$4,'link_only',$5,now(),$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (url) DO UPDATE SET title=EXCLUDED.title, language=EXCLUDED.language, authority=EXCLUDED.authority, content_hash=EXCLUDED.content_hash,
         fetched_at=now(), private_path=EXCLUDED.private_path, text_path=EXCLUDED.text_path, page_count=EXCLUDED.page_count, content_type=EXCLUDED.content_type,
         capture_method=EXCLUDED.capture_method, captured_by=EXCLUDED.captured_by, captured_at=now()
       RETURNING id`,
      [form.url, form.title, form.language, form.authority, sha, privatePath, textPath, captured.pages || null, captured.contentType, CAPTURE_METHOD, adminId])).rows[0].id);
    // The database refuses documents/chunks for a source with no rights-gate record (migration 0011). A capture is not
    // fetched, so the record is an explicit, audited admin grant limited to link-only use (no full text served).
    if (!(await c.query('SELECT 1 FROM rights_grants WHERE source_id=$1 AND revoked_at IS NULL', [sourceId])).rowCount) {
      await c.query('INSERT INTO rights_grants(source_id, grantor, scope, evidence) VALUES ($1,$2,$3,$4)', [
        sourceId, `admin:${adminId}`, 'manual capture, link_only, evaluation',
        `Admin captured the text from their own browser and ticked the terms box${form.hostWarned ? '; host is on the capture warning list (Review Log R36), admin typed the host to confirm' : ''}. Grants Rogue no right to fetch or serve the site's text.`,
      ]);
    }
    if (!old) {
      const label = captureEditionLabel(form.host, form.kind, form.language, new Date().toISOString().slice(0, 10));
      const ed = await c.query(
        `INSERT INTO editions (game_id, label, language) VALUES ($1,$2,$3)
         ON CONFLICT (game_id, label, language) DO UPDATE SET label = EXCLUDED.label RETURNING id`, [game.id, label, form.language]);
      await c.query('INSERT INTO documents (source_id, edition_id, kind) VALUES ($1,$2,$3) ON CONFLICT (source_id, edition_id) DO NOTHING', [sourceId, ed.rows[0].id, form.kind]);
    }
    // Counts and ids only; never the captured text.
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`admin:${adminId}`, 'source_captured', {
      slug: form.game, sourceId, url: form.url, adminId, chars, pages: captured.pages, contentType: captured.contentType, authority: form.authority,
      kind: form.kind, language: form.language, recapture: !!old, termsChecked: true, hostWarned: form.hostWarned, notes: form.notes,
    }]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }

  // A re-capture with different text leaves the old text file behind; remove it when no other source points at it.
  if (old?.text_path && old.text_path !== textPath) {
    const others = (await pool.query('SELECT 1 FROM sources WHERE text_path=$1', [old.text_path])).rowCount;
    if (!others) await storage.delete(old.text_path).catch(() => false);
  }
  void indexCapture(sourceId);
  return { ok: true, sourceId, chars, pages: captured.pages, recapture: !!old };
}

/** Chunk + embed in the background (indexSource replaces the old chunks on a re-capture). */
async function indexCapture(sourceId: number): Promise<void> {
  captureProgress.set(sourceId, 'indexing');
  try {
    const idx = await indexSource(sourceId);
    captureProgress.set(sourceId, `done: ${idx.chunks} chunks, ${idx.embedded} embedded${idx.note ? ` (${idx.note})` : ''}`);
  } catch (e) { captureProgress.set(sourceId, `error: ${e instanceof Error ? e.message : 'unknown'}`); }
}
