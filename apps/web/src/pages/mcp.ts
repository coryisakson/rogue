import type { APIRoute } from 'astro';
import { handleMcp, type McpTool } from '@rogue/core';
import { getClaims, getGame, listGames, searchClaims } from '../lib/kb';
import { askRules } from '../lib/chat';
import { searchRules } from '../lib/rules-index';
import { VERSION } from '../lib/version';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Read-only tools for anonymous agents. Auth'd tools (add game, ask, rate) come with the auth milestone. */
const tools: McpTool[] = [
  {
    name: 'list_games',
    description: 'List games in the Rogue knowledge base with how many cited facts each has.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ games: await listGames() }),
  },
  {
    name: 'get_game_facts',
    description: 'Get cited facts for one game. Optionally filter by topic (goal, lose, setup, turn, player_count_variant) or a text query. Every fact includes source title, URL, page and a short quote.',
    inputSchema: { type: 'object', properties: { game: { type: 'string', description: 'game slug, e.g. pandemic' }, topic: { type: 'string' }, q: { type: 'string' } }, required: ['game'] },
    handler: async (a) => {
      const slug = str(a['game']); if (!slug) throw new Error('game is required');
      const game = await getGame(slug); if (!game) throw new Error(`unknown game: ${slug}`);
      const opts: { topic?: string; q?: string } = {};
      const t = str(a['topic']), q = str(a['q']);
      if (t) opts.topic = t;
      if (q) opts.q = q;
      return { game, facts: await getClaims(slug, opts), note: 'Facts are AI-written from the publisher rulebook and automatically quote-checked against the cited page; a person has reviewed only those marked Human-reviewed. Cite the source when answering.' };
    },
  },
  {
    name: 'search_facts',
    description: 'Text search across all published facts in every game.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    handler: async (a) => {
      const q = str(a['q']); if (!q || q.length < 2) throw new Error('q must be at least 2 characters');
      return { results: await searchClaims(q) };
    },
  },
  {
    name: 'ask_rules',
    description: 'Ask a rules question about one game. Retrieves page-cited rulebook excerpts, then answers ONLY from them with (p.N) citations. Returns the answer plus the source excerpts.',
    inputSchema: { type: 'object', properties: { game: { type: 'string', description: 'game slug' }, question: { type: 'string' } }, required: ['game', 'question'] },
    handler: async (a) => {
      const game = str(a['game']); const question = str(a['question']);
      if (!game || !question || question.length < 3) throw new Error('game and question are required');
      return await askRules(game, question);
    },
  },
  {
    name: 'search_rules',
    description: 'Search the FULL indexed rulebook text (not only curated facts) with keyword + semantic retrieval. Returns page-cited snippets from the publisher rulebook. Use this to answer rules questions, then quote the snippet and cite the page.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, game: { type: 'string', description: 'optional game slug' }, limit: { type: 'number' } }, required: ['q'] },
    handler: async (a) => {
      const q = str(a['q']); if (!q || q.length < 2) throw new Error('q must be at least 2 characters');
      const o: { game?: string; limit?: number; rerank?: boolean } = { rerank: true };
      const g = str(a['game']); if (g) o.game = g;
      if (typeof a['limit'] === 'number') o.limit = a['limit'];
      return { hits: await searchRules(q, o), note: 'Snippets are short excerpts of the private working copy; the publisher link is the authority.' };
    },
  },
  {
    name: 'get_setup_sheet',
    description: 'Get the URL of the printable one-page setup sheet for a game, optionally highlighting a player count.',
    inputSchema: { type: 'object', properties: { game: { type: 'string' }, players: { type: 'number' } }, required: ['game'] },
    handler: async (a) => {
      const slug = str(a['game']); if (!slug) throw new Error('game is required');
      const game = await getGame(slug); if (!game) throw new Error(`unknown game: ${slug}`);
      if (game.claim_count === 0) throw new Error(`${game.name} has no cited setup facts yet`);
      const p = typeof a['players'] === 'number' ? `?players=${a['players']}` : '';
      return { game: game.name, path: `/games/${slug}/setup${p}`, format: 'html, prints on half-letter (5.5x8.5in)' };
    },
  },
];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const res = await handleMcp(body, tools, { name: 'rogue', version: VERSION });
  return res === null ? new Response(null, { status: 202 }) : json(res);
};

export const GET: APIRoute = () => json({ name: 'rogue', mcp: 'POST JSON-RPC 2.0 to this URL', tools: tools.map((t) => t.name) });
