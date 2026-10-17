/**
 * Signed-in MCP tools (ADR 0004). Listed only when OAuth is on (ROGUE_MCP_OAUTH=1); each needs a token with its scope,
 * which the HTTP layer checks before the handler runs (mcpChallenge). The writes go through McpUserApi, which the web
 * app implements with the website's own validation, limits and human gates: nothing here publishes or ingests anything.
 */
import type { McpTool, McpToolAnnotations } from './server.js';

export interface McpProfile { name: string; provider: string; language: string | null; scopes: string[] }
export type McpWriteResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface McpUserApi {
  profile(): Promise<McpProfile>;
  /** Same rule as the website's /rate: published facts only, one rating per user, a new rating replaces the old. */
  rateFact(factId: number, stars: number): Promise<McpWriteResult<{ fact: { id: number; game: string; topic: string; text: string } }>>;
  /** Same paths as /request-game: with a rulebook link (rights checks, then an admin) or a free-text description (an admin researches it). */
  requestGame(input: GameRequestArgs): Promise<McpWriteResult<{ id: number; status: string }>>;
}

export interface GameRequestArgs {
  name?: string | undefined; publisher?: string | undefined; year?: number | undefined; language?: string | undefined;
  rulebook_url?: string | undefined; found_on?: string | undefined; details?: string | undefined;
}

const SIGNED_IN = 'Needs a Rogue sign-in (OAuth); without one the server answers HTTP 401 and your client can start the sign-in.';
const WRITE: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const fail = (error: string) => { throw new Error(error); };

export function userTools(api: McpUserApi): McpTool[] {
  return [
    {
      name: 'get_my_profile',
      title: 'My Rogue profile',
      description: `The signed-in Rogue user: display name, sign-in provider, chosen language and the scopes this app was granted. ${SIGNED_IN}`,
      inputSchema: { type: 'object', additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopes: ['profile:read'],
      receipt: true,
      handler: async () => api.profile(),
    },
    {
      name: 'rate_fact',
      title: 'Rate a fact',
      description: `Rate one published fact from 1 (wrong or useless) to 5 (correct and helpful), as the signed-in user. Use the fact id from get_game_facts or search_facts. Rating again replaces the earlier rating. Only rate when the user asked you to. ${SIGNED_IN}`,
      inputSchema: {
        type: 'object',
        properties: {
          fact_id: { type: 'integer', minimum: 1, description: 'Fact id ("id" in get_game_facts results).' },
          stars: { type: 'integer', minimum: 1, maximum: 5, description: '1 to 5.' },
        },
        required: ['fact_id', 'stars'],
        additionalProperties: false,
      },
      annotations: { ...WRITE, idempotentHint: true },
      scopes: ['facts:rate'],
      receipt: true,
      handler: async (a) => {
        const id = Number(a['fact_id']); const stars = Number(a['stars']);
        if (!Number.isInteger(id) || id < 1) fail('fact_id must be a positive integer from get_game_facts.');
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail('stars must be an integer from 1 to 5.');
        const r = await api.rateFact(id, stars);
        if (!r.ok) fail(r.error);
        return { rated: true, stars, ...(r.ok ? { fact: r.fact } : {}) };
      },
    },
    {
      name: 'request_game',
      title: 'Request a game',
      description: `Ask Rogue to add a game, as the signed-in user. Give rulebook_url (the publisher's official rulebook PDF or page) with name and publisher; Rogue checks the publisher's terms and robots rules and an admin approves before anything is fetched. Without a link, give details (title, publisher, year, edition, language) and an admin researches it. Nothing is added automatically. Limited to a few requests per hour and 5 open requests per user. Only call this when the user asked for it. ${SIGNED_IN}`,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Game title.' },
          publisher: { type: 'string', description: 'Publisher or rights holder.' },
          year: { type: 'integer', description: 'Year of the edition (optional).' },
          language: { type: 'string', description: 'Rulebook language code, e.g. en or de (default en).' },
          rulebook_url: { type: 'string', description: "https link to the publisher's rulebook." },
          found_on: { type: 'string', description: 'https page that links the rulebook (optional).' },
          details: { type: 'string', description: 'Free-text description when there is no rulebook link.' },
        },
        additionalProperties: false,
      },
      annotations: { ...WRITE, idempotentHint: false, openWorldHint: true },
      scopes: ['games:request'],
      receipt: true,
      handler: async (a) => {
        const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
        const input: GameRequestArgs = {
          name: s('name'), publisher: s('publisher'), language: s('language'), rulebook_url: s('rulebook_url'), found_on: s('found_on'), details: s('details'),
          ...(typeof a['year'] === 'number' ? { year: a['year'] } : {}),
        };
        if (!input.rulebook_url && !input.details) fail('Give rulebook_url (with name and publisher), or details describing the game.');
        const r = await api.requestGame(input);
        if (!r.ok) fail(r.error);
        return r.ok ? { request_id: r.id, status: r.status, note: 'An admin reviews every request before the game is added.' } : {};
      },
    },
  ];
}
