import { describe, expect, it } from 'vitest';
import { checkArgs, cleanCitations, decodeHeaderValue, handleMcp, handleMcpMessage, LEGACY_PROTOCOL_VERSIONS, MAX_BATCH, type McpTool } from './server.js';

const tools: McpTool[] = [
  { name: 'echo', title: 'Echo', description: 'echo', inputSchema: { type: 'object', properties: { x: { type: 'string' }, n: { type: 'integer' } } }, annotations: { readOnlyHint: true, openWorldHint: false }, handler: async (a) => ({ got: a['x'] }) },
  { name: 'boom', description: 'fails', inputSchema: { type: 'object' }, handler: async () => { throw new Error('nope'); } },
  { name: 'cited', description: 'cited', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }, handler: async (a) => ({ q: a['q'], citations: a['q'] === 'none' ? [] : [{ title: 'Rulebook', url: 'https://pub.example/rules.pdf', page: 3 }] }) },
  { name: 'pricey', description: 'uses the model', inputSchema: { type: 'object' }, costly: true, handler: async () => ({ citations: [{ title: 't', url: 'https://x' }] }) },
];
const info = { name: 'rogue', version: 't' };
const call = (b: unknown, opts = {}) => handleMcp(b, tools, info, opts) as Promise<any>;
const MODERN = '2026-07-28';
const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} };
const modernHeaders = (method: string, name?: string) => new Headers({ 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}) });

describe('mcp protocol (legacy initialize era)', () => {
  it('initializes and lists tools with titles and annotations', async () => {
    const init = (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } })).result;
    expect(init.serverInfo.name).toBe('rogue');
    expect(init.capabilities.tools).toBeDefined();
    const list = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools;
    expect(list.map((t: any) => t.name)).toEqual(['echo', 'boom', 'cited', 'pricey']);
    expect(list[0]).toMatchObject({ title: 'Echo', annotations: { readOnlyHint: true, openWorldHint: false } });
    expect(list[0].resultType).toBeUndefined();
  });
  it('negotiates the protocol version: echoes a supported one, else offers the newest legacy one', async () => {
    for (const v of LEGACY_PROTOCOL_VERSIONS) expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } })).result.protocolVersion).toBe(v);
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion).toBe('2025-11-25');
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.protocolVersion).toBe('2025-11-25');
  });
  it('calls tools: text plus structuredContent, tool errors as isError', async () => {
    const r = (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 'hi' } } })).result;
    expect(JSON.parse(r.content[0].text)).toEqual({ got: 'hi' });
    expect(r.structuredContent).toEqual({ got: 'hi' });
    expect(r.isError).toBe(false);
    const boom = (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } })).result;
    expect(boom).toMatchObject({ isError: true, content: [{ type: 'text', text: 'nope' }] });
  });
  it('invalid params: unknown tool and non-object arguments are protocol errors, bad argument values are tool errors', async () => {
    expect((await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'zzz' } })).error.code).toBe(-32602);
    expect((await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: [1] } })).error.code).toBe(-32602);
    expect((await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: 'x' })).error.code).toBe(-32602);
    const strict = { strictArgs: true };
    const bad = (await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: { n: 1.5 } } }, strict)).result;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('"n" must be of type integer');
    const missing = (await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'cited', arguments: {} } }, strict)).result;
    expect(missing.content[0].text).toContain('Missing required argument "q"');
    // Without strictArgs (the agent endpoints) the handler sees the arguments as sent, as before.
    expect((await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: { n: 1.5 } } })).result.isError).toBe(false);
  });
  it('unknown methods, notifications, malformed messages', async () => {
    expect((await call({ jsonrpc: '2.0', id: 6, method: 'nope' })).error.code).toBe(-32601);
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await call({ jsonrpc: '2.0', method: 'notifications/whatever' })).toBeNull();
    expect((await call({ hello: 1 })).error.code).toBe(-32600);
    expect((await call({ jsonrpc: '2.0', id: null, method: 'ping' })).error.code).toBe(-32600);
    expect((await call({ jsonrpc: '2.0', id: 1, result: {} })).error.code).toBe(-32600);
    expect((await call('x')).error.code).toBe(-32600);
  });
  it('probing clients get empty resources and a prompt list instead of errors', async () => {
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).result).toEqual({ resources: [] });
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list' })).result).toEqual({ resourceTemplates: [] });
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'prompts/list' })).result).toEqual({ prompts: [] });
    const prompts = [{ name: 'p', description: 'd', arguments: [{ name: 'game', description: 'g', required: true }], text: (a: Record<string, string>) => `about ${a['game']}` }];
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'p', arguments: { game: 'azul' } } }, { prompts })).result.messages[0].content.text).toBe('about azul');
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'p' } }, { prompts })).error.code).toBe(-32602);
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'ping' })).result).toEqual({});
  });
  it('batches (2025-03-26): answers requests in order, drops notifications, caps size', async () => {
    const out = await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'nope' }]);
    expect(out.map((r: any) => r.id)).toEqual([1, 2]);
    expect(out[1].error.code).toBe(-32601);
    expect(await call([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).toBeNull();
    expect((await call([])).error.code).toBe(-32600);
    expect((await call(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))).error.code).toBe(-32600);
    // Modern messages must come one per POST.
    expect((await call([{ jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: meta } }]))[0].error.code).toBe(-32600);
  });
});

describe('mcp protocol (2026-07-28 per-request _meta)', () => {
  it('serves server/discover and stamps results with resultType and serverInfo', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: meta } }, tools, info, { instructions: 'hi' });
    expect(r.status).toBe(200);
    const res = (r.body as any).result;
    expect(res).toMatchObject({ resultType: 'complete', instructions: 'hi', _meta: { 'io.modelcontextprotocol/serverInfo': info } });
    expect(res.supportedVersions).toContain(MODERN);
    expect(res.supportedVersions).toContain('2025-11-25');
    const call2 = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { x: 'a' }, _meta: meta } }, tools, info);
    expect((call2.body as any).result).toMatchObject({ resultType: 'complete', isError: false });
  });
  it('rejects unsupported versions with -32022 and the supported list (HTTP 400)', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...meta, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }, tools, info);
    expect(r.status).toBe(400);
    expect((r.body as any).error).toMatchObject({ code: -32022, data: { requested: '1900-01-01' } });
    expect((r.body as any).error.data.supported).toContain(MODERN);
    const legacyHeader = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools, info, { headers: new Headers({ 'mcp-protocol-version': '1900-01-01' }) });
    expect([legacyHeader.status, (legacyHeader.body as any).error.code]).toEqual([400, -32022]);
  });
  it('requires clientCapabilities, refuses initialize, answers unknown methods with 404', async () => {
    const noCaps = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } }, tools, info);
    expect([noCaps.status, (noCaps.body as any).error.code]).toEqual([400, -32602]);
    const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { _meta: meta } }, tools, info);
    expect([init.status, (init.body as any).error.code]).toEqual([404, -32601]);
    const unknown = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tasks/list', params: { _meta: meta } }, tools, info);
    expect([unknown.status, (unknown.body as any).error.code]).toEqual([404, -32601]);
    const discoverLegacy = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'server/discover' }, tools, info);
    expect(discoverLegacy.status).toBe(400);
  });
  it('validates mirrored HTTP headers (HeaderMismatch -32020)', async () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {}, _meta: meta } };
    expect((await handleMcpMessage(msg, tools, info, { headers: modernHeaders('tools/call', 'echo') })).status).toBe(200);
    for (const h of [modernHeaders('tools/list', 'echo'), modernHeaders('tools/call', 'boom'), modernHeaders('tools/call'), new Headers({ 'mcp-method': 'tools/call', 'mcp-name': 'echo' })]) {
      const r = await handleMcpMessage(msg, tools, info, { headers: h });
      expect([r.status, (r.body as any).error.code]).toEqual([400, -32020]);
    }
    const b64 = `=?base64?${btoa('echo')}?=`;
    expect((await handleMcpMessage(msg, tools, info, { headers: modernHeaders('tools/call', b64) })).status).toBe(200);
  });
});

describe('citations and rate limits', () => {
  it('requireCitations turns a result without sources into isError', async () => {
    const ok = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cited', arguments: { q: 'x' } } }, { requireCitations: true })).result;
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent.citations[0].page).toBe(3);
    const none = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cited', arguments: { q: 'none' } } }, { requireCitations: true })).result;
    expect(none.isError).toBe(true);
    expect(none.structuredContent).toBeUndefined();
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } }, { requireCitations: true })).result.isError).toBe(true);
  });
  it('costly tools go through the model budget; others do not', async () => {
    let n = 0;
    const allowCostly = () => ++n <= 1;
    const p = (name: string) => call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, { allowCostly });
    expect((await p('pricey')).result.isError).toBe(false);
    const limited = (await p('pricey')).result;
    expect(limited.isError).toBe(true);
    expect(limited.content[0].text).toMatch(/Rate limit/);
    expect((await p('echo')).result.isError).toBe(false);
    expect(n).toBe(2);
  });
  it('helpers', () => {
    expect(cleanCitations([{ url: '' }, { title: '', url: 'https://a' }, { title: 'A', url: 'https://a' }, { title: 'B', url: 'https://a', page: 2 }]))
      .toEqual([{ title: 'https://a', url: 'https://a' }, { title: 'B', url: 'https://a', page: 2 }]);
    expect(checkArgs({ properties: { s: { type: 'string', enum: ['a'] } } }, { s: 'b' })).toMatch(/one of: a/);
    expect(checkArgs({ properties: {} }, { extra: 1 })).toBeNull();
    expect(decodeHeaderValue(`=?base64?${btoa('Hello')}?=`)).toBe('Hello');
    expect(decodeHeaderValue('plain')).toBe('plain');
  });
});
