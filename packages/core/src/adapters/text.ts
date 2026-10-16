import { UnsupportedSourceError, type ExtractedSource, type SourceAdapter } from './types.js';

/**
 * Plain-text rulebooks (a .txt / text/plain "text version" next to the PDF). Plain text has no pages, so the text is cut into
 * sections of about 2500 characters at paragraph breaks. Citations then read "s.N" like the HTML adapter's sections.
 */
export function splitPlainText(text: string, target = 2500): string[] {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > target) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > target * 1.6) { out.push(cur.slice(0, target)); cur = cur.slice(target); }
  }
  if (cur) out.push(cur);
  return out;
}

export const textAdapter: SourceAdapter = {
  name: 'text',
  extension: 'txt',
  canHandle: (ct) => ct.includes('text/plain'),
  async extract(bytes: Uint8Array): Promise<ExtractedSource> {
    const sections = splitPlainText(new TextDecoder('utf-8').decode(bytes));
    if (!sections.length) throw new UnsupportedSourceError('text file has no readable content');
    return {
      text: sections.map((s, i) => `\n\n=== page ${i + 1} ===\n${s}`).join(''),
      pageCount: sections.length,
      locators: sections.map((_, i) => `section ${i + 1}`),
    };
  },
};
