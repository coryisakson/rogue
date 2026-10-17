/**
 * The signed-in MCP tools' writes (ADR 0004), done exactly as the website does them: same parsers, same submit
 * functions, same per-user limits, same admin gates. Nothing here publishes or ingests; an admin still decides.
 */
import { parseDetails, parseGameRequest, RateLimiter, type GameRequestArgs, type McpUserApi } from '@rogue/core';
import { submitRequest } from './add-game';
import { submitDetails } from './intake';
import type { TokenUser } from './oauth';
import { ensureMigrated, getPool } from './services';

// Same budgets as the website. The game-request limiter is shared with /request-game (same globalThis key), so MCP and
// the web page draw from one 5-per-hour budget per user. /rate keeps its own 30/min per user; this mirrors it.
const g = globalThis as Record<string, unknown>;
const requestLimiter = (g['__rogueReqLimit'] ??= new RateLimiter(5, 3_600_000)) as RateLimiter;
const rateLimiter = (g['__rogueMcpRateLimit'] ??= new RateLimiter(30, 60_000)) as RateLimiter;

export function userApi(u: TokenUser): McpUserApi {
  return {
    profile: async () => ({ name: u.name, provider: u.provider, language: u.language, scopes: [...u.scopes] }),

    async rateFact(factId, stars) {
      if (!rateLimiter.allow(String(u.userId))) return { ok: false, error: 'Too many ratings; wait a minute.' };
      const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
      await ensureMigrated();
      // Same statement as pages/rate.ts: only published claims, one rating per user, re-rating replaces.
      const ok = await pool.query(
        `INSERT INTO claim_ratings(claim_id, user_id, stars) SELECT c.id, $2::bigint, $3 FROM claims c WHERE c.id=$1 AND c.status='published'
         ON CONFLICT (claim_id, user_id) DO UPDATE SET stars=EXCLUDED.stars, created_at=now()`, [factId, u.userId, stars]);
      if (!ok.rowCount) return { ok: false, error: `Fact ${factId} was not found or is not published. Use an id from get_game_facts.` };
      const f = (await pool.query(
        'SELECT c.id, g.slug, c.topic, c.body FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id WHERE c.id=$1', [factId])).rows[0];
      return { ok: true, fact: { id: factId, game: f?.slug ?? '', topic: f?.topic ?? '', text: f?.body ?? '' } };
    },

    async requestGame(a: GameRequestArgs) {
      if (!requestLimiter.allow(String(u.userId))) return { ok: false, error: 'Too many requests this hour. Please try again later.' };
      if (a.rulebook_url) {
        // Link mode: rights checks run in the background, then an admin approves (like the website's link form).
        const p = parseGameRequest({ name: a.name, publisher: a.publisher, year: a.year ?? '', language: a.language, rulebookUrl: a.rulebook_url, foundOn: a.found_on });
        if (!p.ok) return { ok: false, error: p.error };
        const r = await submitRequest(u.userId, p.value);
        return 'error' in r ? { ok: false, error: r.error } : { ok: true, id: r.id, status: 'submitted: rights checks, then an admin decides' };
      }
      // Free text: an admin researches the game by hand.
      const text = [a.name, a.publisher, a.year, a.language, a.details].filter((x) => x !== undefined && x !== '').join('\n');
      const d = parseDetails(text);
      if (!d.ok) return { ok: false, error: d.error };
      const r = await submitDetails(u.userId, d.text);
      return 'error' in r ? { ok: false, error: r.error } : { ok: true, id: r.id, status: 'waiting for an admin to research the game' };
    },
  };
}
