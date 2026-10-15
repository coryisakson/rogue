import { chmod, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandOcrProvider, NoopOcrProvider, applyOcr, needsOcr, ocrProviderFromEnv } from './index.js';

async function script(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-ocr-'));
  const p = join(dir, 'fake.sh');
  await writeFile(p, `#!/bin/sh\n${body}\n`);
  await chmod(p, 0o755);
  return p;
}
const pdf = new TextEncoder().encode('%PDF-fake');

describe('needsOcr', () => {
  const long = 'The quick brown fox jumps over the lazy dog, again and again.';
  it('flags short and empty pages (1-based)', () => { expect(needsOcr([long, '', '  12 \n', long])).toEqual([2, 3]); });
  it('ignores punctuation and whitespace', () => { expect(needsOcr(['.'.repeat(100) + ' '.repeat(100)])).toEqual([1]); });
  it('counts non-latin letters', () => { expect(needsOcr(['规则'.repeat(25)])).toEqual([]); });
  it('honours a custom threshold', () => { expect(needsOcr(['abcdef'], 5)).toEqual([]); });
  it('handles no pages', () => { expect(needsOcr([])).toEqual([]); });
});

describe('providers', () => {
  it('noop returns empty', async () => { expect(await new NoopOcrProvider().recognizePage()).toBe(''); });
  it('env without command gives noop; with command gives command', () => {
    expect(ocrProviderFromEnv({})).toBeInstanceOf(NoopOcrProvider);
    expect(ocrProviderFromEnv({ ROGUE_OCR_COMMAND: '/bin/true' })).toBeInstanceOf(CommandOcrProvider);
  });
  it('runs the command with file and page, trims output', async () => {
    const cmd = await script('test -s "$1" || exit 3; echo "  page $2 text  "');
    expect(await new CommandOcrProvider({ command: cmd }).recognizePage({ pdf, pageNumber: 7 })).toBe('page 7 text');
  });
  it('rejects non-zero exit', async () => {
    const cmd = await script('echo boom >&2; exit 2');
    await expect(new CommandOcrProvider({ command: cmd }).recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow(/exited 2: boom/);
  });
  it('times out', async () => {
    const cmd = await script('sleep 5');
    await expect(new CommandOcrProvider({ command: cmd, timeoutMs: 200 }).recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow(/timed out/);
  });
  it('caps output size', async () => {
    const cmd = await script('head -c 5000 /dev/zero | tr "\\0" a');
    await expect(new CommandOcrProvider({ command: cmd, maxOutputBytes: 100 }).recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow(/too large/);
  });
  it('caps input size and validates page', async () => {
    const p = new CommandOcrProvider({ command: '/bin/true', maxInputBytes: 3 });
    await expect(p.recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow(/input too large/);
    await expect(new CommandOcrProvider({ command: '/bin/true' }).recognizePage({ pdf, pageNumber: 0 })).rejects.toThrow(/page number/);
  });
  it('fails cleanly when the binary is missing', async () => {
    await expect(new CommandOcrProvider({ command: '/nonexistent/ocr' }).recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow();
  });
});

describe('applyOcr', () => {
  it('replaces flagged pages and reports the rest', async () => {
    const cmd = await script('if [ "$2" = 3 ]; then exit 1; fi; echo "ocr $2"');
    const r = await applyOcr(['ok', '', '', ''], pdf, new CommandOcrProvider({ command: cmd }), [2, 3, 4]);
    expect(r.pages).toEqual(['ok', 'ocr 2', '', 'ocr 4']);
    expect(r.recognized).toEqual([2, 4]);
    expect(r.lacking).toEqual([3]);
    expect(r.errors[0]).toMatch(/page 3/);
  });
  it('with noop, every flagged page lacks text and text is unchanged', async () => {
    const r = await applyOcr(['a', ''], pdf, new NoopOcrProvider(), [2]);
    expect(r.pages).toEqual(['a', '']);
    expect(r.lacking).toEqual([2]);
    expect(r.recognized).toEqual([]);
  });
});

import { HttpOcrProvider, parsePaddleOcrResponse, ocrProviderFromEnv as fromEnv, NoopOcrProvider as Noop, CommandOcrProvider as Cmd } from './provider.js';

const paddle = (pages: string[]) => ({ result: { layoutParsingResults: pages.map((text) => ({ markdown: { text } })) } });
describe('HttpOcrProvider (PaddleOCR serving API)', () => {
  it('parses one string per page', () => expect(parsePaddleOcrResponse(paddle(['a\n\nb', '']))).toEqual(['a\n\nb', '']));
  it('rejects unexpected bodies', () => expect(() => parsePaddleOcrResponse({ nope: 1 })).toThrow());
  it('sends the PDF once and serves every page from the cache, with the key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(paddle(['one', 'two']))); }) as unknown as typeof fetch;
    const p = new HttpOcrProvider({ baseUrl: 'http://ocr:8080/', apiKey: 'k', fetchImpl: f });
    const pdf = new Uint8Array([1, 2, 3]);
    expect(await p.recognizePage({ pdf, pageNumber: 1 })).toBe('one');
    expect(await p.recognizePage({ pdf, pageNumber: 2 })).toBe('two');
    expect(await p.recognizePage({ pdf, pageNumber: 9 })).toBe('');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://ocr:8080/layout-parsing');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ fileType: 0, file: 'AQID' });
  });
  it('does not cache a failed request', async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? new Response('x', { status: 500 }) : new Response(JSON.stringify(paddle(['ok']))))) as unknown as typeof fetch;
    const p = new HttpOcrProvider({ baseUrl: 'http://ocr', fetchImpl: f });
    const pdf = new Uint8Array([7]);
    await expect(p.recognizePage({ pdf, pageNumber: 1 })).rejects.toThrow(/500/);
    expect(await p.recognizePage({ pdf, pageNumber: 1 })).toBe('ok');
  });
  it('chooses the engine from env', () => {
    expect(fromEnv({})).toBeInstanceOf(Noop);
    expect(fromEnv({ ROGUE_OCR_BASE_URL: 'http://x' })).toBeInstanceOf(HttpOcrProvider);
    expect(fromEnv({ ROGUE_OCR_COMMAND: '/bin/true' })).toBeInstanceOf(Cmd);
    expect(fromEnv({ ROGUE_OCR_BASE_URL: 'http://x', ROGUE_OCR_COMMAND: '/bin/true' })).toBeInstanceOf(HttpOcrProvider);
    expect(fromEnv({ ROGUE_OCR_BASE_URL: 'http://x', ROGUE_OCR_PROVIDER: 'command', ROGUE_OCR_COMMAND: '/bin/true' })).toBeInstanceOf(Cmd);
    expect(fromEnv({ ROGUE_OCR_BASE_URL: 'http://x', ROGUE_OCR_PROVIDER: 'none' })).toBeInstanceOf(Noop);
    expect(fromEnv({ ROGUE_OCR_PROVIDER: 'http' })).toBeInstanceOf(Noop);
  });
});
