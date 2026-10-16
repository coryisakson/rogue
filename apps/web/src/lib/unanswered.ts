import { classifyNoAnswer, unansweredKey, type AskChannel } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

export interface UnansweredRow { game_slug: string; question_norm: string; question: string; channels: string[]; last_kind: string; ask_count: number; last_seen: Date }

/**
 * Note an Ask outcome; if it was not an answer, add it to the improvement queue (repeats per game are merged).
 * Fire and forget: never awaited by the caller, never throws, so the Ask reply is never slowed or broken.
 */
export function recordAsk(game: string, question: string, channel: AskChannel, outcome: { answer?: string | null; sources?: unknown[] | null; error?: unknown }): void {
  const kind = classifyNoAnswer(outcome);
  const key = kind ? unansweredKey(game, question) : null;
  if (!kind || !key) return;
  void saveUnanswered(key, question.trim().slice(0, 300), channel, kind)
    .catch((e) => console.warn('[ask] could not record unanswered question', (e as Error).message));
}

async function saveUnanswered(key: { game_slug: string; question_norm: string }, question: string, channel: AskChannel, kind: string): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  // A 'resolved' question that fails again goes back into the queue; a 'dismissed' one stays closed.
  await pool.query(
    `INSERT INTO unanswered_questions(game_slug, question_norm, question, channels, last_kind) VALUES ($1,$2,$3,ARRAY[$4::text],$5)
     ON CONFLICT (game_slug, question_norm) DO UPDATE SET
       question=EXCLUDED.question, last_kind=EXCLUDED.last_kind, ask_count=unanswered_questions.ask_count + 1, last_seen=now(),
       channels=CASE WHEN $4::text = ANY(unanswered_questions.channels) THEN unanswered_questions.channels ELSE unanswered_questions.channels || $4::text END,
       status=CASE WHEN unanswered_questions.status='resolved' THEN NULL ELSE unanswered_questions.status END`,
    [key.game_slug, key.question_norm, question, channel, kind]);
}

/** Admin: unanswered questions nobody has resolved or dismissed yet. */
export async function openUnanswered(): Promise<UnansweredRow[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query(
    'SELECT game_slug, question_norm, question, channels, last_kind, ask_count, last_seen FROM unanswered_questions WHERE status IS NULL ORDER BY ask_count DESC, last_seen DESC LIMIT 200')).rows;
}

export async function decideUnanswered(game: string, qnorm: string, action: 'resolve' | 'dismiss', adminId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  const status = action === 'resolve' ? 'resolved' : 'dismissed';
  await pool.query('UPDATE unanswered_questions SET status=$3, decided_by=$4, decided_at=now() WHERE game_slug=$1 AND question_norm=$2', [game, qnorm, status, adminId]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`user:${adminId}`, `unanswered_${action}`, { game, qnorm }]);
}
