import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What an OCR provider is asked to read: the whole PDF plus the 1-based page to recognise. */
export interface OcrRequest {
  pdf: Uint8Array;
  pageNumber: number;
}

/** Pluggable OCR (AGENTS.md rule 4). Returns the recognised text for one page; throws on failure. */
export interface OcrProvider {
  readonly name: string;
  recognizePage(req: OcrRequest): Promise<string>;
}

/** Used when no OCR is configured: returns nothing, so ingestion behaves as before. */
export class NoopOcrProvider implements OcrProvider {
  readonly name = 'none';
  async recognizePage(): Promise<string> { return ''; }
}

export interface CommandOcrOptions {
  /** Executable (no shell). Called as: <command> <pdfFile> <pageNumber>; must print the page text on stdout. */
  command: string;
  timeoutMs?: number | undefined;
  maxInputBytes?: number | undefined;
  maxOutputBytes?: number | undefined;
}

/**
 * Shells out to a configurable executable. No shell is involved (arguments are passed as an array),
 * so a PDF or page number can never inject commands. Time, input and output are capped.
 */
export class CommandOcrProvider implements OcrProvider {
  readonly name = 'command';
  private readonly timeoutMs: number;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;

  constructor(private readonly opts: CommandOcrOptions) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxInputBytes = opts.maxInputBytes ?? 100 * 1024 * 1024;
    this.maxOutputBytes = opts.maxOutputBytes ?? 1024 * 1024;
  }

  async recognizePage(req: OcrRequest): Promise<string> {
    if (req.pdf.byteLength > this.maxInputBytes) throw new Error(`ocr input too large (${req.pdf.byteLength} bytes)`);
    if (!Number.isInteger(req.pageNumber) || req.pageNumber < 1) throw new Error('invalid page number');
    const dir = await mkdtemp(join(tmpdir(), 'rogue-ocr-'));
    try {
      const file = join(dir, 'input.pdf');
      await writeFile(file, req.pdf);
      return (await this.run(file, req.pageNumber)).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(file: string, pageNumber: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.command, [file, String(pageNumber)], { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = '';
      let failed = false;
      const fail = (err: Error) => { if (!failed) { failed = true; child.kill('SIGKILL'); reject(err); } };
      const timer = setTimeout(() => fail(new Error(`ocr command timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
      child.stdout.on('data', (d: Buffer) => {
        size += d.length;
        if (size > this.maxOutputBytes) return fail(new Error('ocr output too large'));
        chunks.push(d);
      });
      child.stderr.on('data', (d: Buffer) => { if (stderr.length < 500) stderr += d.toString(); });
      child.on('error', (e) => { clearTimeout(timer); fail(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failed) return;
        if (code !== 0) return reject(new Error(`ocr command exited ${code}: ${stderr.trim().slice(0, 200)}`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  }
}

/** Build the provider from env. Unset ROGUE_OCR_COMMAND means OCR is off. */
export function ocrProviderFromEnv(env: Record<string, string | undefined> = process.env): OcrProvider {
  const command = env.ROGUE_OCR_COMMAND?.trim();
  if (!command) return new NoopOcrProvider();
  const num = (v?: string) => (v && Number(v) > 0 ? Number(v) : undefined);
  return new CommandOcrProvider({ command, timeoutMs: num(env.ROGUE_OCR_TIMEOUT_MS), maxInputBytes: num(env.ROGUE_OCR_MAX_INPUT_BYTES), maxOutputBytes: num(env.ROGUE_OCR_MAX_OUTPUT_BYTES) });
}

export interface OcrOutcome {
  pages: string[];
  /** Pages that looked scanned. */
  flagged: number[];
  /** Flagged pages whose text was replaced by OCR output. */
  recognized: number[];
  /** Flagged pages that still have no text (no provider, empty result, or error). */
  lacking: number[];
  errors: string[];
}

/** Replace the text of scanned pages with OCR output when a provider is configured. Never throws. */
export async function applyOcr(pages: string[], pdf: Uint8Array, provider: OcrProvider, flagged: number[]): Promise<OcrOutcome> {
  const out = [...pages];
  const recognized: number[] = [];
  const lacking: number[] = [];
  const errors: string[] = [];
  const active = !(provider instanceof NoopOcrProvider);
  for (const n of flagged) {
    if (!active) { lacking.push(n); continue; }
    try {
      const text = await provider.recognizePage({ pdf, pageNumber: n });
      if (text) { out[n - 1] = text; recognized.push(n); } else lacking.push(n);
    } catch (e) {
      lacking.push(n);
      if (errors.length < 3) errors.push(`page ${n}: ${(e as Error).message}`);
    }
  }
  return { pages: out, flagged, recognized, lacking, errors };
}
