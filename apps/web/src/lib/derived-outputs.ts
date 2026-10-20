import { basisHash, buildBasis, nextVersion, planSupersede, type AvailableCitation, type OutputBasis } from '@rogue/core';
import { agentsEnabled } from './agent-jobs';
import { queueLibrarianJob } from './librarian-run';
import { ensureMigrated, getPool } from './services';
import type pg from 'pg';

/**
 * Derived outputs (docs/DERIVED_OUTPUTS.md, ADR 0008): the setup one-pager (/games/<slug>/setup) and the player aid
 * (/games/<slug>/aid) are built from published claims, so they must follow the game's sources. One game_outputs row per
 * game (migration 0045) holds the version stamp; the version goes up only when the basis hash changes. No history is kept.
 * The sheet and the aid are rendered per request (no server-side cache), so a refresh only needs to update the row.
 */

type Q = Pick<pg.Pool, 'query'>;

export interface OutputStamp { version: number; builtAt: string; sources: number; claims: number }
export interface OutputsStatus extends OutputStamp { stale: boolean; nowSources: number; nowClaims: number; pending: number }

const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

/** What the sheet and aid of a game are built from right now: its available sources (with content hash) and published claims. */
async function currentBasis(q: Q, slug: string): Promise<OutputBasis> {
  const sources = (await q.query(
    `SELECT DISTINCT s.id, s.content_hash FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 AND s.availability IN ('available','changed') AND s.retired_at IS NULL`, [slug])).rows;
  const claims = (await q.query(
    "SELECT c.id FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND c.status='published'", [slug])).rows;
  return buildBasis(sources.map((r) => ({ sourceId: Number(r.id), contentHash: r.content_hash ?? null })), claims.map((r) => Number(r.id)));
}

const toStamp = (r: { version: number; built_at: Date | string; basis: OutputBasis }): OutputStamp => ({
  version: Number(r.version), builtAt: new Date(r.built_at).toISOString(), sources: r.basis?.sources?.length ?? 0, claims: r.basis?.claims ?? 0,
});

/**
 * Recompute the basis and apply the version rule (nextVersion). A game without a row gets version 1 silently (backfill on
 * first render, no audit noise). Returns the stamp and whether the version went up.
 */
async function syncOutputs(slug: string): Promise<{ stamp: OutputStamp; bumped: boolean } | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  if (!(await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return null;
  const basis = await currentBasis(pool, slug);
  const hash = basisHash(basis);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = (await pool.query('SELECT version, built_at, basis_hash, basis FROM game_outputs WHERE game_slug=$1', [slug])).rows[0];
    const step = nextVersion(row ? { version: Number(row.version), basisHash: row.basis_hash } : null, hash);
    if (step.action === 'same') return { stamp: toStamp(row), bumped: false };
    // Guarded writes: a parallel render or refresh that got there first makes this one re-read instead of double-bumping.
    const w = step.action === 'create'
      ? await pool.query('INSERT INTO game_outputs(game_slug, version, built_at, basis_hash, basis) VALUES ($1,1,now(),$2,$3) ON CONFLICT (game_slug) DO NOTHING RETURNING version, built_at, basis', [slug, hash, basis])
      : await pool.query('UPDATE game_outputs SET version=$2, built_at=now(), basis_hash=$3, basis=$4 WHERE game_slug=$1 AND basis_hash=$5 RETURNING version, built_at, basis', [slug, step.version, hash, basis, row.basis_hash]);
    if (w.rowCount) return { stamp: toStamp(w.rows[0]), bumped: step.action === 'bump' };
  }
  return null;
}

/** Recompute, bump the version if the basis changed, audit (counts only). Never throws: callers are background hooks. */
export async function refreshDerivedOutputs(slug: string, reason: string): Promise<OutputStamp | null> {
  try {
    const r = await syncOutputs(slug);
    if (!r) return null;
    await audit('derived-outputs', 'outputs_refreshed', { slug, version: r.stamp.version, reason, changed: r.bumped, sources: r.stamp.sources, claims: r.stamp.claims });
    return r.stamp;
  } catch (e) {
    console.warn('[outputs] refresh failed:', (e as Error).message);
    return null;
  }
}

/** The stamp for a sheet/aid render. A changed basis bumps the version here too (audited); a first render backfills v1 silently. */
export async function outputStamp(slug: string): Promise<OutputStamp | null> {
  try {
    const r = await syncOutputs(slug);
    if (r?.bumped) await audit('derived-outputs', 'outputs_refreshed', { slug, version: r.stamp.version, reason: 'render', changed: true, sources: r.stamp.sources, claims: r.stamp.claims });
    return r?.stamp ?? null;
  } catch { return null; }
}

/**
 * New sources the sheet does not cover yet: available rulebooks with text that no published claim cites and the Librarian
 * has not finished (queued/running counts as not yet), plus admin-added links still in the pipeline (no source row yet).
 */
async function pendingSources(q: Q, slug: string): Promise<{ rulebooks: number[]; links: number }> {
  const rulebooks = (await q.query(
    `SELECT DISTINCT s.id FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 AND d.kind='rulebook' AND s.text_path IS NOT NULL AND s.availability='available' AND s.retired_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM citations ci JOIN documents d2 ON d2.id=ci.document_id JOIN claims c ON c.id=ci.claim_id WHERE d2.source_id=s.id AND c.status='published')
       AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.kind='librarian_draft' AND j.source_id=s.id AND j.status IN ('done','needs_human','failed'))
     ORDER BY s.id`, [slug])).rows.map((r) => Number(r.id));
  const links = Number((await q.query(
    `SELECT count(*)::int n FROM runtime_sources rs WHERE rs.game_slug=$1 AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.url=rs.url)
       AND COALESCE(rs.progress,'') !~* '(fail|error|denied|refused|no readable)'`, [slug])).rows[0].n);
  return { rulebooks, links };
}

/** Gate for the public sheet/aid: true while a new source is not drafted yet ("Being updated" notice; printing still works). */
export async function outputsBeingUpdated(slug: string): Promise<boolean> {
  const pool = getPool(); if (!pool) return false;
  try {
    const p = await pendingSources(pool, slug);
    return p.rulebooks.length > 0 || p.links > 0;
  } catch { return false; }
}

/** Read-only status for the admin game overview: stored stamp, counts now, STALE when the basis hash differs. */
export async function outputsStatus(slug: string): Promise<OutputsStatus | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const row = (await pool.query('SELECT version, built_at, basis_hash, basis FROM game_outputs WHERE game_slug=$1', [slug])).rows[0];
  if (!row) return null;
  const now = await currentBasis(pool, slug);
  const p = await pendingSources(pool, slug);
  return { ...toStamp(row), stale: basisHash(now) !== row.basis_hash, nowSources: now.sources.length, nowClaims: now.claims, pending: p.rulebooks.length + p.links };
}

/** The games a source belongs to (through its documents). */
export async function gamesOfSource(sourceId: number): Promise<string[]> {
  const pool = getPool(); if (!pool) return [];
  return (await pool.query('SELECT DISTINCT g.slug FROM documents d JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE d.source_id=$1', [sourceId])).rows.map((r) => String(r.slug));
}

/**
 * A source was retired or replaced: claims whose only available evidence it was become 'superseded' (not deleted, so
 * history and ratings stay); claims that also cite another available source stay published. Rule: planSupersede.
 */
export async function supersedeSoleSourceClaims(sourceId: number, actor: string): Promise<{ superseded: number; kept: number }> {
  const pool = getPool(); if (!pool) return { superseded: 0, kept: 0 };
  const cites: AvailableCitation[] = (await pool.query(
    `SELECT ci.claim_id, d.source_id, (s.availability IN ('available','changed') AND s.retired_at IS NULL) available
     FROM citations ci JOIN documents d ON d.id=ci.document_id JOIN sources s ON s.id=d.source_id
     WHERE ci.claim_id IN (SELECT ci2.claim_id FROM citations ci2 JOIN documents d2 ON d2.id=ci2.document_id WHERE d2.source_id=$1)`, [sourceId],
  )).rows.map((r) => ({ claimId: Number(r.claim_id), sourceId: Number(r.source_id), available: !!r.available }));
  const plan = planSupersede(cites, sourceId);
  const n = plan.supersede.length
    ? (await pool.query("UPDATE claims SET status='superseded' WHERE id = ANY($1::bigint[]) AND status IN ('published','needs_review','draft') RETURNING id", [plan.supersede])).rowCount ?? 0
    : 0;
  // Ids and counts only.
  if (n) await audit(actor, 'claims_superseded', { sourceId, superseded: n, kept: plan.keep.length, claimIds: plan.supersede });
  return { superseded: n, kept: plan.keep.length };
}

/**
 * Hook for every path that changes a game's sources (add, replace, re-ingest, capture, wiki import end, delete, recheck,
 * extract review). Makes sure the Librarian is queued for each new rulebook it has not run on (agents sidecar only; the
 * in-process fallback drafts the first rulebook when an admin starts it), then refreshes the stamp. Never throws.
 */
export async function sourcesChanged(slug: string, reason: string): Promise<OutputStamp | null> {
  try {
    const pool = getPool(); if (!pool) return null;
    await ensureMigrated();
    if (agentsEnabled()) {
      // queueLibrarianJob returns the open job when one is already queued or running, so repeated hooks do not stack jobs.
      for (const id of (await pendingSources(pool, slug)).rulebooks) await queueLibrarianJob(slug, id);
    }
  } catch (e) { console.warn('[outputs] librarian queue failed:', (e as Error).message); }
  return refreshDerivedOutputs(slug, reason);
}

/** sourcesChanged for every game of a source (recheck, extract review, delete only know the source id). */
export async function sourceChanged(sourceId: number, reason: string): Promise<void> {
  for (const slug of await gamesOfSource(sourceId).catch(() => [] as string[])) await sourcesChanged(slug, reason);
}
