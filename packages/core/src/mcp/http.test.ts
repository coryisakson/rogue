import { describe, expect, it } from 'vitest';
import { acceptsJson, handleMcpHttp, MCP_MAX_BODY_BYTES, originAllowed, type McpHttpConfig } from './http.js';
import type { McpTool } from './server.js';

const tools: McpTool[] = [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' }, handler: async (a) => ({ got: a['x'] ?? null }) }];
const cfg: McpHttpConfig = { tools, info: { name: 'rogue', version: 't' } };
const URL_ = 'http://rogue.test/mcp';
const post = (body: unknown, headers: Record<string, string> = {}, c: McpHttpConfig = cfg) => handleMcpHttp(new Request(URL_, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { host: 'rogue.test', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
}), c);

describe('mcp streamable http', () => {
  it('POST request -> 200 JSON; notification -> 202 without body', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    const n = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.status).toBe(202);
    expect(await n.text()).toBe('');
  });
  it('GET and DELETE are 405 (no SSE stream, no sessions)', async () => {
    for (const method of ['GET', 'DELETE']) {
      const r = await handleMcpHttp(new Request(URL_, { method, headers: { accept: 'text/event-stream' } }), cfg);
      expect(r.status).toBe(405);
      expect(r.headers.get('allow')).toBe('POST, OPTIONS');
    }
  });
  it('validates Origin: own host, loopback and configured origins pass, others get 403', async () => {
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
    const own = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://rogue.test' });
    expect(own.status).toBe(200);
    expect(own.headers.get('access-control-allow-origin')).toBe('https://rogue.test');
    expect(originAllowed('http://localhost:6274', 'rogue.test')).toBe(true);
    expect(originAllowed('http://127.0.0.1:6274', 'rogue.test')).toBe(true);
    expect(originAllowed('https://inspector.example', 'rogue.test', ['https://inspector.example'])).toBe(true);
    expect(originAllowed('null', 'rogue.test')).toBe(false);
    expect(originAllowed('file:///x', 'rogue.test')).toBe(false);
    expect(originAllowed(null, 'rogue.test')).toBe(true);
  });
  it('answers CORS preflight for allowed browser origins', async () => {
    const r = await handleMcpHttp(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, mcp-protocol-version, mcp-method' } }), cfg);
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:6274');
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
    expect(r.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
    const bad = await handleMcpHttp(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), cfg);
    expect(bad.status).toBe(403);
  });
  it('checks Content-Type and Accept', async () => {
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'text/html' })).status).toBe(406);
    expect(acceptsJson('text/event-stream, application/json;q=0.9')).toBe(true);
    expect(acceptsJson('*/*')).toBe(true);
    expect(acceptsJson(null)).toBe(true);
    expect(acceptsJson('text/event-stream')).toBe(false);
  });
  it('parse errors are 400 with -32700', async () => {
    const r = await post('{not json');
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
  });
  it('caps the body at 64 KB, with or without Content-Length', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { x: 'a'.repeat(MCP_MAX_BODY_BYTES) } } });
    expect((await post(big)).status).toBe(413);
    // A streamed body has no Content-Length: the reader must still stop.
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 70; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close(); } });
    const r = await handleMcpHttp(new Request(URL_, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit), cfg);
    expect(r.status).toBe(413);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { x: 'a'.repeat(1000) } } })).status).toBe(200);
  });
  it('general rate limit answers 429 with Retry-After', async () => {
    let n = 0;
    const limited = { ...cfg, allowRequest: () => ++n <= 2 };
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, limited)).status).toBe(200);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, limited)).status).toBe(200);
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, limited);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
  });
  it('modern requests: version, header and unknown-method statuses; session ids ignored', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
    const h = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' };
    const ok = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, h);
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.resultType).toBe('complete');
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, { 'mcp-protocol-version': '2026-07-28' })).status).toBe(400);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'x/y', params: { _meta: meta } }, { ...h, 'mcp-method': 'x/y' })).status).toBe(404);
    const s = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-session-id': 'abc' });
    expect(s.status).toBe(200);
    expect(s.headers.get('mcp-session-id')).toBeNull();
  });
});
