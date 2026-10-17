import { describe, expect, it } from 'vitest';
import { handleMcp } from './server.js';
import { PUBLIC_MCP_PROMPTS, publicTools } from './public-tools.js';
import { buildServerCard } from './card.js';
import { fakeKb } from './test-kb.js';

const tools = publicTools(fakeKb());
const call = async (name: string, args: Record<string, unknown> = {}) =>
  ((await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, tools, { name: 'rogue', version: 't' }, { requireCitations: true, strictArgs: true })) as any).result;

describe('public MCP tools', () => {
  it('are exactly the read-only public set, each with title, annotations and a citations output schema', () => {
    expect(tools.map((t) => t.name)).toEqual(['list_games', 'get_game_summary', 'get_game_facts', 'search_facts', 'ask_rules', 'search_rules', 'get_setup_sheet', 'get_player_aid', 'list_sources']);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t.title).toBeTruthy();
      expect((t.outputSchema as any).required).toContain('citations');
      expect(t.description.length).toBeGreaterThan(60);
    }
    expect(tools.filter((t) => t.costly).map((t) => t.name)).toEqual(['ask_rules', 'search_rules']);
  });
  it('every tool returns citations on success', async () => {
    const cases: [string, Record<string, unknown>][] = [['list_games', {}], ['get_game_summary', { game: 'pandemic' }], ['get_game_facts', { game: 'pandemic' }], ['search_facts', { q: 'cube' }],
      ['ask_rules', { game: 'pandemic', question: 'how to win' }], ['search_rules', { q: 'outbreak', limit: 50 }], ['get_setup_sheet', { game: 'pandemic' }], ['get_player_aid', { game: 'pandemic' }], ['list_sources', { game: 'pandemic' }]];
    for (const [name, args] of cases) {
      const r = await call(name, args);
      expect(r.isError, `${name}: ${r.content[0].text}`).toBe(false);
      expect(r.structuredContent.citations.length).toBeGreaterThan(0);
      for (const c of r.structuredContent.citations) expect(c.url).toMatch(/^https:\/\//);
    }
  });
  it('content: compact facts, links, player aid lines with pages, source links only', async () => {
    const facts = (await call('get_game_facts', { game: 'pandemic', topic: 'setup' })).structuredContent;
    expect(facts.facts).toEqual([expect.objectContaining({ topic: 'setup', page: 'p.4', reviewed: false })]);
    const summary = (await call('get_game_summary', { game: 'pandemic' })).structuredContent;
    expect(summary.goal[0].reviewed).toBe(true);
    expect(summary.topics).toMatchObject({ goal: 1, lose: 1, setup: 1 });
    expect(summary.links.aid).toBe('https://rogue.test/games/pandemic/aid');
    const aid = (await call('get_player_aid', { game: 'pandemic', size: 'poker' })).structuredContent;
    expect(aid.url).toBe('https://rogue.test/games/pandemic/aid?size=poker');
    expect(aid.sections.flatMap((s: any) => s.lines).every((l: any) => l.page)).toBe(true);
    const setup = (await call('get_setup_sheet', { game: 'pandemic', players: 3 })).structuredContent;
    expect(setup.url).toBe('https://rogue.test/games/pandemic/setup?players=3');
    const src = (await call('list_sources', { game: 'pandemic' })).structuredContent;
    expect(src.sources).toEqual([{ title: 'Pandemic Rulebook', url: 'https://publisher.example/pandemic-rules.pdf', publisher: 'Z-Man', type: 'rulebook', language: 'en', pages: 8, available: true }]);
    const all = (await call('list_games')).structuredContent;
    expect(all.citations.map((c: any) => c.title)).toEqual(['Pandemic Rulebook', 'https://publisher.example/azul.pdf']);
    const rules = (await call('search_rules', { q: 'outbreak' })).structuredContent;
    expect(rules.citations[0]).toMatchObject({ page: 8, quote: expect.stringContaining('outbreak') });
  });
  it('no sources or bad input -> isError with an LLM-readable message', async () => {
    expect((await call('get_game_facts', { game: 'nope' })).content[0].text).toMatch(/Unknown game "nope".*list_games/);
    expect((await call('get_game_facts', { game: 'empty' })).isError).toBe(true); // no facts = no citations
    expect((await call('list_sources', { game: 'empty' })).isError).toBe(true);
    expect((await call('get_player_aid', { game: 'empty' })).isError).toBe(true);
    expect((await call('search_rules', { q: 'nothing' })).content[0].text).toMatch(/never answers without a source/);
    expect((await call('get_player_aid', { game: 'pandemic', size: 'huge' })).content[0].text).toMatch(/one of/);
    expect((await call('ask_rules', { game: 'pandemic' })).content[0].text).toMatch(/question/);
    expect((await call('search_facts', { q: 'a' })).isError).toBe(true);
  });
  it('prompt and server card', () => {
    expect(PUBLIC_MCP_PROMPTS[0]!.text({ game: 'Azul', question: 'Q?' })).toContain('cite the page');
    const card = buildServerCard({ name: 'rogue', title: 'Rogue', version: '1', description: 'd', mcpUrl: 'https://r/mcp', websiteUrl: 'https://r/docs/mcp' });
    expect(card['remotes']).toEqual([{ type: 'streamable-http', url: 'https://r/mcp', supportedProtocolVersions: expect.arrayContaining(['2026-07-28', '2025-11-25']) }]);
    expect(card['tools']).toBeUndefined();
  });
});
