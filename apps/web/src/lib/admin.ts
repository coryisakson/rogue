import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionUser } from './auth';
import { services } from './services';

/** Admins are user ids listed in env ROGUE_ADMIN_USER_IDS ("1,2") or /app/data/admins.json ([1,2]). Nobody is admin by default. */
export function adminIds(): number[] {
  const fromEnv = (process.env['ROGUE_ADMIN_USER_IDS'] ?? '').split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
  let fromFile: number[] = [];
  try { fromFile = (JSON.parse(readFileSync(join(services.dataDir, 'admins.json'), 'utf8')) as unknown[]).map(Number).filter(Number.isInteger); } catch { /* optional */ }
  return [...fromEnv, ...fromFile];
}
export const isAdmin = (u: SessionUser | null | undefined): boolean => !!u && adminIds().includes(u.id);

export interface ReviewItem { id: string; area: string; question: string; risk: string; status: string }
/** docs/REVIEW_LOG.md is the source of truth (one `Rn | area | question | risk | status` per line); the image carries a copy. */
export function readReviewLog(): ReviewItem[] {
  const path = process.env['ROGUE_REVIEW_LOG'] ?? join(process.cwd(), 'docs', 'REVIEW_LOG.md');
  let text = ''; try { text = readFileSync(path, 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => /^R\d+ \|/.test(l)).map((l) => {
    const [id = '', area = '', question = '', risk = '', status = ''] = l.split(' | ').map((s) => s.trim());
    return { id, area, question, risk, status };
  });
}
