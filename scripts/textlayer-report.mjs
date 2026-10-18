#!/usr/bin/env node
// Per-page text-layer report for PDFs: letters/digits, quality score, and what ROGUE_OCR_MODE=auto would do.
// Counts only, never page text (rights: we do not dump rulebook text).
// Usage: node scripts/textlayer-report.mjs <file.pdf> [more.pdf ...]
// Needs Node >= 23.6 (runs packages/core TypeScript directly via built-in type stripping).
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// packages/core imports './x.js' but ships './x.ts' (tsc/vite map it). Do the same mapping for plain Node.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const ts = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
    return next(specifier, context);
  },
});

const { extractText, getDocumentProxy } = await import('unpdf');
const { pickPagesForOcr } = await import('../packages/core/src/ocr/text-layer.ts');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node scripts/textlayer-report.mjs <file.pdf> [...]'); process.exit(2); }

for (const file of files) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  const { decisions, ocrPages } = pickPagesForOcr(text, { mode: 'auto' });
  console.log(`\n${file}: ${text.length} pages, auto keeps ${text.length - ocrPages.length} text layers, OCRs ${ocrPages.length}`);
  console.log('page  chars  score  decision  reasons');
  for (const d of decisions) {
    console.log(`${String(d.page).padStart(4)}  ${String(d.chars).padStart(5)}  ${d.score.toFixed(2).padStart(5)}  ${d.source.padEnd(8)}  ${d.reasons.join(',')}`);
  }
}
