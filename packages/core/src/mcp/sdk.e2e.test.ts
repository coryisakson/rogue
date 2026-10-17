/**
 * End-to-end check against the official MCP TypeScript SDK client (dev dependency only), connecting over real HTTP to a
 * local node:http server that wraps handleMcpHttp with the public tool set and a fake knowledge base.
 * The SDK (1.x) speaks the legacy initialize era, so this proves today's clients can connect; mcp.test.ts covers 2026-07-28.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleMcpHttp } from './http.js';
import { PUBLIC_MCP_INSTRUCTIONS, PUBLIC_MCP_PROMPTS, publicTools } from './public-tools.js';
import { fakeKb } from './test-kb.js';

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const body = req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE' ? null : Buffer.concat(chunks);
  return new Request(new URL(req.url ?? '/', base), { method: req.method ?? 'GET', headers, body });
}

let server: Server;
let url: URL;
let modelCalls = 0;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const request = await toRequest(req, `http://${req.headers.host}`);
    const response = await handleMcpHttp(request, {
      tools: publicTools(fakeKb()), info: { name: 'rogue', version: 'test' },
      options: { instructions: PUBLIC_MCP_INSTRUCTIONS, prompts: PUBLIC_MCP_PROMPTS, requireCitations: true, strictArgs: true, allowCostly: () => ++modelCalls <= 1 },
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('official SDK client over HTTP', () => {
  it('connects, lists, calls tools and prompts', async () => {
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    // The SDK's own types disagree under our exactOptionalPropertyTypes (sessionId?: string vs string | undefined).
    await client.connect(new StreamableHTTPClientTransport(url) as unknown as Parameters<Client['connect']>[0]);
    expect(client.getServerVersion()?.name).toBe('rogue');
    expect(client.getInstructions()).toContain('citations');

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['ask_rules', 'get_game_facts', 'get_game_summary', 'get_player_aid', 'get_setup_sheet', 'list_games', 'list_sources', 'search_facts', 'search_rules']);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(t.title).toBeTruthy();
      expect(t.outputSchema).toBeDefined();
    }

    // The SDK validates structuredContent against each outputSchema, so these also prove the schemas match the data.
    for (const [name, args] of [['list_games', {}], ['get_game_summary', { game: 'pandemic' }], ['get_game_facts', { game: 'pandemic', topic: 'setup' }], ['search_facts', { q: 'cube' }],
      ['list_sources', { game: 'pandemic' }], ['get_player_aid', { game: 'pandemic' }], ['get_setup_sheet', { game: 'pandemic', players: 3 }], ['ask_rules', { game: 'pandemic', question: 'How do I win?' }]] as const) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content)}`).toBe(false);
      expect((r.structuredContent as { citations: unknown[] }).citations.length).toBeGreaterThan(0);
    }

    const limited = await client.callTool({ name: 'search_rules', arguments: { q: 'outbreak' } });
    expect(limited.isError).toBe(true); // second model call: over the fake budget of 1
    const unknown = await client.callTool({ name: 'get_game_facts', arguments: { game: 'nope' } });
    expect(unknown.isError).toBe(true);

    expect((await client.listPrompts()).prompts[0]?.name).toBe('answer_rules_question');
    expect((await client.listResources()).resources).toEqual([]);
    await client.ping();
    await client.close();
  });
});
