/**
 * Streamable HTTP transport for the public MCP endpoint (spec 2026-07-28, with the legacy fallbacks it describes).
 * Web-standard Request -> Response, so it runs in Astro, a plain node:http server (tests) or anywhere else.
 * We always answer with a single JSON object (never SSE): every tool here returns in one go.
 */
import { handleMcpBody, RPC, type McpOptions, type McpServerInfo, type McpTool } from './server.js';

export interface McpHttpConfig {
  tools: McpTool[];
  info: McpServerInfo;
  options?: Omit<McpOptions, 'headers'>;
  /** Request body cap in bytes (default 64 KB). Tool arguments are short; anything bigger is abuse. */
  maxBodyBytes?: number;
  /** Extra browser origins allowed besides our own host and loopback (e.g. a hosted inspector). */
  allowedOrigins?: string[];
  /** Per-client general budget; false answers 429. Called once per POST. */
  allowRequest?: () => boolean;
}

export const MCP_MAX_BODY_BYTES = 64 * 1024;
/** Application-defined code for "slow down" (outside the JSON-RPC reserved range, as the spec asks for new codes). */
export const MCP_RATE_LIMITED = -31429;

const ALLOW = 'POST, OPTIONS';

/**
 * Origin validation (DNS-rebinding guard). No Origin = not a browser (Claude, ChatGPT connectors, CLIs): fine.
 * A browser may call us from our own host, from a loopback page (MCP Inspector on localhost), or from a configured origin.
 * The endpoint is public, read-only and uses no cookies, so this is about not being driven by arbitrary web pages.
 */
export function originAllowed(origin: string | null, host: string | null, extra: string[] = []): boolean {
  if (!origin) return true;
  if (extra.includes(origin)) return true;
  let u: URL;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (host && u.host === host) return true;
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
}

function corsHeaders(origin: string | null, requested: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-methods': ALLOW,
    // Echo what the browser asks for: Mcp-Param-* names are tool-specific, and no credentials are involved.
    'access-control-allow-headers': requested ?? 'content-type, accept, mcp-protocol-version, mcp-method, mcp-name',
    'access-control-expose-headers': 'mcp-protocol-version',
    'access-control-max-age': '86400',
  };
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const rpcFail = (status: number, code: number, message: string, extra: Record<string, string> = {}) =>
  json({ jsonrpc: '2.0', id: null, error: { code, message } }, status, extra);

/** Reads the body but stops as soon as it passes `max` bytes (a missing Content-Length must not bypass the cap). */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

/** Does this Accept header let us answer with JSON? A missing header is treated as "anything". */
export function acceptsJson(accept: string | null): boolean {
  if (!accept) return true;
  return accept.split(',').map((x) => x.split(';')[0]!.trim().toLowerCase())
    .some((t) => t === 'application/json' || t === 'application/*' || t === '*/*');
}

export async function handleMcpHttp(request: Request, cfg: McpHttpConfig): Promise<Response> {
  const h = request.headers;
  const origin = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!originAllowed(origin, host, cfg.allowedOrigins)) return rpcFail(403, RPC.INVALID_REQUEST, 'Forbidden: Origin not allowed');
  const cors = corsHeaders(origin, h.get('access-control-request-headers'));

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: ALLOW, ...cors } });
  if (request.method !== 'POST') {
    // No standalone SSE stream and no sessions (2026-07-28): GET and DELETE are 405, which legacy clients also understand.
    return json({ error: 'Method not allowed. POST one JSON-RPC message to this URL; see /docs/mcp.' }, 405, { allow: ALLOW, ...cors });
  }
  if (cfg.allowRequest && !cfg.allowRequest()) return rpcFail(429, MCP_RATE_LIMITED, 'Rate limit exceeded; retry in a minute', { 'retry-after': '60', ...cors });
  if (!(h.get('content-type') ?? '').toLowerCase().includes('application/json')) return rpcFail(415, RPC.INVALID_REQUEST, 'Content-Type must be application/json', cors);
  if (!acceptsJson(h.get('accept'))) return rpcFail(406, RPC.INVALID_REQUEST, 'Not Acceptable: this server answers with application/json', cors);

  const max = cfg.maxBodyBytes ?? MCP_MAX_BODY_BYTES;
  const tooBig = () => rpcFail(413, RPC.INVALID_REQUEST, `Request body over ${max} bytes`, cors);
  if (Number(h.get('content-length') ?? 0) > max) return tooBig();
  const text = await readCapped(request, max);
  if (text === null) return tooBig();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return rpcFail(400, RPC.PARSE, 'Parse error', cors); }

  // Mcp-Session-Id and Last-Event-ID are ignored on purpose: no sessions, no resumable streams.
  const reply = await handleMcpBody(body, cfg.tools, cfg.info, { ...cfg.options, headers: h });
  if (reply.body === null) return new Response(null, { status: 202, headers: cors });
  return json(reply.body, reply.status, cors);
}
