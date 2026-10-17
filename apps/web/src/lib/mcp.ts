import { RateLimiter, type KbSource, type PublicKb } from '@rogue/core';
import { getClaims, listGames, searchClaims } from './kb';
import { askRules } from './chat';
import { searchRules } from './rules-index';
import { ensureMigrated, getPool } from './services';

/** Public /mcp budgets per client IP and minute. The model bucket covers ask_rules and search_rules (local AI). */
export const MCP_LIMITS = {
  general: Number(process.env['ROGUE_MCP_RATE_LIMIT'] ?? 30),
  model: Number(process.env['ROGUE_MCP_MODEL_RATE_LIMIT'] ?? 8),
};
export const mcpGeneral = new RateLimiter(MCP_LIMITS.general, 60_000);
export const mcpModel = new RateLimiter(MCP_LIMITS.model, 60_000);

/** Browser origins allowed besides our own host and localhost, comma separated (e.g. a hosted MCP Inspector). */
export const mcpAllowedOrigins = (process.env['ROGUE_MCP_ALLOWED_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();

/** The public origin we are served on (behind the Olares proxy the request URL is internal http). */
export function publicOrigin(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/** Documents per game: links and metadata only, never text or files. */
export async function listSources(slug?: string): Promise<KbSource[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query(
    `SELECT DISTINCT ON (g.slug, s.id) g.slug, s.title, s.url, s.publisher, d.kind, s.language, s.page_count, s.availability
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE ($1::text IS NULL OR g.slug=$1) ORDER BY g.slug, s.id`, [slug ?? null])).rows;
}

/** The read-only data the public MCP tools may see. Only published facts; nothing admin-only is wired in here. */
export function publicKb(baseUrl: string): PublicKb {
  return {
    baseUrl,
    listGames,
    getFacts: (slug, opts = {}) => getClaims(slug, opts),
    searchFacts: searchClaims,
    listSources,
    askRules: (game, question) => askRules(game, question),
    searchRules: (q, o) => searchRules(q, { ...o, rerank: true }),
  };
}
