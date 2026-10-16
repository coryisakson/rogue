import { isFaqVisible, needsFaqReview, type FaqCandidate } from '@rogue/core';
import { ensureMigrated, getPool } from './services';

export interface FaqRow { game_slug: string; question_norm: string; question: string; answer: string; sources: { page: number; section?: string | null; title: string; url: string }[] | null; total: number; up: number; status: string | null; canonical?: boolean }

/** One row per (game, question): each user counts once (their latest vote), text from the newest stored answer. Also read by qa-facts. */
export async function tally(game: string | null): Promise<FaqRow[]> {
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

/**
 * Public FAQ for one game: the FAQ Curator's canonical entries first, then well-rated questions none of them merged.
 * Without canonical entries (agents off, or never run) this is the plain rating tally.
 */
export async function publicFaq(game: string): Promise<FaqRow[]> {
  const rows = await tally(game);
  const raw = rows.filter((x) => isFaqVisible(x.up, x.total, x.status));
  const canon = await canonicalRows(game, rows);
  if (canon.length === 0) return raw;
  const merged = new Set(canon.flatMap((c) => c.source_qnorms));
  return [...canon.map((c) => c.row), ...raw.filter((x) => !merged.has(x.question_norm))];
}

/** Questions the FAQ Curator may merge: the ones the public FAQ would show (never admin-hidden ones). */
export async function faqCandidates(game: string): Promise<FaqCandidate[]> {
  return (await tally(game)).filter((x) => isFaqVisible(x.up, x.total, x.status))
    .map((x) => ({ question_norm: x.question_norm, question: x.question, answer: x.answer, sources: x.sources, up: x.up, total: x.total, status: x.status }));
}

/**
 * Published canonical entries of finished curation jobs. An entry is dropped if an admin has since hidden any question it
 * merged; its vote counts are the sums of the merged questions.
 */
async function canonicalRows(game: string, rows: FaqRow[]): Promise<{ row: FaqRow; source_qnorms: string[] }[]> {
  const pool = getPool(); if (!pool) return [];
  const r = await pool.query(
    `SELECT c.id, c.question, c.answer, c.sources, c.source_qnorms FROM faq_canonical c LEFT JOIN agent_jobs j ON j.id = c.job_id
     WHERE c.game_slug=$1 AND c.status='published' AND (c.job_id IS NULL OR j.status IN ('done','needs_human')) ORDER BY c.id`, [game]);
  const byNorm = new Map(rows.map((x) => [x.question_norm, x]));
  const out: { row: FaqRow; source_qnorms: string[] }[] = [];
  for (const c of r.rows) {
    const parts = (c.source_qnorms as string[]).map((q) => byNorm.get(q));
    if (parts.some((x) => x?.status === 'hidden')) continue;
    const up = parts.reduce((n, x) => n + (x?.up ?? 0), 0);
    const total = parts.reduce((n, x) => n + (x?.total ?? 0), 0);
    out.push({ source_qnorms: c.source_qnorms, row: { game_slug: game, question_norm: `canonical:${c.id}`, question: c.question, answer: c.answer, sources: c.sources, up, total, status: null, canonical: true } });
  }
  return out;
}

/** Store one gated canonical entry for a running faq_curate job (the gate is judgeCanonical in packages/core). */
export async function saveCanonical(jobId: number, game: string, e: { question: string; answer: string; source_qnorms: string[]; citations: unknown[] }): Promise<number> {
  const r = await getPool()!.query(
    'INSERT INTO faq_canonical(game_slug, job_id, question, answer, sources, source_qnorms) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [game, jobId, e.question, e.answer, JSON.stringify(e.citations), e.source_qnorms]);
  return Number(r.rows[0].id);
}

/** Question keys already merged by this job, so one player question lands in one entry only. */
export async function mergedByJob(jobId: number): Promise<Set<string>> {
  const r = await getPool()!.query('SELECT unnest(source_qnorms) AS q FROM faq_canonical WHERE job_id=$1', [jobId]);
  return new Set(r.rows.map((x) => String(x.q)));
}

/** After a curation job ends: if it produced entries, they replace the game's older ones; otherwise the old set stays. */
export async function replaceCanonicalFaq(jobId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  const j = (await pool.query('SELECT game_slug, status FROM agent_jobs WHERE id=$1', [jobId])).rows[0];
  if (!j?.game_slug || !['done', 'needs_human'].includes(j.status)) return;
  const n = Number((await pool.query('SELECT count(*)::int AS n FROM faq_canonical WHERE job_id=$1', [jobId])).rows[0].n);
  if (n === 0) return;
  await pool.query('DELETE FROM faq_canonical WHERE game_slug=$1 AND (job_id IS NULL OR job_id <> $2)', [j.game_slug, jobId]);
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
