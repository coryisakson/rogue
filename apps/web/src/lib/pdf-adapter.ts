import { extractText, getDocumentProxy } from 'unpdf';
import type { SourceAdapter } from '@rogue/core';

/** PDF implementation of SourceAdapter. Lives in apps/web because the PDF parser dependency does (core stays lean). */
export const pdfAdapter: SourceAdapter = {
  name: 'pdf',
  extension: 'pdf',
  canHandle: (ct) => ct.includes('pdf'),
  async extract(bytes) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: false });
    return {
      text: out.text.map((t, i) => `\n\n=== page ${i + 1} ===\n${t}`).join(''),
      pageCount: out.totalPages,
      locators: out.text.map((_, i) => `page ${i + 1}`),
    };
  },
};
