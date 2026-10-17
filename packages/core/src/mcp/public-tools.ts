/**
 * The public, read-only MCP tool set (served at /mcp). Data access is injected (PublicKb) so the tools are testable
 * without a database, and so nothing outside this list (admin, agents, writes) can be reached through the endpoint.
 * Every tool returns `citations`; the server turns a result without them into an isError result.
 * Rights: only published facts, short excerpts and publisher links. Never whole pages or files.
 */
import { buildAid, CARD_SIZES, resolveCardSize } from '../aid/aid.js';
import { citedOutputSchema, cleanCitations, type Citation, type McpPrompt, type McpTool, type McpToolAnnotations } from './server.js';

export interface KbGame { slug: string; name: string; publisher: string | null; year: number | null; min_players: number | null; max_players: number | null; card_size: string | null; claim_count: number }
export interface KbFact { id: string; topic: string; player_count: number | null; body: string; verified_at: string | null; locator: string | null; quote: string | null; source_title: string | null; source_url: string | null; publisher: string | null }
export interface KbFactHit { slug: string; game: string; topic: string; player_count: number | null; body: string; locator: string | null; source_title: string | null; source_url: string | null }
export interface KbSource { slug: string; title: string | null; url: string; publisher: string | null; kind: string; language: string | null; page_count: number | null; availability: string }
export interface KbRuleHit { slug: string; game: string; page: number; printed: number | null; section: string | null; snippet: string; source_title: string; source_url: string; publisher: string | null }
export interface KbAnswer { answer: string; warning?: string; sources: { page: number; printed: number | null; section: string | null; title: string; url: string; publisher: string | null; quote: string }[] }

export interface PublicKb {
  /** Absolute site origin, e.g. https://rogue.example, for page links in results. */
  baseUrl: string;
  listGames(): Promise<KbGame[]>;
  getFacts(slug: string, opts?: { topic?: string; q?: string }): Promise<KbFact[]>;
  searchFacts(q: string): Promise<KbFactHit[]>;
  /** Sources for one game, or for every game when slug is omitted. */
  listSources(slug?: string): Promise<KbSource[]>;
  askRules(game: string, question: string): Promise<KbAnswer>;
  searchRules(q: string, opts: { game?: string; limit: number }): Promise<KbRuleHit[]>;
}

const READ_ONLY: McpToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const NOTE = 'Facts are machine-written from the publisher rulebook and automatically quote-checked against the cited page; only facts with reviewed=true were checked by a person. Quote briefly and cite the source URL and page when you answer.';
const SLUG = { type: 'string', description: 'Game slug from list_games, e.g. "pandemic" or "slay-the-spire".' };
const GAME_ONLY = { type: 'object', properties: { game: SLUG }, required: ['game'], additionalProperties: false };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);

const factCitation = (f: { source_title: string | null; source_url: string | null; locator: string | null; publisher?: string | null; quote?: string | null }): Partial<Citation> =>
  ({ title: f.source_title ?? '', url: f.source_url ?? '', page: f.locator, publisher: f.publisher ?? null, quote: clip(f.quote, 200) });
const sourceCitation = (s: KbSource): Partial<Citation> => ({ title: s.title ?? '', url: s.url, publisher: s.publisher });

/** Short, LLM-friendly fact shape (no ratings, no internal ids beyond the fact id). */
const compactFact = (f: KbFact) => ({
  id: f.id, topic: f.topic, player_count: f.player_count, text: f.body, page: f.locator, reviewed: f.verified_at !== null,
  source: { title: f.source_title, url: f.source_url },
});

export function publicTools(kb: PublicKb): McpTool[] {
  const page = (path: string) => `${kb.baseUrl}${path}`;
  async function game(a: Record<string, unknown>): Promise<KbGame> {
    const slug = str(a['game']);
    if (!slug) throw new Error('Argument "game" is required (a slug from list_games).');
    const g = (await kb.listGames()).find((x) => x.slug === slug.toLowerCase());
    if (!g) throw new Error(`Unknown game "${slug}". Call list_games for the available slugs.`);
    return g;
  }

  return [
    {
      name: 'list_games',
      title: 'List games',
      description: 'List every game in the Rogue knowledge base: slug (use it in the other tools), name, publisher, year, player range and how many cited facts it has. Call this first when you do not know the slug. Citations are the publisher sources held for those games.',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: citedOutputSchema({ games: { type: 'array' } }),
      annotations: READ_ONLY,
      handler: async () => {
        const [games, sources] = await Promise.all([kb.listGames(), kb.listSources()]);
        const count = (slug: string) => sources.filter((s) => s.slug === slug).length;
        return {
          games: games.map((g) => ({ slug: g.slug, name: g.name, publisher: g.publisher, year: g.year, players: [g.min_players, g.max_players], facts: g.claim_count, sources: count(g.slug), page: page(`/games/${g.slug}`) })),
          citations: cleanCitations(sources.map(sourceCitation)),
        };
      },
    },
    {
      name: 'get_game_summary',
      title: 'Game summary',
      description: 'Short overview of one game: publisher, year, player range, the cited goal and how you lose, how many facts exist per topic, and links to the setup sheet, player aid and fact list. Good first call before answering anything about a game.',
      inputSchema: GAME_ONLY,
      outputSchema: citedOutputSchema({ game: { type: 'object' }, goal: { type: 'array' }, lose: { type: 'array' }, topics: { type: 'object' }, links: { type: 'object' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const g = await game(a);
        const facts = await kb.getFacts(g.slug);
        const topics: Record<string, number> = {};
        for (const f of facts) topics[f.topic] = (topics[f.topic] ?? 0) + 1;
        const pick = (topic: string) => facts.filter((f) => f.topic === topic).slice(0, 3);
        const goal = pick('goal'), lose = pick('lose');
        // Cite the facts we show; with no goal/lose facts, fall back to every fact's source so the counts are still sourced.
        const shown = goal.length + lose.length ? [...goal, ...lose] : facts;
        return {
          game: { slug: g.slug, name: g.name, publisher: g.publisher, year: g.year, players: [g.min_players, g.max_players], facts: g.claim_count },
          goal: goal.map(compactFact), lose: lose.map(compactFact), topics,
          links: { game: page(`/games/${g.slug}`), setup: page(`/games/${g.slug}/setup`), aid: page(`/games/${g.slug}/aid`), facts: page(`/games/${g.slug}/facts`) },
          note: NOTE,
          citations: cleanCitations(shown.map(factCitation)),
        };
      },
    },
    {
      name: 'get_game_facts',
      title: 'Get cited facts',
      description: 'Get the published, cited facts for one game, optionally filtered by topic (goal, lose, setup, turn, actions, player_count_variant) or by a word in the fact text. Each fact has its source title, URL and page. Use this for setup and rules questions before ask_rules: it is fast and needs no AI.',
      inputSchema: { type: 'object', properties: { game: SLUG, topic: { type: 'string', description: 'Optional topic filter, e.g. "setup".' }, q: { type: 'string', description: 'Optional word or phrase the fact must contain.' } }, required: ['game'], additionalProperties: false },
      outputSchema: citedOutputSchema({ game: { type: 'string' }, facts: { type: 'array' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const g = await game(a);
        const opts: { topic?: string; q?: string } = {};
        const t = str(a['topic']), q = str(a['q']);
        if (t) opts.topic = t;
        if (q) opts.q = q;
        const facts = await kb.getFacts(g.slug, opts);
        return { game: g.name, facts: facts.map(compactFact), note: NOTE, citations: cleanCitations(facts.map(factCitation)) };
      },
    },
    {
      name: 'search_facts',
      title: 'Search facts',
      description: 'Plain text search across the published facts of every game (up to 50 hits). Use it when you do not know which game a term belongs to; for one game prefer get_game_facts with q.',
      inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Word or phrase, at least 2 characters.' } }, required: ['q'], additionalProperties: false },
      outputSchema: citedOutputSchema({ results: { type: 'array' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const q = str(a['q']);
        if (!q || q.length < 2) throw new Error('Argument "q" must be at least 2 characters.');
        const hits = await kb.searchFacts(q);
        return {
          results: hits.map((h) => ({ game: h.slug, topic: h.topic, player_count: h.player_count, text: h.body, page: h.locator, source: { title: h.source_title, url: h.source_url } })),
          citations: cleanCitations(hits.map(factCitation)),
        };
      },
    },
    {
      name: 'ask_rules',
      title: 'Ask a rules question',
      description: 'Ask a rules question about one game in plain language. Rogue retrieves page-cited rulebook excerpts and its AI answers ONLY from them, with (p.N) page references. Slower and rate-limited (a few calls per minute); try get_game_facts or search_rules first for simple lookups. If a warning is returned, some page references could not be verified.',
      inputSchema: { type: 'object', properties: { game: SLUG, question: { type: 'string', description: 'The rules question, 3 to 300 characters, e.g. "Can I share knowledge with a player in another city?"' } }, required: ['game', 'question'], additionalProperties: false },
      outputSchema: citedOutputSchema({ answer: { type: 'string' }, warning: { type: 'string' } }),
      annotations: { ...READ_ONLY, idempotentHint: false },
      costly: true,
      handler: async (a) => {
        const g = await game(a);
        const question = str(a['question']);
        if (!question || question.length < 3) throw new Error('Argument "question" must be at least 3 characters.');
        const r = await kb.askRules(g.slug, question.slice(0, 300));
        return {
          answer: r.answer, ...(r.warning ? { warning: r.warning } : {}),
          citations: cleanCitations(r.sources.map((s) => ({ title: s.title, url: s.url, page: s.printed ? `${s.page} (printed ${s.printed})` : s.page, publisher: s.publisher, quote: clip(s.quote, 200) }))),
        };
      },
    },
    {
      name: 'search_rules',
      title: 'Search rulebook text',
      description: 'Search the indexed rulebook text (not only curated facts) with keyword + semantic retrieval. Returns short page-cited snippets from the publisher documents. Use it to find the passage behind a rules question, then quote briefly and cite the page and URL. Rate-limited like ask_rules.',
      inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Search words or a question, at least 2 characters.' }, game: { ...SLUG, description: 'Optional game slug to search only that game.' }, limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of snippets, 1-10 (default 5).' } }, required: ['q'], additionalProperties: false },
      outputSchema: citedOutputSchema({ hits: { type: 'array' } }),
      annotations: READ_ONLY,
      costly: true,
      handler: async (a) => {
        const q = str(a['q']);
        if (!q || q.length < 2) throw new Error('Argument "q" must be at least 2 characters.');
        const g = str(a['game']);
        const limit = Math.min(10, Math.max(1, typeof a['limit'] === 'number' ? Math.floor(a['limit']) : 5));
        const hits = await kb.searchRules(q.slice(0, 300), { ...(g ? { game: g } : {}), limit });
        return {
          hits: hits.map((h) => ({ game: h.slug, page: h.page, printed_page: h.printed, section: h.section, snippet: clip(h.snippet, 400), source: { title: h.source_title, url: h.source_url } })),
          note: 'Snippets are short excerpts; the publisher link is the authority.',
          citations: cleanCitations(hits.map((h) => ({ title: h.source_title, url: h.source_url, page: h.page, publisher: h.publisher, quote: clip(h.snippet, 200) }))),
        };
      },
    },
    {
      name: 'get_setup_sheet',
      title: 'Setup sheet link',
      description: 'Get the link to the printable one-page setup sheet for a game (half-letter), optionally highlighting one player count, plus the sources it is built from. Give the user the URL; do not try to reproduce the sheet.',
      inputSchema: { type: 'object', properties: { game: SLUG, players: { type: 'integer', minimum: 1, maximum: 12, description: 'Optional player count to highlight.' } }, required: ['game'], additionalProperties: false },
      outputSchema: citedOutputSchema({ game: { type: 'string' }, url: { type: 'string' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const g = await game(a);
        const facts = await kb.getFacts(g.slug);
        if (!facts.length) throw new Error(`${g.name} has no cited setup facts yet.`);
        const p = typeof a['players'] === 'number' ? `?players=${Math.floor(a['players'])}` : '';
        return { game: g.name, url: page(`/games/${g.slug}/setup${p}`), format: 'HTML, prints on half-letter (5.5x8.5in)', 
          // The sheet is built from all of the game's facts: cite each source once (no page, no quote).
          citations: cleanCitations(facts.map((f) => ({ ...factCitation(f), page: null, quote: null }))) };
      },
    },
    {
      name: 'get_player_aid',
      title: 'Player aid',
      description: 'Get the player aid (reference card) for a game: short cited reminders for your turn, actions and how to win or lose, each with its rulebook page, plus a link to the printable card. Sizes: poker, mini, tarot, page, letter.',
      inputSchema: { type: 'object', properties: { game: SLUG, size: { type: 'string', enum: Object.keys(CARD_SIZES), description: 'Optional card size; the game default otherwise.' } }, required: ['game'], additionalProperties: false },
      outputSchema: citedOutputSchema({ game: { type: 'string' }, size: { type: 'string' }, url: { type: 'string' }, sections: { type: 'array' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const g = await game(a);
        const facts = await kb.getFacts(g.slug);
        const size = resolveCardSize(str(a['size']), g.card_size);
        const aid = buildAid(facts, size.key, `Player aid: ${g.name}`);
        const byId = new Map(facts.map((f) => [f.id, f]));
        const sections = aid.sections.filter((s) => s.lines.length).map((s) => ({ title: s.title, lines: s.lines.map((l) => ({ text: l.text, page: l.page, source: byId.get(l.id)?.source_url ?? null })) }));
        if (!sections.length) throw new Error(`${g.name} has no player aid yet (no cited turn, action or win/lose facts).`);
        // Only the sources behind lines on the card, as on the aid page.
        const used = aid.sections.flatMap((s) => s.lines.map((l) => byId.get(l.id))).filter((f): f is KbFact => !!f);
        return { game: g.name, size: size.key, url: page(`/games/${g.slug}/aid?size=${size.key}`), sections, note: NOTE, citations: cleanCitations(used.map(factCitation)) };
      },
    },
    {
      name: 'list_sources',
      title: 'List sources',
      description: 'List the documents Rogue holds for a game (rulebook, FAQ, errata, ...): title, publisher link, type, language and page count. Links only: Rogue never serves the files themselves, so send the user to the publisher URL.',
      inputSchema: GAME_ONLY,
      outputSchema: citedOutputSchema({ game: { type: 'string' }, sources: { type: 'array' } }),
      annotations: READ_ONLY,
      handler: async (a) => {
        const g = await game(a);
        const sources = await kb.listSources(g.slug);
        return {
          game: g.name,
          sources: sources.map((s) => ({ title: s.title, url: s.url, publisher: s.publisher, type: s.kind, language: s.language, pages: s.page_count, available: s.availability === 'available' })),
          citations: cleanCitations(sources.map(sourceCitation)),
        };
      },
    },
  ];
}

export const PUBLIC_MCP_INSTRUCTIONS = 'Rogue is a cited tabletop-game rules knowledge base. Start with list_games to find a slug, then get_game_summary or get_game_facts. Use search_rules or ask_rules for questions the facts do not cover (both are rate-limited). Every result has citations: quote briefly, name the page and link the publisher source. Facts are machine-written and quote-checked; only reviewed=true facts were checked by a person. Never present Rogue output as the official rulebook.';

export const PUBLIC_MCP_PROMPTS: McpPrompt[] = [
  {
    name: 'answer_rules_question',
    title: 'Answer a rules question with citations',
    description: 'Answer a board game rules question using Rogue tools, citing the rulebook page and publisher link.',
    arguments: [{ name: 'game', description: 'Game name or slug', required: true }, { name: 'question', description: 'The rules question', required: true }],
    text: (a) => `Answer this rules question about ${a['game']}: "${a['question']}". Use list_games to find the slug if needed, then get_game_facts, and search_rules or ask_rules if the facts do not cover it. Answer only from what the tools return, quote briefly, and cite the page and source URL for every claim. If no source covers it, say so.`,
  },
];
