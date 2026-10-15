import { FetchDenied, FetchHttpError, RightsGatedFetcher } from '@rogue/core';
import { ensureMigrated, getPool, storage } from './services';
import { ALLOWED_HOSTS } from './source-seeds';

const fetcher = new RightsGatedFetcher({ allowedHosts: ALLOWED_HOSTS, minDelayMs: 2000 });

export interface RecheckResult { sourceId: number; url: string; outcome: 'unchanged' | 'changed' | 'unavailable' | 'transient_error' | 'denied'; detail: string }

/**
 * Re-check one source. 404/410 -> mark "no longer available" (never delete; claims stay, flagged on the page).
 * Hash changed -> mark changed and move citing claims to needs_review. Transient errors change nothing.
 */
export async function recheckSource(sourceId: number): Promise<RecheckResult> {
  const pool = getPool()!;
  await ensureMigrated();
  const s = (await pool.query('SELECT id, url, content_hash FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!s) return { sourceId, url: '', outcome: 'transient_error', detail: 'unknown source' };
  const done = async (outcome: RecheckResult['outcome'], detail: string, audit = true): Promise<RecheckResult> => {
    if (audit) await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['curator', `recheck_${outcome}`, { sourceId, url: s.url, detail }]);
    return { sourceId, url: s.url, outcome, detail };
  };
  if ((await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [s.url])).rowCount) return done('denied', 'tombstoned (takedown); never refetched', false);
  try {
    const doc = await fetcher.fetch(s.url);
    if (doc.sha256 === s.content_hash) {
      await pool.query("UPDATE sources SET last_checked_at=now(), availability='available', unavailable_since=NULL WHERE id=$1", [sourceId]);
      return done('unchanged', 'hash identical', false);
    }
    await pool.query("UPDATE sources SET last_checked_at=now(), availability='changed' WHERE id=$1", [sourceId]);
    const n = await pool.query(
      `UPDATE claims SET status='needs_review' WHERE status='published' AND id IN (SELECT claim_id FROM citations c JOIN documents d ON d.id=c.document_id WHERE d.source_id=$1)`,
      [sourceId],
    );
    return done('changed', `new hash ${doc.sha256.slice(0, 12)}; ${n.rowCount} claims moved to needs_review`);
  } catch (e) {
    if (e instanceof FetchHttpError && e.gone) {
      await pool.query("UPDATE sources SET last_checked_at=now(), availability='unavailable', unavailable_since=COALESCE(unavailable_since, now()) WHERE id=$1", [sourceId]);
      return done('unavailable', `HTTP ${e.status}: source no longer available`);
    }
    if (e instanceof FetchDenied) return done('denied', e.message);
    return done('transient_error', (e as Error).message, false);
  }
}

export async function recheckAll(): Promise<RecheckResult[]> {
  const pool = getPool()!;
  await ensureMigrated();
  const ids = (await pool.query("SELECT id FROM sources WHERE private_path IS NOT NULL OR availability <> 'available' ORDER BY last_checked_at NULLS FIRST LIMIT 20")).rows;
  const out: RecheckResult[] = [];
  for (const r of ids) out.push(await recheckSource(r.id));
  return out;
}

export interface TakedownInput { requester: string; url?: string; game?: string; reason?: string; dryRun?: boolean }

/**
 * One-command takedown. Cory (or a delegate) receives the request by hand, then runs this. It:
 * tombstones the URL(s), deletes the private copy + extracted text, blanks stored quotes, rejects claims that depend only on
 * those sources, and logs everything. dryRun reports what would happen without changing anything.
 */
export async function takedown(input: TakedownInput) {
  const pool = getPool()!;
  await ensureMigrated();
  if (!input.url && !input.game) throw new Error('give url or game');
  const where = input.url ? 's.url = $1' : 's.id IN (SELECT d.source_id FROM documents d JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1)';
  const sources = (await pool.query(`SELECT s.id, s.url, s.private_path, s.text_path FROM sources s WHERE ${where}`, [input.url ?? input.game])).rows;
  const claims = (await pool.query(
    `SELECT DISTINCT c.claim_id FROM citations c JOIN documents d ON d.id=c.document_id WHERE d.source_id = ANY($1::bigint[])`,
    [sources.map((s) => s.id)],
  )).rows.map((r) => r.claim_id);
  const summary = { sources: sources.length, urls: sources.map((s) => s.url), claims: claims.length, filesDeleted: sources.filter((s) => s.private_path).length, dryRun: !!input.dryRun };
  if (input.dryRun) return summary;

  const dup = await pool.query("SELECT id FROM takedown_requests WHERE requester=$1 AND COALESCE(scope_url,'')=$2 AND COALESCE(scope_game,'')=$3 AND created_at > now() - interval '1 minute'", [input.requester, input.url ?? '', input.game ?? '']);
  if (dup.rowCount) return { requestId: dup.rows[0].id, ...summary, note: 'duplicate request within 1 minute; ignored' };
  const req = await pool.query('INSERT INTO takedown_requests(requester, scope_url, scope_game, reason) VALUES ($1,$2,$3,$4) RETURNING id', [input.requester, input.url ?? null, input.game ?? null, input.reason ?? null]);
  for (const s of sources) {
    if (!(await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [s.url])).rowCount)
    await pool.query('INSERT INTO tombstones(url, reason) VALUES ($1,$2)', [s.url, `takedown #${req.rows[0].id}: ${input.reason ?? 'requested by rights holder'}`]);
    for (const p of [s.private_path, s.text_path]) if (p) await storage.delete(p).catch(() => {});
    await pool.query("UPDATE sources SET private_path=NULL, text_path=NULL, content_hash=NULL, availability='unavailable', unavailable_since=now() WHERE id=$1", [s.id]);
  }
  await pool.query('UPDATE citations SET quote=NULL WHERE document_id IN (SELECT id FROM documents WHERE source_id = ANY($1::bigint[]))', [sources.map((s) => s.id)]);
  await pool.query("UPDATE claims SET status='rejected', rejected_reason='takedown', rejected_by='takedown' WHERE id = ANY($1::bigint[]) AND status <> 'rejected'", [claims]);
  await pool.query("UPDATE takedown_requests SET status='purged', purged_at=now(), summary=$2 WHERE id=$1", [req.rows[0].id, summary]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['admin', 'takedown', { requestId: req.rows[0].id, ...summary }]);
  return { requestId: req.rows[0].id, ...summary };
}
