/**
 * Stateless MCP server (JSON-RPC 2.0). No SDK dependency so the same handler runs in the web app, the Discord bot process
 * or tests; the HTTP transport lives in http.ts. Read-only tools only.
 *
 * "Dual-era" on purpose (spec 2026-07-28, Versioning > Backward Compatibility):
 * - modern clients (2026-07-28) put the protocol version in every request's `_meta` and never call `initialize`;
 * - legacy clients (2025-11-25 and earlier, e.g. today's official SDK) open with `initialize` and then send plain requests.
 * We keep no session either way, so both eras are served by the same per-message code.
 */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  /** Human-readable name for client UIs. */
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** JSON Schema of `structuredContent`. Results MUST conform, so keep it loose. */
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  /** Runs the local AI model (retrieval + rerank/answer): goes through the stricter rate bucket. */
  costly?: boolean;
  /** OAuth scopes the caller needs (signed-in tools, ADR 0004). Empty/absent = public. The HTTP layer enforces them. */
  scopes?: string[];
  /** The result is a receipt for a write (rating saved, request queued), not a claim: the citation rule does not apply. */
  receipt?: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** A prompt template (prompts/list + prompts/get). Text only. */
export interface McpPrompt {
  name: string;
  title?: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  text: (args: Record<string, string>) => string;
}

/** One source behind a result. `url` is the publisher link (the authority); `quote` stays short. */
export interface Citation { title: string; url: string; page?: number | string | null; publisher?: string | null; quote?: string | null }

export interface McpServerInfo { name: string; version: string; title?: string; websiteUrl?: string }

export interface McpOptions {
  instructions?: string;
  prompts?: McpPrompt[];
  /** Public server rule: every tool result must carry a non-empty `citations` array, else it becomes an isError result. */
  requireCitations?: boolean;
  /** Check required arguments and primitive types against inputSchema before calling (isError on failure). */
  strictArgs?: boolean;
  /** Called once per costly tool call; false means the caller is over its model budget. */
  allowCostly?: () => boolean;
  /** HTTP request headers, when served over Streamable HTTP: modern requests are checked against them. */
  headers?: Headers;
}

export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS];
/** Newest revision we speak. */
export const MCP_PROTOCOL_VERSION = MODERN_PROTOCOL_VERSIONS[0];
/** Batches only existed in 2025-03-26; cap them so one POST cannot fan out into many tool calls. */
export const MAX_BATCH = 16;

// Error codes. -32020..-32022 are defined by the 2026-07-28 spec; the rest are plain JSON-RPC.
export const RPC = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603,
  HEADER_MISMATCH: -32020, UNSUPPORTED_VERSION: -32022,
} as const;

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

type Id = string | number;
interface RpcMessage { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
/** One reply plus the HTTP status the transport should use when this message was the whole body. `body: null` means 202. */
export interface McpReply { status: number; body: Record<string, unknown> | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const rpcError = (id: Id | null, code: number, message: string, data?: unknown) =>
  ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });
const fail = (status: number, id: Id | null, code: number, message: string, data?: unknown): McpReply =>
  ({ status, body: rpcError(id, code, message, data) });

/** Decodes the `=?base64?...?=` sentinel used for non-ASCII Mcp-Name / Mcp-Param values. */
export function decodeHeaderValue(v: string): string {
  const m = /^=\?base64\?(.*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]!), (c) => c.charCodeAt(0))); } catch { return v; }
}

/**
 * Checks the input against the parts of the tool's JSON Schema that matter for our flat tools: required keys and
 * primitive types. Returns an LLM-readable problem, or null. Failures are tool errors (isError), so the model can retry.
 */
export function checkArgs(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const props = isObj(schema['properties']) ? schema['properties'] : {};
  for (const key of Array.isArray(schema['required']) ? (schema['required'] as string[]) : [])
    if (args[key] === undefined || args[key] === null || args[key] === '') return `Missing required argument "${key}".`;
  for (const [key, value] of Object.entries(args)) {
    const p = props[key];
    if (!isObj(p) || value === undefined || value === null) continue;
    const want = p['type'];
    const ok = want === 'string' ? typeof value === 'string'
      : want === 'integer' ? Number.isInteger(value)
      : want === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : want === 'boolean' ? typeof value === 'boolean' : true;
    if (!ok) return `Argument "${key}" must be of type ${String(want)}.`;
    if (Array.isArray(p['enum']) && !p['enum'].includes(value)) return `Argument "${key}" must be one of: ${p['enum'].join(', ')}.`;
  }
  return null;
}

const CITATION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, url: { type: 'string', description: 'publisher link; the authority' },
    page: { type: ['number', 'string', 'null'] }, publisher: { type: ['string', 'null'] }, quote: { type: ['string', 'null'], description: 'short excerpt' },
  },
  required: ['title', 'url'],
};

/** Output schema for a cited tool: the tool's own top-level fields plus the mandatory `citations` list. */
export function citedOutputSchema(properties: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'object', properties: { ...properties, citations: { type: 'array', minItems: 1, items: CITATION_SCHEMA } }, required: ['citations'] };
}

/** Drops citations without a URL and fills a missing title, so every listed source can be followed. */
export function cleanCitations(list: Partial<Citation>[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of list) {
    if (!c.url) continue;
    const key = `${c.url}|${c.page ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: c.title || c.url, url: c.url, ...(c.page != null ? { page: c.page } : {}), ...(c.publisher ? { publisher: c.publisher } : {}), ...(c.quote ? { quote: c.quote } : {}) });
  }
  return out;
}

const textResult = (text: string, isError: boolean) => ({ content: [{ type: 'text', text }], isError });

async function callTool(tool: McpTool, args: Record<string, unknown>, opts: McpOptions): Promise<Record<string, unknown>> {
  const problem = opts.strictArgs ? checkArgs(tool.inputSchema, args) : null;
  if (problem) return textResult(`${problem} See the tool's inputSchema.`, true);
  if (tool.costly && opts.allowCostly && !opts.allowCostly())
    return textResult(`Rate limit: ${tool.name} uses the AI model and allows only a few calls per minute per client. Wait about a minute and retry, or use get_game_facts meanwhile.`, true);
  let result: unknown;
  try { result = await tool.handler(args); } catch (e) { return textResult((e as Error).message, true); }
  if (opts.requireCitations && !tool.receipt) {
    const cites = isObj(result) && Array.isArray(result['citations']) ? result['citations'] : [];
    // Design plan: a response without sources is an error, never an unsourced answer.
    if (!cites.length) return textResult('No cited source was found for this request, and Rogue never answers without a source. Try another game slug (list_games), a different wording, or get_game_facts.', true);
  }
  const structured = isObj(result) ? { structuredContent: result } : {};
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], ...structured, isError: false };
}

/** Modern requests must agree with the mirrored HTTP headers (Streamable HTTP > Server Validation). */
function headerProblem(h: Headers, version: string, method: string, params: Record<string, unknown>): string | null {
  const pv = h.get('mcp-protocol-version');
  if (pv !== version) return `MCP-Protocol-Version header ${pv === null ? 'is missing' : `'${pv}'`} but _meta says '${version}'`;
  const m = h.get('mcp-method');
  if (m !== method) return `Mcp-Method header ${m === null ? 'is missing' : `'${m}'`} but the body method is '${method}'`;
  if (method === 'tools/call' || method === 'prompts/get' || method === 'resources/read') {
    const want = String(params[method === 'resources/read' ? 'uri' : 'name'] ?? '');
    const raw = h.get('mcp-name');
    const got = raw === null ? null : decodeHeaderValue(raw);
    if (got !== want) return `Mcp-Name header ${got === null ? 'is missing' : `'${got}'`} but the body value is '${want}'`;
  }
  return null;
}

/**
 * Handles ONE JSON-RPC message. The status follows the 2026-07-28 HTTP binding (400 for version/header/_meta problems,
 * 404 for unknown methods on modern requests); legacy requests keep the old "200 with a JSON-RPC error" behaviour.
 */
export async function handleMcpMessage(msg: unknown, tools: McpTool[], info: McpServerInfo, opts: McpOptions = {}): Promise<McpReply> {
  if (!isObj(msg)) return fail(400, null, RPC.INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC object');
  const m = msg as RpcMessage;
  const hasId = 'id' in m && m.id !== undefined;
  const id: Id | null = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(400, id, RPC.INVALID_REQUEST, 'Invalid Request: needs jsonrpc "2.0" and a method (clients must not send responses)');
  if (hasId && id === null) return fail(400, null, RPC.INVALID_REQUEST, 'Invalid Request: id must be a string or number');
  if (m.params !== undefined && !isObj(m.params)) return fail(400, id, RPC.INVALID_PARAMS, 'Invalid params: params must be an object');
  // Notifications (initialized, cancelled, anything else) need no answer and change nothing here: 202.
  if (!hasId) return { status: 202, body: null };

  const method = m.method;
  const params = (m.params as Record<string, unknown> | undefined) ?? {};
  const meta = isObj(params['_meta']) ? params['_meta'] : {};
  const metaVersion = meta[META_VERSION];

  // Era detection: a protocol version in _meta marks a modern request.
  let modern = false;
  if (metaVersion !== undefined) {
    if (typeof metaVersion !== 'string' || !SUPPORTED_PROTOCOL_VERSIONS.includes(metaVersion))
      return fail(400, id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: metaVersion });
    modern = (MODERN_PROTOCOL_VERSIONS as readonly string[]).includes(metaVersion);
  }
  if (modern) {
    if (!isObj(meta[META_CAPS])) return fail(400, id, RPC.INVALID_PARAMS, `Invalid params: _meta["${META_CAPS}"] is required`);
    const problem = opts.headers ? headerProblem(opts.headers, metaVersion as string, method, params) : null;
    if (problem) return fail(400, id, RPC.HEADER_MISMATCH, `Header mismatch: ${problem}`);
  } else {
    // Legacy: the header is optional (absent = 2025-03-26), but an unknown one is refused with the list we support.
    const pv = opts.headers?.get('mcp-protocol-version');
    if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) return fail(400, id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: pv });
    if (method === 'server/discover') return fail(400, id, RPC.INVALID_PARAMS, `Invalid params: server/discover needs _meta["${META_VERSION}"] (one of ${MODERN_PROTOCOL_VERSIONS.join(', ')})`);
  }

  // Modern results carry resultType and identify the server, since there is no handshake to do it once.
  const ok = (result: Record<string, unknown>): McpReply => ({
    status: 200,
    body: { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result, _meta: { [META_SERVER]: info } } : result },
  });
  const capabilities = { tools: { listChanged: false }, resources: {}, prompts: { listChanged: false } };
  const prompts = opts.prompts ?? [];

  try {
    switch (method) {
      case 'server/discover':
        return ok({ supportedVersions: SUPPORTED_PROTOCOL_VERSIONS, capabilities, ...(opts.instructions ? { instructions: opts.instructions } : {}) });
      case 'initialize': {
        if (modern) return fail(404, id, RPC.METHOD_NOT_FOUND, `Method not found: initialize is not part of ${metaVersion}; send requests directly`);
        // Version negotiation: echo the client's version when we speak it, else offer our newest legacy version.
        const asked = params['protocolVersion'];
        const version = typeof asked === 'string' && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_PROTOCOL_VERSIONS[0];
        return ok({ protocolVersion: version, capabilities, serverInfo: info, ...(opts.instructions ? { instructions: opts.instructions } : {}) });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({
          tools: tools.map((t) => ({
            name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description, inputSchema: t.inputSchema,
            ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}), ...(t.annotations ? { annotations: t.annotations } : {}),
          })),
        });
      case 'tools/call': {
        const name = params['name'];
        const tool = typeof name === 'string' ? tools.find((t) => t.name === name) : undefined;
        if (!tool) return fail(200, id, RPC.INVALID_PARAMS, `Unknown tool: ${String(name)}. Call tools/list for the available tools.`);
        const args = params['arguments'] ?? {};
        if (!isObj(args)) return fail(200, id, RPC.INVALID_PARAMS, 'Invalid params: arguments must be an object');
        return ok(await callTool(tool, args, opts));
      }
      case 'resources/list':
        return ok({ resources: [] });
      case 'resources/templates/list':
        return ok({ resourceTemplates: [] });
      case 'resources/read':
        return fail(200, id, RPC.INVALID_PARAMS, `Resource not found: ${String(params['uri'])}`);
      case 'prompts/list':
        return ok({ prompts: prompts.map(({ name, title, description, arguments: a }) => ({ name, ...(title ? { title } : {}), description, ...(a ? { arguments: a } : {}) })) });
      case 'prompts/get': {
        const p = prompts.find((x) => x.name === params['name']);
        if (!p) return fail(200, id, RPC.INVALID_PARAMS, `Unknown prompt: ${String(params['name'])}`);
        const raw = isObj(params['arguments']) ? params['arguments'] : {};
        const args = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
        const missing = (p.arguments ?? []).find((a) => a.required && !args[a.name]);
        if (missing) return fail(200, id, RPC.INVALID_PARAMS, `Missing prompt argument: ${missing.name}`);
        return ok({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(args) } }] });
      }
      default:
        return fail(modern ? 404 : 200, id, RPC.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (e) {
    return fail(500, id, RPC.INTERNAL, (e as Error).message);
  }
}

/**
 * Handles a parsed body: one message, or a 2025-03-26 style batch. Returns the JSON-RPC reply (array for batches),
 * or null when nothing needs an answer (notifications only). Kept for /agent/mcp/*, which uses it as before.
 */
export async function handleMcp(body: unknown, tools: McpTool[], info: McpServerInfo, opts: McpOptions = {}): Promise<unknown | null> {
  return (await handleMcpBody(body, tools, info, opts)).body;
}

/** Same as handleMcp, plus the HTTP status for the transport. */
export async function handleMcpBody(body: unknown, tools: McpTool[], info: McpServerInfo, opts: McpOptions = {}): Promise<{ status: number; body: unknown | null }> {
  if (!Array.isArray(body)) return handleMcpMessage(body, tools, info, opts);
  if (!body.length) return fail(400, null, RPC.INVALID_REQUEST, 'Invalid Request: empty batch');
  if (body.length > MAX_BATCH) return fail(400, null, RPC.INVALID_REQUEST, `Invalid Request: at most ${MAX_BATCH} messages per batch`);
  const replies = await Promise.all(body.map((msg) => {
    // 2026-07-28 allows exactly one message per POST; batches are a legacy (2025-03-26) feature only.
    const meta = isObj(msg) && isObj(msg['params']) && isObj(msg['params']['_meta']) ? msg['params']['_meta'] : {};
    if (meta[META_VERSION] !== undefined) {
      const id = isObj(msg) && (typeof msg['id'] === 'string' || typeof msg['id'] === 'number') ? msg['id'] : null;
      return Promise.resolve(fail(400, id, RPC.INVALID_REQUEST, 'Invalid Request: batches are not allowed with per-request _meta (one message per POST)'));
    }
    return handleMcpMessage(msg, tools, info, opts);
  }));
  const out = replies.map((r) => r.body).filter((b) => b !== null);
  return out.length ? { status: 200, body: out } : { status: 202, body: null };
}
