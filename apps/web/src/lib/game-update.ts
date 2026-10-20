import {
  finalUpdateStatus, initialStepRecords, isStepRecords, nextStep, sourcesToDraft, stepCounts, updateProgressText,
  type GameUpdateStep, type StepRecord, type StepStatus,
} from '@rogue/core';
import { agentsEnabled, getJob, type JobState } from './agent-jobs';
import { refreshDerivedOutputs, supersedeSoleSourceClaims } from './derived-outputs';
import { allSeeds } from './dynamic-sources';
import { startExtractReview } from './extractor-run';
import { ingestSeed } from './ingest';
import { describeLibrarianJob, startLibrarian } from './librarian-run';
import { recheckSource } from './lifecycle';
import { indexSource } from './rules-index';
import { ensureMigrated, getPool } from './services';
import { isWikiSource, reingestWikiPage } from './wiki-crawl';

/**
 * "Review and update this game" (HANDOFF 0e, docs/DERIVED_OUTPUTS.md): one background run per game that brings its knowledge
 * and its setup sheet / player aid up to date. Steps, in order (packages/core/src/game-update.ts):
 *   recheck   re-check the game's sources (lifecycle recheck; skips sources checked in the last 24 h; a refusal or bot wall
 *             on a host skips the rest of that host, never retried around);
 *   ingest    re-ingest available sources without extracted text (forced, through the normal rights gate) and index them;
 *   extract   Extractor review of unsure pages of each PDF source (agents only; waits for each job, with a timeout);
 *   draft     Librarian on each available rulebook/wiki source without claims (all of them with "redraft"; agents only);
 *   supersede sole-source claims of retired/unavailable sources become 'superseded';
 *   rebuild   refreshDerivedOutputs (version goes up only when the basis changed).
 * The step list is saved after every step (game_updates, migration 0046), so a restart resumes at the unfinished step,
 * like wiki_crawls. An admin Stop is checked between sources and while waiting for a job.
 */

const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

/** How long one step waits for one agent job before moving on (the job itself carries on). */
const EXTRACT_WAIT_MIN = 30;
const DRAFT_WAIT_MIN = 120;
const RECHECK_MIN_HOURS = 24;

export interface GameUpdateRow {
  id: number; status: 'running' | 'done' | 'failed' | 'stopped'; steps: StepRecord[]; redraft: boolean; progress: string | null;
  startedAt: string; finishedAt: string | null;
}

/** Runs active in this process (a 'running' row without an entry here was interrupted by a restart and is resumed). */
const g = globalThis as Record<string, unknown>;
const active = (g['__rogueGameUpdates'] ??= new Set<number>()) as Set<number>;

/** Start a run in the background. One per game at a time (the partial unique index also guards this). */
export async function startGameUpdate(slug: string, steps: GameUpdateStep[], redraft: boolean, adminId: number): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
  await ensureMigrated();
  if (!(await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return { ok: false, error: 'Unknown game.' };
  const records = initialStepRecords(steps);
  let id: number;
  try {
    id = Number((await pool.query(
      'INSERT INTO game_updates(game_slug, steps, redraft, progress, started_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [slug, JSON.stringify(records), redraft, 'queued', adminId])).rows[0].id);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, error: 'An update is already running for this game; wait for it or stop it first.' };
    throw e;
  }
  await audit(`admin:${adminId}`, 'game_update_started', { slug, updateId: id, steps: records.length, redraft });
  void runUpdate(id);
  return { ok: true, id };
}

/** Latest run of a game, for the sources page and the overview. Resumes it when a restart interrupted it. */
export async function gameUpdateStatus(slug: string): Promise<GameUpdateRow | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `SELECT id, status, steps, redraft, progress, to_char(started_at,'YYYY-MM-DD HH24:MI') started, to_char(finished_at,'YYYY-MM-DD HH24:MI') finished
     FROM game_updates WHERE game_slug=$1 ORDER BY id DESC LIMIT 1`, [slug])).rows[0];
  if (!r) return null;
  if (r.status === 'running' && !active.has(Number(r.id))) void runUpdate(Number(r.id));
  return { id: Number(r.id), status: r.status, steps: isStepRecords(r.steps) ? r.steps : [], redraft: !!r.redraft, progress: r.progress, startedAt: r.started, finishedAt: r.finished ?? null };
}

/** Stop the running update of a game (it ends after the source or wait it is on). */
export async function stopGameUpdate(slug: string, adminId: number): Promise<boolean> {
  const r = await getPool()?.query("UPDATE game_updates SET status='stopped', progress=COALESCE(progress,'') || ' (stopped by an admin)', finished_at=now() WHERE game_slug=$1 AND status='running' RETURNING id, steps", [slug]);
  if (!r?.rowCount) return false;
  const row = r.rows[0];
  await audit(`admin:${adminId}`, 'game_update_finished', { slug, updateId: Number(row.id), status: 'stopped', ...(isStepRecords(row.steps) ? stepCounts(row.steps) : {}) });
  return true;
}

/** Once per server process (middleware): pick up runs a restart interrupted. */
export function startGameUpdateResume(): void {
  if (g['__rogueGameUpdateResume']) return;
  g['__rogueGameUpdateResume'] = true;
  setTimeout(() => void resumeGameUpdates().catch(() => {}), 20_000);
}

async function resumeGameUpdates(): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  for (const r of (await pool.query("SELECT id FROM game_updates WHERE status='running' ORDER BY id")).rows) if (!active.has(Number(r.id))) void runUpdate(Number(r.id));
}

/** What a step reports: ok/skipped/failed and one line. */
type StepOutcome = { status: Exclude<StepStatus, 'pending' | 'running'>; line: string };
/** Helpers a step gets: report progress (false once an admin stopped the run). */
interface StepCtx { slug: string; redraft: boolean; progress: (detail: string) => Promise<boolean>; stopped: () => Promise<boolean> }

const STEP_RUNNERS: Record<GameUpdateStep, (c: StepCtx) => Promise<StepOutcome>> = {
  recheck: recheckStep, ingest: ingestStep, extract: extractStep, draft: draftStep, supersede: supersedeStep, rebuild: rebuildStep,
};

/** The step loop. Saves the step list after every step; an admin stop ends it. */
async function runUpdate(id: number): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  const pool = getPool();
  try {
    if (!pool) return;
    const row = (await pool.query("SELECT game_slug, steps, redraft FROM game_updates WHERE id=$1 AND status='running'", [id])).rows[0];
    if (!row) return;
    const slug = String(row.game_slug);
    if (!isStepRecords(row.steps)) { await finish(id, slug, 'failed', [], 'error: stored step list is unreadable'); return; }
    const records: StepRecord[] = row.steps;
    const save = async (progress: string) => !!(await pool.query("UPDATE game_updates SET steps=$2, progress=$3 WHERE id=$1 AND status='running' RETURNING id", [id, JSON.stringify(records), progress.slice(0, 300)])).rowCount;
    const stopped = async () => !(await pool.query("SELECT 1 FROM game_updates WHERE id=$1 AND status='running'", [id])).rowCount;
    for (let cur = nextStep(records); cur; cur = nextStep(records)) {
      const step = cur;
      step.status = 'running';
      if (!(await save(updateProgressText(records)))) return; // stopped by an admin
      const ctx: StepCtx = { slug, redraft: !!row.redraft, stopped, progress: (detail) => save(updateProgressText(records, detail)) };
      let out: StepOutcome;
      try { out = await STEP_RUNNERS[step.step](ctx); }
      catch (e) { out = { status: 'failed', line: `error: ${e instanceof Error ? e.message : 'unknown'}` }; }
      if (await stopped()) { step.status = out.status; step.line = out.line.slice(0, 200); await pool.query('UPDATE game_updates SET steps=$2 WHERE id=$1', [id, JSON.stringify(records)]); return; }
      step.status = out.status; step.line = out.line.slice(0, 200);
      if (!(await save(updateProgressText(records)))) return;
    }
    await finish(id, slug, finalUpdateStatus(records), records, updateProgressText(records));
  } catch (e) {
    const slug = (await pool?.query('SELECT game_slug FROM game_updates WHERE id=$1', [id]).catch(() => null))?.rows[0]?.game_slug ?? null;
    await finish(id, slug, 'failed', [], `error: ${e instanceof Error ? e.message : 'unknown'}`).catch(() => {});
  } finally {
    active.delete(id);
  }
}

async function finish(id: number, slug: string | null, status: 'done' | 'failed', records: StepRecord[], progress: string): Promise<void> {
  const r = await getPool()?.query("UPDATE game_updates SET status=$2, steps=CASE WHEN $3::jsonb = '[]'::jsonb THEN steps ELSE $3::jsonb END, progress=$4, finished_at=now() WHERE id=$1 AND status='running' RETURNING id",
    [id, status, JSON.stringify(records), progress.slice(0, 300)]);
  // Counts only (no URLs, no claim text).
  if (r?.rowCount) await audit('game-update', 'game_update_finished', { slug, updateId: id, status, ...stepCounts(records) });
}

// ---- the steps ----

/** The game's sources with what the steps need to pick from them. */
async function gameSources(slug: string): Promise<{ id: number; url: string; kind: string; available: boolean; retired: boolean; hasText: boolean; capture: boolean; pdf: boolean; recentlyChecked: boolean; claims: number }[]> {
  const rows = (await getPool()!.query(
    `SELECT s.id, s.url, CASE WHEN bool_or(d.kind='rulebook') THEN 'rulebook' WHEN bool_or(d.kind='wiki') THEN 'wiki' ELSE min(d.kind) END kind, s.availability, s.retired_at IS NOT NULL retired, s.text_path IS NOT NULL has_text, s.capture_method IS NOT NULL capture,
       COALESCE(s.content_type,'') ~* 'pdf' pdf, COALESCE(s.last_checked_at > now() - make_interval(hours => $2), false) recent,
       (SELECT count(DISTINCT ci.claim_id)::int FROM citations ci JOIN documents d2 ON d2.id=ci.document_id WHERE d2.source_id=s.id) claims
     FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 GROUP BY s.id ORDER BY s.id`, [slug, RECHECK_MIN_HOURS])).rows;
  return rows.map((r) => ({
    id: Number(r.id), url: String(r.url), kind: String(r.kind), retired: !!r.retired, hasText: !!r.has_text, capture: !!r.capture, pdf: !!r.pdf,
    available: !r.retired && (r.availability === 'available' || r.availability === 'changed'), recentlyChecked: !!r.recent, claims: Number(r.claims),
  }));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };

async function recheckStep(c: StepCtx): Promise<StepOutcome> {
  const all = (await gameSources(c.slug)).filter((s) => !s.retired && !s.capture);
  const due = all.filter((s) => !s.recentlyChecked);
  if (!due.length) return { status: 'skipped', line: all.length ? `all ${plural(all.length, 'source')} checked in the last ${RECHECK_MIN_HOURS} h` : 'no fetchable sources' };
  const tally: Record<string, number> = {};
  const refusedHosts = new Set<string>();
  let skippedHost = 0;
  for (const [i, s] of due.entries()) {
    if (await c.stopped()) break;
    // A host that refused once (robots, 403/429, bot wall) is not asked again in this run.
    if (refusedHosts.has(hostOf(s.url))) { skippedHost++; continue; }
    await c.progress(`source ${i + 1}/${due.length}`);
    const r = await recheckSource(s.id);
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    if (r.outcome === 'denied' || r.outcome === 'transient_error') refusedHosts.add(hostOf(s.url));
  }
  const parts = Object.entries(tally).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
  if (skippedHost) parts.push(`${skippedHost} left for later (host refused or errored)`);
  const recent = all.length - due.length;
  if (recent) parts.push(`${recent} checked in the last ${RECHECK_MIN_HOURS} h`);
  return { status: 'ok', line: `rechecked: ${parts.join(', ')}` };
}

/** Re-fetch one source (force, rights gate and tombstone check inside ingestSeed) and index it; waits for the result. */
async function reingestNow(slug: string, sourceId: number, url: string): Promise<{ ok: boolean; detail: string }> {
  if (await isWikiSource(sourceId)) { const r = await reingestWikiPage(slug, sourceId); return { ok: r.ok, detail: r.detail }; }
  const seed = (await allSeeds()).find((s) => s.url === url);
  if (!seed) return { ok: false, detail: 'no seed for this source' };
  const res = await ingestSeed(seed, true);
  if (!res.ok || !res.sourceId) return { ok: false, detail: res.detail };
  await indexSource(res.sourceId);
  return { ok: true, detail: 'indexed' };
}

async function ingestStep(c: StepCtx): Promise<StepOutcome> {
  const todo = (await gameSources(c.slug)).filter((s) => s.available && !s.hasText && !s.capture);
  if (!todo.length) return { status: 'skipped', line: 'every available source has extracted text' };
  let ok = 0; const failed: string[] = [];
  for (const [i, s] of todo.entries()) {
    if (await c.stopped()) break;
    await c.progress(`re-ingesting source ${s.id} (${i + 1}/${todo.length})`);
    const r = await reingestNow(c.slug, s.id, s.url).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : 'unknown' }));
    if (r.ok) ok++; else failed.push(`#${s.id}: ${r.detail.slice(0, 60)}`);
  }
  const line = `${ok}/${plural(todo.length, 'source')} re-ingested and indexed${failed.length ? `; failed ${failed.join('; ')}` : ''}`;
  return { status: failed.length && !ok ? 'failed' : 'ok', line };
}

/** Wait for an agent job to leave queued/running, reporting progress. Gives up after `maxMinutes` (the job carries on). */
async function waitJob(c: StepCtx, jobId: number, maxMinutes: number, describe: (j: JobState) => string): Promise<JobState | null> {
  for (let waited = 0; ; waited += 15_000) {
    const j = await getJob(jobId);
    if (!j || (j.status !== 'queued' && j.status !== 'running')) return j;
    if (waited >= maxMinutes * 60_000 || !(await c.progress(describe(j)))) return j;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

const jobEnded = (j: JobState | null) => !!j && j.status !== 'queued' && j.status !== 'running';

async function extractStep(c: StepCtx): Promise<StepOutcome> {
  if (!agentsEnabled()) return { status: 'skipped', line: 'agents are off: the Extractor review needs the agents sidecar' };
  const pdfs = (await gameSources(c.slug)).filter((s) => s.available && s.hasText && s.pdf);
  if (!pdfs.length) return { status: 'skipped', line: 'no PDF source with text' };
  let reviewed = 0, nothing = 0, waiting = 0; const failed: string[] = [];
  for (const s of pdfs) {
    if (await c.stopped()) break;
    const r = await startExtractReview(s.id);
    if ('error' in r) { failed.push(`#${s.id}: ${r.error.slice(0, 60)}`); continue; }
    if (r.mode !== 'agent') { nothing++; continue; }
    const j = await waitJob(c, r.jobId, EXTRACT_WAIT_MIN, (job) => `Extractor review of source ${s.id}: ${r.open} unsure pages, job #${job.id} ${job.status}`);
    if (!jobEnded(j)) waiting++;
    else if (j!.status === 'failed') failed.push(`#${s.id}: job #${j!.id} failed`);
    else reviewed++;
  }
  const parts = [`${reviewed} reviewed`, `${nothing} without unsure pages`];
  if (waiting) parts.push(`${waiting} still running (stopped waiting after ${EXTRACT_WAIT_MIN} min)`);
  if (failed.length) parts.push(`failed ${failed.join('; ')}`);
  return { status: failed.length && !reviewed && !nothing ? 'failed' : 'ok', line: `${plural(pdfs.length, 'PDF source')}: ${parts.join(', ')}` };
}

async function draftStep(c: StepCtx): Promise<StepOutcome> {
  if (!agentsEnabled()) return { status: 'skipped', line: 'agents are off: run the Librarian from the admin Run page instead' };
  const list = await gameSources(c.slug);
  const ids = sourcesToDraft(list.map((s) => ({ sourceId: s.id, kind: s.kind, available: s.available, hasText: s.hasText, claims: s.claims })), c.redraft);
  if (!ids.length) return { status: 'skipped', line: c.redraft ? 'no available rulebook or wiki source with text' : 'every available rulebook/wiki source already has drafted claims (tick "redraft" to draft again)' };
  let done = 0, published = 0, waiting = 0; const failed: string[] = [];
  for (const id of ids) {
    if (await c.stopped()) break;
    const r = await startLibrarian(c.slug, id);
    if ('error' in r) { failed.push(`#${id}: ${r.error.slice(0, 60)}`); continue; }
    if (r.mode !== 'agent') { failed.push(`#${id}: Librarian ran in-process`); continue; }
    const j = await waitJob(c, r.jobId, DRAFT_WAIT_MIN, (job) => `source ${id}: ${describeLibrarianJob(job)}`);
    if (!jobEnded(j)) waiting++;
    else if (j!.status === 'failed') failed.push(`#${id}: job #${j!.id} failed`);
    else { done++; published += Number(j!.result['published'] ?? 0); }
  }
  const parts = [`${done} drafted`, `${published} cited facts published`];
  if (waiting) parts.push(`${waiting} still drafting (stopped waiting after ${DRAFT_WAIT_MIN} min)`);
  if (failed.length) parts.push(`failed ${failed.join('; ')}`);
  return { status: failed.length && !done && !waiting ? 'failed' : 'ok', line: `${plural(ids.length, 'source')}: ${parts.join(', ')}` };
}

async function supersedeStep(c: StepCtx): Promise<StepOutcome> {
  const gone = (await gameSources(c.slug)).filter((s) => !s.available);
  if (!gone.length) return { status: 'skipped', line: 'no retired or unavailable source' };
  let superseded = 0, kept = 0;
  for (const s of gone) { const r = await supersedeSoleSourceClaims(s.id, 'game-update'); superseded += r.superseded; kept += r.kept; }
  return { status: 'ok', line: `${plural(gone.length, 'retired/unavailable source')}: ${plural(superseded, 'claim')} superseded, ${kept} kept (also cited elsewhere)` };
}

async function rebuildStep(c: StepCtx): Promise<StepOutcome> {
  const before = (await getPool()!.query('SELECT version FROM game_outputs WHERE game_slug=$1', [c.slug])).rows[0]?.version;
  const stamp = await refreshDerivedOutputs(c.slug, 'review-update');
  if (!stamp) return { status: 'failed', line: 'refresh failed (see the server log)' };
  const changed = before === undefined || Number(before) !== stamp.version;
  return { status: 'ok', line: `${changed ? 'now' : 'unchanged at'} v${stamp.version} (${plural(stamp.sources, 'source')}, ${plural(stamp.claims, 'claim')})` };
}
