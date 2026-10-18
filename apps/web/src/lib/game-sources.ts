import {
  CAPTURE_METHOD, RateLimiter, captureLabel, libraryMatch, runtimeEditionLabel, runtimeSeed, slugify, sourceProbeGate, termsGate,
  type GameMatch, type SourceInput,
} from '@rogue/core';
import { probeRulebook, type RightsReport } from './add-game';
import { allSeeds, syncApprovedHosts } from './dynamic-sources';
import { resumeQueue } from './intake';
import { ingestSeed } from './ingest';
import { startLibrarian } from './librarian-run';
import { indexSource } from './rules-index';
import { searchGameMatches } from './search';
import { ensureMigrated, getPool } from './services';
import { ALLOWED_HOSTS } from './source-seeds';

/**
 * Game sources (admin, /admin/sources): add a rules link to a game that is already in Rogue, replace a wrong source, re-ingest.
 * Same gates as a new game, in the same order: form validation, terms confirmation for a host no human approved yet,
 * Rights Officer probe (headers only). Nothing is fetched before both pass. Then: allowlist the host, remember the seed in
 * runtime_sources (allSeeds() reads it), ingest, index, and queue the Librarian.
 */

const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

export interface GameRow { slug: string; name: string; bggId: number | null }
export interface SourceRow {
  id: number; url: string; title: string | null; language: string | null; kind: string; edition: string; availability: string;
  fetchedAt: string | null; pageCount: number | null; indexedPages: number; runtime: boolean;
  /** "Manual capture by <admin> on <date>" when an admin captured the text in their browser (source-capture.ts), else null. */
  capture: string | null;
}

export async function listGames(): Promise<GameRow[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query('SELECT slug, name, bgg_id FROM games ORDER BY name')).rows.map((r) => ({ slug: r.slug, name: r.name, bggId: r.bgg_id == null ? null : Number(r.bgg_id) }));
}

/** Every source of a game with what was fetched and indexed. Unavailable sources stay listed (their citations stay). */
export async function gameSources(slug: string): Promise<SourceRow[]> {
  const pool = getPool(); if (!pool) return [];
  const rows = (await pool.query(
    `SELECT DISTINCT ON (s.id) s.id, s.url, s.title, s.language, d.kind, e.label edition, s.availability, to_char(s.fetched_at, 'YYYY-MM-DD HH24:MI') fetched_at, s.page_count,
       (SELECT count(DISTINCT ch.page)::int FROM chunks ch WHERE ch.source_id=s.id) indexed_pages,
       EXISTS (SELECT 1 FROM runtime_sources rs WHERE rs.url=s.url) runtime,
       s.capture_method, s.captured_at, (SELECT u.display_name FROM users u WHERE u.id=s.captured_by) captured_by_name
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 ORDER BY s.id, d.id`, [slug])).rows;
  return rows.map((r) => ({
    id: Number(r.id), url: r.url, title: r.title, language: r.language, kind: r.kind, edition: r.edition, availability: r.availability,
    fetchedAt: r.fetched_at, pageCount: r.page_count == null ? null : Number(r.page_count), indexedPages: Number(r.indexed_pages), runtime: r.runtime,
    capture: captureLabel(r.capture_method, r.captured_by_name, r.captured_at),
  }));
}

/** Published facts of a game (what users see). */
export async function factsCount(slug: string): Promise<number> {
  const pool = getPool(); if (!pool) return 0;
  return (await pool.query("SELECT count(*)::int n FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND c.status='published'", [slug])).rows[0].n;
}

/** Admin-added links of a game that have not produced a source row yet, or are still running (pipeline progress). */
export async function pendingRuntimeSources(slug: string): Promise<{ id: number; url: string; title: string; progress: string | null }[]> {
  const pool = getPool(); if (!pool) return [];
  return (await pool.query('SELECT id, url, title, progress FROM runtime_sources WHERE game_slug=$1 ORDER BY id DESC LIMIT 20', [slug])).rows.map((r) => ({ id: Number(r.id), url: r.url, title: r.title, progress: r.progress }));
}

export type AddResult = { ok: true; id: number; report: RightsReport } | { ok: false; error: string; report?: RightsReport };

/**
 * Add a rules link to an existing game (optionally replacing one of its sources). Runs the gates, then starts the pipeline
 * in the background. `replacesSourceId` is marked unavailable only after the new link passed every gate.
 */
export async function addGameSource(slug: string, v: SourceInput, adminId: number, termsChecked: boolean, replacesSourceId: number | null = null): Promise<AddResult> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
  await ensureMigrated();
  if (!(await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return { ok: false, error: 'Unknown game.' };
  if ((await pool.query('SELECT 1 FROM sources WHERE url=$1 UNION SELECT 1 FROM runtime_sources WHERE url=$1', [v.url])).rowCount) return { ok: false, error: 'That link is already a source; use "Re-ingest now" instead.' };
  if ((await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [v.url])).rowCount) return { ok: false, error: 'That link was taken down (tombstoned); it cannot be added.' };
  if (replacesSourceId !== null && !(await sourceOfGame(slug, replacesSourceId))) return { ok: false, error: 'The source to replace does not belong to this game.' };

  // Gate 1: terms. A host already approved by a human (built-in allowlist or approved_hosts) skips the checkbox.
  await syncApprovedHosts();
  const host = new URL(v.url).host;
  const termsError = termsGate(host, ALLOWED_HOSTS, termsChecked);
  if (termsError) return { ok: false, error: termsError };

  // Gate 2: Rights Officer probe (robots, TDM, opt-out, reachability, content-type), headers only.
  const report = await probeRulebook(v.url);
  await audit('rights-officer', 'game_source_checked', { slug, url: v.url, verdict: report.verdict, policyVersion: report.policyVersion });
  const probeError = sourceProbeGate(report.verdict, report.host, v.url);
  if (probeError) return { ok: false, error: probeError, report };

  const label = runtimeEditionLabel(v.publisher, v.kind, v.language, new Date().toISOString().slice(0, 10));
  const c = await pool.connect();
  let id: number;
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO approved_hosts(host, approved_by) VALUES ($1,$2) ON CONFLICT (host) DO NOTHING', [report.host, adminId]);
    id = Number((await c.query(
      `INSERT INTO runtime_sources(game_slug, url, title, publisher, language, kind, edition_label, found_on, replaces_source_id, report, progress, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11) RETURNING id`,
      [slug, v.url, v.title, v.publisher, v.language, v.kind, label, v.foundOn, replacesSourceId, report, adminId])).rows[0].id);
    if (replacesSourceId !== null) {
      // Keep the row, its documents and citations: published facts stay attributable (lifecycle rule, migration 0005).
      await c.query("UPDATE sources SET availability='unavailable', retired_at=now(), unavailable_since=COALESCE(unavailable_since, now()) WHERE id=$1", [replacesSourceId]);
    }
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`admin:${adminId}`, replacesSourceId === null ? 'game_source_added' : 'game_source_replaced',
      { slug, runtimeSourceId: id, url: v.url, kind: v.kind, language: v.language, host: report.host, verdict: report.verdict, termsChecked, replacesSourceId }]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    if ((e as { code?: string }).code === '23505') return { ok: false, error: 'That link was just added by someone else.', report };
    throw e;
  } finally { c.release(); }
  void runSourcePipeline(id);
  return { ok: true, id, report };
}

async function sourceOfGame(slug: string, sourceId: number): Promise<boolean> {
  const r = await getPool()!.query('SELECT 1 FROM documents d JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND d.source_id=$2', [slug, sourceId]);
  return !!r.rowCount;
}

const setProgress = (id: number, text: string) => getPool()?.query('UPDATE runtime_sources SET progress=$2 WHERE id=$1', [id, text.slice(0, 300)]).catch(() => {});

/** Fetch through the rights-gated ingest, index for search, then queue the Librarian for this source (rulebooks only). */
async function runSourcePipeline(id: number): Promise<void> {
  try {
    const row = (await getPool()!.query('SELECT game_slug, url, title, publisher, language, kind, edition_label, found_on FROM runtime_sources WHERE id=$1', [id])).rows[0];
    if (!row) return;
    const seed = runtimeSeed(row);
    await setProgress(id, 'fetching');
    const res = await ingestSeed(seed, true);
    if (!res.ok || !res.sourceId) { await setProgress(id, `ingest failed: ${res.detail}`); return; }
    await setProgress(id, `indexing ${res.pages ?? '?'} pages`);
    const idx = await indexSource(res.sourceId);
    if (seed.kind !== 'rulebook') { await setProgress(id, `done: ${idx.chunks} chunks indexed (the Librarian drafts from rulebooks only)`); return; }
    const lib = await startLibrarian(seed.gameSlug, res.sourceId);
    await setProgress(id, 'error' in lib ? `indexed ${idx.chunks} chunks; Librarian not started: ${lib.error}`
      : lib.mode === 'agent' ? `indexed ${idx.chunks} chunks; Librarian job #${lib.jobId} queued` : `indexed ${idx.chunks} chunks; Librarian running in-process`);
    await audit('game-sources', 'game_source_ingested', { runtimeSourceId: id, sourceId: res.sourceId, chunks: idx.chunks, librarian: lib });
  } catch (e) {
    await setProgress(id, `error: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

/** Last "Re-ingest now" outcome per source id, for the page (in memory; a restart forgets it, the audit log does not). */
const reingestProgress = new Map<number, string>();
export const reingestStatus = (sourceId: number): string | null => reingestProgress.get(sourceId) ?? null;

/** Re-fetch one source now (force, through the same rights gate and tombstone check), then re-index it. Background. */
export async function reingestSource(slug: string, sourceId: number, adminId: number): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
  if (!(await sourceOfGame(slug, sourceId))) return { ok: false, error: 'That source does not belong to this game.' };
  const src = (await pool.query('SELECT url, capture_method FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (src?.capture_method === CAPTURE_METHOD) return { ok: false, error: 'This source is a manual capture: Rogue cannot fetch it. Capture it again in your browser to replace its text.' };
  const url = src?.url as string | undefined;
  const seed = (await allSeeds()).find((s) => s.url === url);
  if (!seed) return { ok: false, error: 'No seed for this source (it is not in the static seeds, an approved request or runtime_sources).' };
  await audit(`admin:${adminId}`, 'game_source_reingest', { slug, sourceId, url });
  reingestProgress.set(sourceId, 'fetching');
  void (async () => {
    try {
      const res = await ingestSeed(seed, true);
      if (!res.ok || !res.sourceId) { reingestProgress.set(sourceId, `ingest failed: ${res.detail}`); return; }
      reingestProgress.set(sourceId, `indexing ${res.pages ?? '?'} pages`);
      const idx = await indexSource(res.sourceId);
      reingestProgress.set(sourceId, `done: ${idx.chunks} chunks indexed`);
    } catch (e) { reingestProgress.set(sourceId, `error: ${e instanceof Error ? e.message : 'unknown'}`); }
  })();
  return { ok: true };
}

// ---- admin title search: the same pick list and the same per-user hourly limit as /request-game ----
const g = globalThis as Record<string, unknown>;
const searchLimiter = (g['__rogueSearchLimit'] ??= new RateLimiter(20, 3_600_000)) as RateLimiter;

export interface AdminMatch extends GameMatch { inRogue: string | null }

export async function adminGameSearch(userId: number, q: string): Promise<{ matches: AdminMatch[] } | { error: string }> {
  if (!searchLimiter.allow(String(userId))) return { error: 'Too many searches this hour.' };
  let found: GameMatch[];
  try { found = await searchGameMatches(q); } catch { return { error: 'Search is not answering right now.' }; }
  const games = await listGames();
  return { matches: found.map((m) => ({ ...m, inRogue: libraryMatch(m, games) })) };
}

/**
 * Admin starts a request from a search result. The admin's approval of the game is implicit (status 'queued', like the
 * BGG top-10 button), so the Scout, Rights Officer, Terms Agent and the terms gate still run before anything is fetched.
 */
export async function adminRequestGame(adminId: number, m: GameMatch): Promise<{ id: number } | { error: string }> {
  const pool = getPool(); if (!pool) return { error: 'The database is not available.' };
  await ensureMigrated();
  if (libraryMatch(m, await listGames())) return { error: 'That game is already in Rogue.' };
  const r = await pool.query("INSERT INTO game_requests(user_id, name, slug, year, mode, bgg_id, status, stage, decided_by) VALUES ($1,$2,$3,$4,'pick',$5,'queued','in the queue for the Scout',$1) ON CONFLICT DO NOTHING RETURNING id",
    [adminId, m.title, slugify(m.title), m.year, m.bggId]);
  if (!r.rowCount) return { error: 'That game is already requested.' };
  const id = Number(r.rows[0].id);
  await audit(`admin:${adminId}`, 'game_request_game_approved', { id, via: 'admin-search', bggId: m.bggId });
  void resumeQueue(); // picks up every 'queued' request, this one included
  return { id };
}
