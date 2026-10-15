import { describe, expect, it } from 'vitest';
import { handleMcp, type McpTool } from './server.js';

const tools: McpTool[] = [
  { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { x: { type: 'string' } } }, handler: async (a) => ({ got: a['x'] }) },
  { name: 'boom', description: 'fails', inputSchema: { type: 'object' }, handler: async () => { throw new Error('nope'); } },
];
const info = { name: 'rogue', version: 't' };
const call = (b: unknown) => handleMcp(b, tools, info) as Promise<any>;

describe('mcp', () => {
  it('initializes and lists tools', async () => {
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.serverInfo.name).toBe('rogue');
    expect((await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map((t: any) => t.name)).toEqual(['echo', 'boom']);
  });
  it('calls tools and reports tool errors as isError', async () => {
    const r = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { x: 'hi' } } });
    expect(JSON.parse(r.result.content[0].text)).toEqual({ got: 'hi' });
    expect((await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } })).result.isError).toBe(true);
  });
  it('rejects unknown tools/methods, ignores notifications, handles bad input', async () => {
    expect((await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'zzz' } })).error.code).toBe(-32602);
    expect((await call({ jsonrpc: '2.0', id: 6, method: 'nope' })).error.code).toBe(-32601);
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect((await call({ hello: 1 })).error.code).toBe(-32600);
  });
});
