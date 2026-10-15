import { isFaqVisible, needsFaqReview } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

export interface FaqRow { game_slug: string; question_norm: string; question: string; answer: string; sources: { page: number; title: string; url: string }[] | null; total: number; up: number; status: string | null }

/** One row per (game, question): each user counts once (their latest vote), text from the newest stored answer. */
async function tally(game: string | null): Promise<FaqRow[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const r = await pool.query(
    `WITH latest_vote AS (
       SELECT DISTINCT ON (a.game_slug, a.question_norm, r.user_id) a.game_slug, a.question_norm, r.helpful
       FROM chat_answers a JOIN chat_answer_ratings r ON r.answer_id = a.id
       WHERE a.question_norm IS NOT NULL AND ($1::text IS NULL OR a.game_slug = $1)
       ORDER BY a.game_slug, a.question_norm, r.user_id, r.created_at DESC),
     t AS (SELECT game_slug, question_norm, count(*)::int AS total, (count(*) FILTER (WHERE helpful))::int AS up FROM latest_vote GROUP BY 1, 2),
     s AS (SELECT DISTINCT ON (game_slug, question_norm) game_slug, question_norm, question, answer, sources
           FROM chat_answers WHERE answer IS NOT NULL ORDER BY game_slug, question_norm, id DESC)
     SELECT t.game_slug, t.question_norm, s.question, s.answer, s.sources, t.total, t.up, f.status
     FROM t JOIN s USING (game_slug, question_norm) LEFT JOIN faq_state f USING (game_slug, question_norm)
     ORDER BY t.total DESC, t.up DESC`, [game]);
  return r.rows;
}

/** Public FAQ for one game: well-rated questions only. */
export async function publicFaq(game: string): Promise<FaqRow[]> {
  return (await tally(game)).filter((x) => isFaqVisible(x.up, x.total, x.status));
}

/** Admin: low-rated questions nobody has decided on yet. */
export async function lowRatedFaq(): Promise<FaqRow[]> {
  return (await tally(null)).filter((x) => needsFaqReview(x.up, x.total, x.status));
}

export async function decideFaq(game: string, qnorm: string, action: 'hide' | 'keep', reason: string, adminId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  const status = action === 'hide' ? 'hidden' : 'kept';
  await pool.query(
    `INSERT INTO faq_state(game_slug, question_norm, status, reason, decided_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (game_slug, question_norm) DO UPDATE SET status=EXCLUDED.status, reason=EXCLUDED.reason, decided_by=EXCLUDED.decided_by, decided_at=now()`,
    [game, qnorm, status, reason || null, adminId]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`user:${adminId}`, `faq_${action}`, { game, qnorm, reason }]);
}
