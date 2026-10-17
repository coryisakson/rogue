import { describe, expect, it } from 'vitest';
import { mcpChallenge, scopesNeeded, type McpCaller } from './auth.js';
import { handleMcpHttp, type McpHttpConfig } from './http.js';
import type { McpTool } from './server.js';
import { userTools, type McpUserApi } from './user-tools.js';

const PRM = 'https://rogue.test/.well-known/oauth-protected-resource/mcp';
const call = (name: string, args: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

const ratings: { id: number; stars: number }[] = [];
const api: McpUserApi = {
  profile: async () => ({ name: 'Ada', provider: 'github', language: null, scopes: ['profile:read'] }),
  rateFact: async (id, stars) => {
    if (id === 404) return { ok: false, error: 'Fact not found or not published.' };
    ratings.push({ id, stars });
    return { ok: true, fact: { id, game: 'pandemic', topic: 'setup', text: 'x' } };
  },
  requestGame: async (i) => (i.rulebook_url ? { ok: true, id: 7, status: 'submitted' } : { ok: true, id: 8, status: 'manual' }),
};
const publicTool: McpTool = { name: 'list_games', description: 'd', inputSchema: { type: 'object' }, handler: async () => ({ citations: [{ title: 't', url: 'https://x' }] }) };
const tools = [publicTool, ...userTools(api)];

describe('mcp scope gate', () => {
  it('collects the scopes of called signed-in tools, batches included', () => {
    expect(scopesNeeded(call('list_games'), tools)).toEqual([]);
    expect(scopesNeeded({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tools)).toEqual([]);
    expect(scopesNeeded([call('rate_fact'), call('request_game', {}, 2), call('rate_fact', {}, 3)], tools)).toEqual(['facts:rate', 'games:request']);
  });
  it('anonymous: public tools pass, signed-in tools get 401 with the scope', () => {
    const anon: McpCaller = { kind: 'anonymous' };
    expect(mcpChallenge(call('list_games'), tools, anon, PRM)).toBeNull();
    const c = mcpChallenge(call('rate_fact'), tools, anon, PRM)!;
    expect(c.status).toBe(401);
    expect(c.wwwAuthenticate).toBe(`Bearer resource_metadata="${PRM}", scope="facts:rate"`);
  });
  it('a rejected token is 401 invalid_token even for public tools', () => {
    const c = mcpChallenge(call('list_games'), tools, { kind: 'invalid' }, PRM)!;
    expect(c.status).toBe(401);
    expect(c.wwwAuthenticate).toContain('error="invalid_token"');
  });
  it('a token without the scope is 403 insufficient_scope; with it, the call passes', () => {
    const user: McpCaller = { kind: 'user', scopes: ['profile:read'] };
    const c = mcpChallenge(call('rate_fact'), tools, user, PRM)!;
    expect(c.status).toBe(403);
    expect(c.wwwAuthenticate).toContain('error="insufficient_scope"');
    expect(c.wwwAuthenticate).toContain('scope="facts:rate"');
    expect(mcpChallenge(call('rate_fact'), tools, { kind: 'user', scopes: ['facts:rate'] }, PRM)).toBeNull();
  });
});

describe('mcp http with OAuth', () => {
  const cfg = (caller: McpCaller): McpHttpConfig => ({
    tools, info: { name: 'rogue', version: 't' }, options: { requireCitations: true, strictArgs: true },
    challenge: (body) => mcpChallenge(body, tools, caller, PRM),
  });
  const post = (body: unknown, caller: McpCaller, headers: Record<string, string> = {}) => handleMcpHttp(new Request('http://rogue.test/mcp', {
    method: 'POST', body: JSON.stringify(body), headers: { host: 'rogue.test', 'content-type': 'application/json', ...headers },
  }), cfg(caller));

  it('answers 401 + WWW-Authenticate (exposed to CORS) for a signed-in tool without a token', async () => {
    const r = await post(call('rate_fact', { fact_id: 1, stars: 5 }), { kind: 'anonymous' }, { origin: 'http://localhost:6274' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(r.headers.get('access-control-expose-headers')).toContain('www-authenticate');
  });
  it('public tools still work without a token', async () => {
    const r = await post(call('list_games'), { kind: 'anonymous' });
    expect(r.status).toBe(200);
    expect((await r.json()).result.isError).toBe(false);
  });
  it('runs the write with a scoped token; receipts skip the citation rule', async () => {
    const r = await post(call('rate_fact', { fact_id: 3, stars: 4 }), { kind: 'user', scopes: ['facts:rate'] });
    const j = await r.json();
    expect(j.result.isError).toBe(false);
    expect(j.result.structuredContent).toMatchObject({ rated: true, stars: 4, fact: { id: 3 } });
    expect(ratings).toContainEqual({ id: 3, stars: 4 });
  });
  it('returns website validation errors as tool errors', async () => {
    const bad = await (await post(call('rate_fact', { fact_id: 1, stars: 9 }), { kind: 'user', scopes: ['facts:rate'] })).json();
    expect(bad.result.isError).toBe(true);
    const missing = await (await post(call('rate_fact', { fact_id: 404, stars: 3 }), { kind: 'user', scopes: ['facts:rate'] })).json();
    expect(missing.result.content[0].text).toContain('not found');
    const empty = await (await post(call('request_game', {}), { kind: 'user', scopes: ['games:request'] })).json();
    expect(empty.result.isError).toBe(true);
    const ok = await (await post(call('request_game', { name: 'Azul', publisher: 'Plan B', rulebook_url: 'https://a.example/r.pdf' }), { kind: 'user', scopes: ['games:request'] })).json();
    expect(ok.result.structuredContent).toMatchObject({ request_id: 7, status: 'submitted' });
  });
  it('signed-in tools are marked as writes with scopes', () => {
    const byName = Object.fromEntries(userTools(api).map((t) => [t.name, t]));
    expect(byName['rate_fact']!.annotations?.readOnlyHint).toBe(false);
    expect(byName['request_game']!.scopes).toEqual(['games:request']);
    expect(byName['get_my_profile']!.scopes).toEqual(['profile:read']);
  });
});
