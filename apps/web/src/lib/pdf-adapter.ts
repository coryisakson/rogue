import { extractText, getDocumentProxy } from 'unpdf';
import { ipv4Fetch } from './services';
import { applyOcr, needsOcr, ocrProviderFromEnv, type SourceAdapter } from '@rogue/core';

/** PDF implementation of SourceAdapter. Lives in apps/web because the PDF parser dependency does (core stays lean). */
export const pdfAdapter: SourceAdapter = {
  name: 'pdf',
  extension: 'pdf',
  canHandle: (ct) => ct.includes('pdf'),
  async extract(bytes) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: false });
    // Scanned pages yield (almost) no text. Try OCR if a provider is configured; otherwise just record which pages lacked text.
    let notes: Record<string, unknown> | undefined;
    const flagged = needsOcr(out.text);
    if (flagged.length) {
      const ocr = await applyOcr(out.text, new Uint8Array(bytes), ocrProviderFromEnv(process.env, ipv4Fetch), flagged);
      out.text = ocr.pages;
      notes = { ocr: ocr.recognized.length > 0, ocrPages: ocr.recognized, pagesWithoutText: ocr.lacking, ...(ocr.errors.length ? { ocrErrors: ocr.errors } : {}) };
    }
    return {
      text: out.text.map((t, i) => `\n\n=== page ${i + 1} ===\n${t}`).join(''),
      pageCount: out.totalPages,
      locators: out.text.map((_, i) => `page ${i + 1}`),
      ...(notes ? { notes } : {}),
    };
  },
};
