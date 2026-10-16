import { reviewQueue } from './claim-review';
import { lowRatedFaq } from './faq';
import { openUnanswered } from './unanswered';
import { getPool, ensureMigrated } from './services';
import { readApprovals, readReviewLog } from './admin';
import { improvementQueue } from '@rogue/core';

/** How many items wait for a human on each admin tab. A missing key means no badge. Failures count as zero so a broken query never breaks the page. */
export async function adminBadges(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const safe = async (key: string, f: () => Promise<number> | number) => { try { const n = await f(); if (n > 0) out[key] = n; } catch { /* leave the badge off */ } };
  const count = async (sql: string) => { const pool = getPool(); if (!pool) return 0; await ensureMigrated(); return Number((await pool.query(sql)).rows[0].n); };
  await Promise.all([
    safe('/admin/claims', async () => (await reviewQueue(null, 1, 0)).total),
    safe('/admin/faq', async () => improvementQueue([
      ...(await lowRatedFaq()).map((f) => ({ ...f, reason: 'low_rating' as const, count: f.total })),
      ...(await openUnanswered()).map((u) => ({ ...u, reason: 'no_answer' as const, count: u.ask_count })),
    ]).length),
    safe('/admin/quality', () => count(`SELECT (SELECT count(*) FROM text_variants WHERE status='needs_human') + (SELECT count(*) FROM agent_jobs WHERE status IN ('needs_human','failed') AND finished_at > now() - interval '7 days') n`)),
    safe('/admin/requests', () => count(`SELECT count(*) n FROM game_requests WHERE status IN ('submitted','checked')`)),
    safe('/admin/approvals', () => readApprovals().filter((a) => a.status === 'OPEN').length),
    safe('/admin/review-log', () => readReviewLog().filter((r) => r.status === 'open').length),
  ]);
  return out;
}
