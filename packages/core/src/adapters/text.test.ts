import { describe, expect, it } from 'vitest';
import { splitPlainText, textAdapter } from './text.js';

describe('textAdapter', () => {
  it('splits at paragraph breaks into page-marked sections', async () => {
    const para = 'Players take turns clockwise. '.repeat(40);
    const out = await textAdapter.extract(new TextEncoder().encode([para, para, para].join('\n\n')), 'text/plain');
    expect(out.pageCount).toBeGreaterThan(1);
    expect(out.text).toContain('=== page 1 ===');
    expect(out.text).toContain('=== page 2 ===');
  });
  it('cuts one huge paragraph', () => { expect(splitPlainText('x'.repeat(10000)).length).toBeGreaterThan(2); });
  it('refuses empty files', async () => { await expect(textAdapter.extract(new TextEncoder().encode('  \n '), 'text/plain')).rejects.toThrow(); });
  it('only handles text/plain', () => { expect(textAdapter.canHandle('text/plain; charset=utf-8')).toBe(true); expect(textAdapter.canHandle('text/html')).toBe(false); });
});
