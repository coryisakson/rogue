import { extractText, getDocumentProxy } from 'unpdf';
import { ipv4Fetch } from './services';
import { settingsEnv } from './settings';
import { scanPdfForQr } from './qr-scan';
import { applyOcr, needsOcr, ocrModeFromEnv, ocrProviderFromEnv, pickPagesForOcr, type SourceAdapter } from '@rogue/core';

/** PDF implementation of SourceAdapter. Lives in apps/web because the PDF parser dependency does (core stays lean). */
export const pdfAdapter: SourceAdapter = {
  name: 'pdf',
  extension: 'pdf',
  canHandle: (ct) => ct.includes('pdf'),
  async extract(bytes) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: false });
    // Best of both per page: a clean text layer is exact, so keep it; OCR only pages that are empty or garbled.
    // ROGUE_OCR_MODE=all (or the older ROGUE_OCR_ALL_PAGES=1) re-reads every page; =off never calls OCR.
    const env = settingsEnv();
    const mode = ocrModeFromEnv(env);
    const pick = pickPagesForOcr(out.text, { mode });
    let recognized: number[] = [];
    let errors: string[] = [];
    if (pick.ocrPages.length) {
      const ocr = await applyOcr(out.text, new Uint8Array(bytes), ocrProviderFromEnv(env, ipv4Fetch), pick.ocrPages);
      out.text = ocr.pages;
      ({ recognized, errors } = ocr);
    }
    // A page counts as OCR only if OCR actually returned text; otherwise its text layer (maybe empty) stays.
    const pageSource = pick.decisions.map((d) => (recognized.includes(d.page) ? 'ocr' : 'text'));
    let notes: Record<string, unknown> = {
      ocrMode: mode,
      ocr: recognized.length > 0,
      ocrPages: recognized,
      textLayerPages: pageSource.flatMap((s, i) => (s === 'text' ? [i + 1] : [])),
      pageSource,
      textLayerScores: pick.decisions.map((d) => d.score),
      pagesWithoutText: needsOcr(out.text),
      ...(errors.length ? { ocrErrors: errors } : {}),
    };
    // QR codes (companion app, video links) are recorded as facts by ingest; a scan failure is only noted.
    const qr = await scanPdfForQr(bytes);
    notes = { ...notes, qrScanned: qr.scanned, qrFound: qr.findings.length, ...(qr.error ? { qrError: qr.error } : {}) };
    return {
      qrFindings: qr.findings,
      text: out.text.map((t, i) => `\n\n=== page ${i + 1} ===\n${t}`).join(''),
      pageCount: out.totalPages,
      locators: out.text.map((_, i) => `page ${i + 1}`),
      notes,
    };
  },
};
