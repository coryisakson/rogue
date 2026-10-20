import {
  CAPTURE_METHOD, RateLimiter, authorityLabel, bggSearchNote, captureLabel, isAuthorityAttested, libraryMatch, runtimeEditionLabel, runtimeSeed, slugify, sourceProbeGate, termsGate,
  type GameMatch, type SourceInput,
} from '@rogue/core';
import { probeRulebook, type RightsReport } from './add-game';
import { sourcesChanged, supersedeSoleSourceClaims } from './derived-outputs';
import { allSeeds, syncApprovedHosts } from './dynamic-sources';
import { resumeQueue } from './intake';
import { ingestSeed } from './ingest';
import { startLibrarian } from './librarian-run';
import { indexSource } from './rules-index';
import { searchGameOutcome } from './search';
import { ensureMigrated, getPool } from './services';
import { ALLOWED_HOSTS } from './source-seeds';
import { isWikiSource, reingestWikiPage } from './wiki-crawl';

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
  /** sources.authority and its badge wording ("Publisher wiki" / "Community wiki" for wiki pages). */
  authority: string; authorityLabel: string;
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
    `SELECT DISTINCT ON (s.id) s.id, s.url, s.title, s.language, s.authority, d.kind, e.label edition, s.availability, to_char(s.fetched_at, 'YYYY-MM-DD HH24:MI') fetched_at, s.page_count,
       (SELECT count(DISTINCT ch.page)::int FROM chunks ch WHERE ch.source_id=s.id) indexed_pages,
       EXISTS (SELECT 1 FROM runtime_sources rs WHERE rs.url=s.url) runtime,
       s.capture_method, s.captured_at, (SELECT u.display_name FROM users u WHERE u.id=s.captured_by) captured_by_name
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 ORDER BY s.id, d.id`, [slug])).rows;
  return rows.map((r) => ({
    id: Number(r.id), url: r.url, title: r.title, language: r.language, kind: r.kind, edition: r.edition, availability: r.availability,
    fetchedAt: r.fetched_at, pageCount: r.page_count == null ? null : Number(r.page_count), indexedPages: Number(r.indexed_pages), runtime: r.runtime,
    capture: captureLabel(r.capture_method, r.captured_by_name, r.captured_at),
    authority: r.authority, authorityLabel: authorityLabel(r.authority, r.kind === 'wiki'),
  }));
}

/** Published facts of a game (what users see). */
export async function factsCount(slug: string): Promise<number> {
  const pool = getPool(); if (!pool) return 0;
  return (await pool.query("SELECT count(*)::int n FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id WHERE g.slug=$1 AND c.status='published'", [slug])).rows[0].n;
}

/** Admin-added links of a game that have not produced a source row yet, or are still running (pipeline progress). */
export async function pendingRuntimeSources(slug: string): Promise<{ id: number; url: string; title: string; progress: string | null; hasSource: boolean }[]> {
  const pool = getPool(); if (!pool) return [];
  return (await pool.query('SELECT rs.id, rs.url, rs.title, rs.progress, EXISTS (SELECT 1 FROM sources s WHERE s.url=rs.url) has_source FROM runtime_sources rs WHERE rs.game_slug=$1 ORDER BY rs.id DESC LIMIT 20', [slug])).rows.map((r) => ({ id: Number(r.id), url: r.url, title: r.title, progress: r.progress, hasSource: !!r.has_source }));
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
      `INSERT INTO runtime_sources(game_slug, url, title, publisher, language, kind, edition_label, found_on, replaces_source_id, report, progress, added_by, authority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12) RETURNING id`,
      [slug, v.url, v.title, v.publisher, v.language, v.kind, label, v.foundOn, replacesSourceId, report, adminId, v.authority])).rows[0].id);
    if (replacesSourceId !== null) {
      // Keep the row, its documents and citations: published facts stay attributable (lifecycle rule, migration 0005).
      await c.query("UPDATE sources SET availability='unavailable', retired_at=now(), unavailable_since=COALESCE(unavailable_since, now()) WHERE id=$1", [replacesSourceId]);
    }
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`admin:${adminId}`, replacesSourceId === null ? 'game_source_added' : 'game_source_replaced',
      { slug, runtimeSourceId: id, url: v.url, kind: v.kind, language: v.language, host: report.host, verdict: report.verdict, termsChecked, replacesSourceId,
        // The admin's Authority choice; 'attested' when it differs from the default (they vouch for it).
        authority: v.authority, attested: isAuthorityAttested(v.authority, false) }]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    if ((e as { code?: string }).code === '23505') return { ok: false, error: 'That link was just added by someone else.', report };
    throw e;
  } finally { c.release(); }
  // The retired source no longer backs the one-pager and player aid: its sole-source claims are superseded (ADR 0008).
  if (replacesSourceId !== null) await supersedeSoleSourceClaims(replacesSourceId, `admin:${adminId}`).catch((e) => console.warn('[outputs] supersede failed:', (e as Error).message));
  void sourcesChanged(slug, replacesSourceId === null ? 'source_added' : 'source_replaced');
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
    const row = (await getPool()!.query('SELECT game_slug, url, title, publisher, language, kind, edition_label, found_on, authority FROM runtime_sources WHERE id=$1', [id])).rows[0];
    if (!row) return;
    const seed = runtimeSeed(row);
    await setProgress(id, 'fetching');
    const res = await ingestSeed(seed, true);
    if (!res.ok || !res.sourceId) { await setProgress(id, `ingest failed: ${res.detail}`); return; }
    await setProgress(id, `indexing ${res.pages ?? '?'} pages`);
    const idx = await indexSource(res.sourceId);
    if (seed.kind !== 'rulebook') { await setProgress(id, `done: ${idx.chunks} chunks indexed (the Librarian drafts from rulebooks only)`); await sourcesChanged(seed.gameSlug, 'source_ingested'); return; }
    const lib = await startLibrarian(seed.gameSlug, res.sourceId);
    await setProgress(id, 'error' in lib ? `indexed ${idx.chunks} chunks; Librarian not started: ${lib.error}`
      : lib.mode === 'agent' ? `indexed ${idx.chunks} chunks; Librarian job #${lib.jobId} queued` : `indexed ${idx.chunks} chunks; Librarian running in-process`);
    await audit('game-sources', 'game_source_ingested', { runtimeSourceId: id, sourceId: res.sourceId, chunks: idx.chunks, librarian: lib });
    await sourcesChanged(seed.gameSlug, 'source_ingested');
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
  // Wiki pages are not seeds: they re-fetch with the wiki cleanup (wiki-crawl.ts), through the same rights gate.
  if (await isWikiSource(sourceId)) {
    await audit(`admin:${adminId}`, 'game_source_reingest', { slug, sourceId, url, wiki: true });
    reingestProgress.set(sourceId, 'fetching wiki page');
    void reingestWikiPage(slug, sourceId)
      .then((r) => reingestProgress.set(sourceId, r.ok ? `done: ${r.chunks ?? 0} chunks indexed` : `ingest failed: ${r.detail}`))
      .then(() => sourcesChanged(slug, 'source_reingested'))
      .catch((e) => reingestProgress.set(sourceId, `error: ${e instanceof Error ? e.message : 'unknown'}`));
    return { ok: true };
  }
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
      await sourcesChanged(slug, 'source_reingested');
    } catch (e) { reingestProgress.set(sourceId, `error: ${e instanceof Error ? e.message : 'unknown'}`); }
  })();
  return { ok: true };
}

// ---- admin title search: the same pick list and the same per-user hourly limit as /request-game ----
const g = globalThis as Record<string, unknown>;
const searchLimiter = (g['__rogueSearchLimit'] ??= new RateLimiter(20, 3_600_000)) as RateLimiter;

export interface AdminMatch extends GameMatch { inRogue: string | null }

/** Matches with their place in Rogue, plus a note when there are none (search off, provider error, hits but none on BGG). */
export async function adminGameSearch(userId: number, q: string): Promise<{ matches: AdminMatch[]; note: string | null } | { error: string }> {
  if (!searchLimiter.allow(String(userId))) return { error: 'Too many searches this hour.' };
  const o = await searchGameOutcome(q);
  const note = bggSearchNote(o, q);
  if (o.kind !== 'ok') return { error: note ?? 'Search is not answering right now.' };
  const games = await listGames();
  return { matches: o.matches.map((m) => ({ ...m, inRogue: libraryMatch(m, games) })), note };
}

/**
 * "Add by name" when the title search found no BGG page: the same admin-approved request as adminRequestGame, without a
 * BGG id. Mode 'details' like a user's free-text request, but status 'queued' (the admin approved it), so the Scout,
 * Rights Officer, Terms Agent and the terms gate still run.
 */
export async function adminRequestByName(adminId: number, v: { title: string; year: number | null }): Promise<{ id: number } | { error: string }> {
  const pool = getPool(); if (!pool) return { error: 'The database is not available.' };
  await ensureMigrated();
  const slug = slugify(v.title);
  if (!slug) return { error: 'That name has no letters or digits.' };
  if (libraryMatch({ bggId: 0, title: v.title }, await listGames())) return { error: 'That game is already in Rogue.' };
  if ((await pool.query("SELECT 1 FROM game_requests WHERE slug=$1 AND status IN ('submitted','queued','manual','checked')", [slug])).rowCount) return { error: 'That game is already requested.' };
  const r = await pool.query("INSERT INTO game_requests(user_id, name, slug, year, mode, details, status, stage, decided_by) VALUES ($1,$2,$3,$4,'details',$5,'queued','in the queue for the Scout',$1) RETURNING id",
    [adminId, v.title, slug, v.year, `Added by name by an admin (no BoardGameGeek match): ${v.title}${v.year ? ` (${v.year})` : ''}`]);
  const id = Number(r.rows[0].id);
  await audit(`admin:${adminId}`, 'game_request_game_approved', { id, via: 'admin-name', title: v.title });
  void resumeQueue();
  return { id };
}

/**
 * A game added from a capture (/admin/capture with newGame): created directly as an admin-approved game, without the Scout,
 * because the admin already holds the rules text. Same games row as approveRequest() (add-game.ts) writes on approval:
 * slug from slugify, name, year, bgg_id, no publisher yet. A game already in Rogue (same BGG id or slug) is used as is.
 * `created` tells the caller whether to undo the row when the capture itself is then refused (undoCapturedGame).
 */
export async function gameForCapture(v: { name: string; bggId: number | null; year: number | null }): Promise<{ slug: string; created: boolean } | { error: string }> {
  const pool = getPool(); if (!pool) return { error: 'The database is not available.' };
  await ensureMigrated();
  const existing = libraryMatch({ bggId: v.bggId ?? 0, title: v.name }, await listGames());
  if (existing) return { slug: existing, created: false };
  const slug = slugify(v.name);
  if (!slug) return { error: 'That name has no letters or digits.' };
  const r = await pool.query('INSERT INTO games(slug, name, publisher, year, bgg_id) VALUES ($1,$2,NULL,$3,$4) ON CONFLICT DO NOTHING RETURNING slug', [slug, v.name, v.year, v.bggId]);
  // A parallel insert with the same slug or BGG id won: use that game.
  if (!r.rowCount) {
    const other = (await pool.query('SELECT slug FROM games WHERE slug=$1 OR ($2::int IS NOT NULL AND bgg_id=$2)', [slug, v.bggId])).rows[0];
    return other ? { slug: String(other.slug), created: false } : { error: 'The game could not be created.' };
  }
  return { slug, created: true };
}

/** Remove a game gameForCapture just created when the capture was refused, so no empty game is left behind. */
export async function undoCapturedGame(slug: string): Promise<void> {
  await getPool()?.query('DELETE FROM games g WHERE g.slug=$1 AND NOT EXISTS (SELECT 1 FROM editions e WHERE e.game_id=g.id)', [slug]).catch(() => {});
}

/** Audit the new game once its capture is stored. */
export async function auditCapturedGame(adminId: number, slug: string, name: string, bggId: number | null, sourceId: number): Promise<void> {
  await audit(`admin:${adminId}`, 'game_added_by_capture', { slug, name, adminId, bggId, sourceId });
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

/**
 * Remove an admin-added link that has no source row (its fetch failed or it is stuck in the pipeline). Links that did
 * produce a source are deleted with the source (lib/source-delete.ts). Audited; ids and URL only.
 */
export async function removePendingLink(slug: string, runtimeId: number, actor: string): Promise<boolean> {
  const pool = getPool(); if (!pool) return false;
  const r = await pool.query('DELETE FROM runtime_sources rs WHERE rs.id=$1 AND rs.game_slug=$2 AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.url=rs.url) RETURNING rs.url', [runtimeId, slug]);
  if (!r.rowCount) return false;
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'link_removed', { slug, runtimeSourceId: runtimeId, url: r.rows[0].url }]);
  return true;
}
