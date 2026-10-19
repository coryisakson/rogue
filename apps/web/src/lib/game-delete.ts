import { gameDeleteBlock, type GameDeleteCounts, type GameDeleteError } from '@rogue/core';
import { ensureMigrated, getPool } from './services';
import type pg from 'pg';

/**
 * Admin delete of a game without sources (/admin/games/<slug>/sources, task admin-all-games). Only a game with no source,
 * no document and no published fact may go (gameDeleteBlock in core), so no claim ever loses its source. Removed with it:
 *   - the games row; editions and their (draft/rejected) claims cascade, with citations, ratings and disproofs;
 *   - rows keyed by the game's slug or id that have no foreign key: admin-added links (runtime_sources), game agent jobs,
 *     source suggestions, FAQ state/entries, unanswered questions, stored chat answers and answer ratings.
 * Game requests and takedown requests stay: they are the record of who asked for what.
 */

type Q = Pick<pg.PoolClient, 'query'>;

/** What the game still has (the delete refuses unless all are 0). */
async function counts(q: Q, gameId: number): Promise<GameDeleteCounts> {
  const r = (await q.query(
    `SELECT count(DISTINCT d.source_id)::int sources, count(d.id)::int documents,
       (SELECT count(*)::int FROM claims c JOIN editions e2 ON e2.id=c.edition_id WHERE e2.game_id=$1 AND c.status='published') published
     FROM editions e LEFT JOIN documents d ON d.edition_id=e.id WHERE e.game_id=$1`, [gameId])).rows[0];
  return { sources: Number(r?.sources ?? 0), documents: Number(r?.documents ?? 0), publishedClaims: Number(r?.published ?? 0) };
}

/** For the page: is "Delete game" allowed for this game right now? null when the game does not exist. */
export async function gameDeleteCheck(slug: string): Promise<{ counts: GameDeleteCounts; block: GameDeleteError | null } | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const g = (await pool.query('SELECT id FROM games WHERE slug=$1', [slug])).rows[0];
  if (!g) return null;
  const c = await counts(pool, Number(g.id));
  return { counts: c, block: gameDeleteBlock(c) };
}

export interface GameDeleteResult { slug: string; editions: number; claims: number; [table: string]: number | string }

/** Delete the game in one transaction, re-checking under a row lock. Returns an error code when refused. */
export async function deleteGame(slug: string, actor: string): Promise<{ ok: true; result: GameDeleteResult } | { ok: false; code: GameDeleteError }> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const g = (await c.query('SELECT id FROM games WHERE slug=$1 FOR UPDATE', [slug])).rows[0];
    if (!g) { await c.query('ROLLBACK'); return { ok: false, code: 'missing' }; }
    const gameId = Number(g.id);
    const block = gameDeleteBlock(await counts(c, gameId));
    if (block) { await c.query('ROLLBACK'); return { ok: false, code: block }; }
    const n = async (sql: string, args: unknown[]) => (await c.query(sql, args)).rowCount ?? 0;

    const claims = Number((await c.query('SELECT count(*)::int n FROM claims c JOIN editions e ON e.id=c.edition_id WHERE e.game_id=$1', [gameId])).rows[0].n);
    const editions = Number((await c.query('SELECT count(*)::int n FROM editions WHERE game_id=$1', [gameId])).rows[0].n);
    // No foreign key to games on these, so they would outlive the game (and come back if the slug is reused).
    const result: GameDeleteResult = {
      slug, editions, claims,
      runtimeSources: await n('DELETE FROM runtime_sources WHERE game_slug=$1', [slug]),
      agentJobs: await n('DELETE FROM agent_jobs WHERE game_slug=$1', [slug]),
      sourceSuggestions: await n('DELETE FROM source_suggestions WHERE game_id=$1', [gameId]),
      faqCanonical: await n('DELETE FROM faq_canonical WHERE game_slug=$1', [slug]),
      faqState: await n('DELETE FROM faq_state WHERE game_slug=$1', [slug]),
      unanswered: await n('DELETE FROM unanswered_questions WHERE game_slug=$1', [slug]),
      chatAnswers: await n('DELETE FROM chat_answers WHERE game_slug=$1', [slug]), // ratings cascade
      discordRatings: await n('DELETE FROM discord_answer_ratings WHERE game_slug=$1', [slug]),
    };
    // Editions cascade, and with them claims, citations, claim ratings and disproofs.
    await n('DELETE FROM games WHERE id=$1', [gameId]);
    // Slug and counts only.
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'game_deleted', result]);
    await c.query('COMMIT');
    return { ok: true, result };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}
