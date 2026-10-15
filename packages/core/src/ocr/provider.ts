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

export interface HttpOcrOptions {
  /** Service root, e.g. http://paddleocr.<ns>.svc:8080 ; the request goes to <baseUrl>/layout-parsing. */
  baseUrl: string;
  /** Optional key, sent as "Authorization: Bearer <key>". */
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
  maxInputBytes?: number | undefined;
  /** Inject a fetch (apps/web passes ipv4Fetch: Node's default DNS fails inside Olares pods). */
  fetchImpl?: typeof fetch | undefined;
}

/**
 * OCR through an HTTP service speaking the PaddleOCR / PaddleX serving API (POST /layout-parsing, JSON {file: base64, fileType: 0 = PDF}; verified live against PaddleOCR-VL on Olares).
 * The whole PDF is sent once and the per-page results are cached for that PDF, so a 100-page scan with 80 flagged pages is one request.
 * Response: result.layoutParsingResults[i].markdown.text = recognised text of page i+1 (markdown).
 */
export class HttpOcrProvider implements OcrProvider {
  readonly name = 'http';
  private readonly timeoutMs: number;
  private readonly maxInputBytes: number;
  private readonly doFetch: typeof fetch;
  // Keyed by the PDF buffer itself: a new document means a new request, and the cache never outlives the document.
  private readonly cache = new WeakMap<Uint8Array, Promise<string[]>>();

  constructor(private readonly opts: HttpOcrOptions) {
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.maxInputBytes = opts.maxInputBytes ?? 100 * 1024 * 1024;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  async recognizePage(req: OcrRequest): Promise<string> {
    if (req.pdf.byteLength > this.maxInputBytes) throw new Error(`ocr input too large (${req.pdf.byteLength} bytes)`);
    if (!Number.isInteger(req.pageNumber) || req.pageNumber < 1) throw new Error('invalid page number');
    let job = this.cache.get(req.pdf);
    if (!job) {
      job = this.fetchAllPages(req.pdf);
      this.cache.set(req.pdf, job);
      // A failed request must not be cached, or every later page would fail without retrying.
      job.catch(() => this.cache.delete(req.pdf));
    }
    return ((await job)[req.pageNumber - 1] ?? '').trim();
  }

  private async fetchAllPages(pdf: Uint8Array): Promise<string[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.doFetch(`${this.opts.baseUrl.replace(/\/+$/, '')}/layout-parsing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify({ file: Buffer.from(pdf).toString('base64'), fileType: 0, visualize: false }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`ocr service answered HTTP ${res.status}`);
      return parsePaddleOcrResponse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One markdown string per page. Throws on anything that is not the expected shape. */
export function parsePaddleOcrResponse(body: unknown): string[] {
  const results = (body as { result?: { layoutParsingResults?: unknown } } | null)?.result?.layoutParsingResults;
  if (!Array.isArray(results)) throw new Error('unexpected ocr response (no result.layoutParsingResults)');
  return results.map((r) => {
    const text = (r as { markdown?: { text?: unknown } })?.markdown?.text;
    return typeof text === 'string' ? text : '';
  });
}

/**
 * Choose the OCR engine from env. ROGUE_OCR_PROVIDER = none | command | http. When unset: http if ROGUE_OCR_BASE_URL is set,
 * else command if ROGUE_OCR_COMMAND is set, else none. The key never goes in the image; set it as an app secret/env.
 */
export function ocrProviderFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): OcrProvider {
  const num = (v?: string) => (v && Number(v) > 0 ? Number(v) : undefined);
  const command = env.ROGUE_OCR_COMMAND?.trim();
  const baseUrl = env.ROGUE_OCR_BASE_URL?.trim();
  const kind = (env.ROGUE_OCR_PROVIDER?.trim().toLowerCase() || (baseUrl ? 'http' : command ? 'command' : 'none'));
  if (kind === 'http') {
    if (!baseUrl) return new NoopOcrProvider();
    return new HttpOcrProvider({ baseUrl, apiKey: env.ROGUE_OCR_API_KEY || undefined, timeoutMs: num(env.ROGUE_OCR_TIMEOUT_MS), maxInputBytes: num(env.ROGUE_OCR_MAX_INPUT_BYTES), fetchImpl });
  }
  if (kind === 'command' && command) return new CommandOcrProvider({ command, timeoutMs: num(env.ROGUE_OCR_TIMEOUT_MS), maxInputBytes: num(env.ROGUE_OCR_MAX_INPUT_BYTES), maxOutputBytes: num(env.ROGUE_OCR_MAX_OUTPUT_BYTES) });
  return new NoopOcrProvider();
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
