import { AGENT_NAMES, AGENT_PORTS, JOB_AGENT, JOB_MINUTES, agentApiKey, agentMayActOn, type AgentName, type JobKind } from '@rogue/core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alertOperator } from './notify';
import { scoreSource } from './page-text';
import { ensureMigrated, getPool, ipv4Fetch } from './services';

/**
 * Agent job queue (ADR 0002: AI work runs in Nanobot agents, never in a web request).
 * The row's status is the source of truth: queued -> running -> done | needs_human | failed. One job runs at a time because the
 * local model serves one request at a time. Agents act only through the propose-only tools in agent-tools.ts.
 */
export { JOB_AGENT, type JobKind };

const shareDir = () => process.env['ROGUE_AGENT_SHARE_DIR'] ?? '';
const agentsUrl = () => (process.env['ROGUE_AGENTS_URL'] ?? '').trim().replace(/\/+$/, '');
/** Kill switch: ROGUE_AGENTS=0 stops dispatching (jobs stay queued). Agents are off unless the sidecar URL is configured. */
export const agentsEnabled = (): boolean => agentsUrl() !== '' && process.env['ROGUE_AGENTS'] !== '0';

let cachedKey: string | null = null;
/** Shared key on the hand-off volume. The web app creates it; the sidecar (read-only mount) waits for it. */
export function agentKey(): string | null {
  if (cachedKey) return cachedKey;
  const dir = shareDir(); if (!dir) return null;
  const file = join(dir, 'agent-key');
  try {
    if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o644 }); }
    cachedKey = readFileSync(file, 'utf8').trim();
  } catch (e) { console.warn('[agents] cannot prepare key file:', (e as Error).message); return null; }
  return cachedKey;
}

const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

/** Queue a job unless an identical one is already open (the unique index also guards this). */
export async function enqueueJob(kind: JobKind, sourceId: number): Promise<number | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = await pool.query("INSERT INTO agent_jobs(kind, source_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id", [kind, sourceId]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}

/** Queue a job on a game request (terms_judge) unless one is already open for it. */
export async function enqueueRequestJob(kind: JobKind, requestId: number): Promise<number | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = await pool.query("INSERT INTO agent_jobs(kind, request_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id", [kind, requestId]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}

/** source_id is 0 for jobs on a game request; request_id is null for jobs on a source. */
export interface JobRow { id: number; kind: JobKind; source_id: number; request_id: number | null; status: string; attempts: number }

/** Jobs a tool call may act on: this agent's kind, currently running. */
export async function runningJob(agent: AgentName, jobId: number): Promise<JobRow | null> {
  const pool = getPool(); if (!pool) return null;
  const r = (await pool.query("SELECT id, kind, source_id, request_id, status, attempts FROM agent_jobs WHERE id=$1 AND status='running'", [jobId])).rows[0];
  if (!agentMayActOn(agent, r)) return null;
  return { id: Number(r.id), kind: r.kind, source_id: Number(r.source_id ?? 0), request_id: r.request_id === null ? null : Number(r.request_id), status: r.status, attempts: r.attempts };
}

/** Count a page change on a running job so the source is re-indexed afterwards. */
export async function bumpChanged(jobId: number): Promise<void> {
  await getPool()?.query("UPDATE agent_jobs SET result = jsonb_set(result, '{changedPages}', to_jsonb(COALESCE((result->>'changedPages')::int,0)+1)) WHERE id=$1", [jobId]);
}

/** Add to number counters in a running job's result (progress the admin and the add-game pipeline can read). */
export async function bumpCounts(jobId: number, counts: Record<string, number>, set: Record<string, unknown> = {}): Promise<void> {
  const pool = getPool(); if (!pool) return;
  const keys = Object.keys(counts);
  if (keys.length === 0 && Object.keys(set).length === 0) return;
  // result || {k: coalesce(result.k,0)+n, ...} || set, built in SQL so concurrent tool calls cannot lose an increment.
  const parts = keys.map((_, i) => `jsonb_build_object($${2 * i + 3}::text, COALESCE((result->>$${2 * i + 3})::int, 0) + $${2 * i + 4}::int)`);
  const params: unknown[] = [jobId, JSON.stringify(set)];
  keys.forEach((k) => params.push(k, Math.trunc(counts[k] ?? 0)));
  await pool.query(`UPDATE agent_jobs SET result = result${parts.map((p) => ` || ${p}`).join('')} || $2::jsonb WHERE id=$1 AND status='running'`, params);
}

export interface JobState { id: number; kind: JobKind; source_id: number; status: string; summary: string | null; error: string | null; result: Record<string, unknown>; created_at: string; finished_at: string | null }

/** One job by id, for progress displays. */
export async function getJob(jobId: number): Promise<JobState | null> {
  const r = (await getPool()?.query('SELECT id, kind, source_id, status, summary, error, result, created_at, finished_at FROM agent_jobs WHERE id=$1', [jobId]))?.rows[0];
  return r ? { ...r, id: Number(r.id), source_id: Number(r.source_id) } : null;
}

/** Queue a job, or return the one already open for this kind and source. */
export async function enqueueOrOpenJob(kind: JobKind, sourceId: number): Promise<number | null> {
  const id = await enqueueJob(kind, sourceId);
  if (id !== null) return id;
  const r = (await getPool()?.query("SELECT id FROM agent_jobs WHERE kind=$1 AND source_id=$2 AND status IN ('queued','running') ORDER BY id DESC LIMIT 1", [kind, sourceId]))?.rows[0];
  return r ? Number(r.id) : null;
}

export async function finishJob(jobId: number, status: 'done' | 'needs_human', summary: string, result: Record<string, unknown> = {}): Promise<void> {
  await getPool()?.query("UPDATE agent_jobs SET status=$2, summary=$3, result=result || $4::jsonb, finished_at=now() WHERE id=$1 AND status='running'", [jobId, status, summary.slice(0, 1500), JSON.stringify(result)]);
}

/** Call one agent as a chat model. The agent's own tool calls happen inside this request; the answer text is only a log line. */
async function callAgent(agent: AgentName, jobId: number, kind: JobKind): Promise<string> {
  const key = agentKey(); if (!key) throw new Error('agent key file not available');
  const url = `${agentsUrl()}:${AGENT_PORTS[agent]}/v1/chat/completions`;
  const res = await ipv4Fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agentApiKey(key, agent)}` },
    body: JSON.stringify({ session_id: `job-${jobId}-${Date.now()}`, messages: [{ role: 'user', content: `Job ${jobId} (${kind}). Start by calling get_job with job_id ${jobId}, follow your instructions, and end with finish_job.` }] }),
    signal: AbortSignal.timeout(JOB_MINUTES[kind] * 60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`agent answered HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return String(JSON.parse(text)?.choices?.[0]?.message?.content ?? '').slice(0, 500); } catch { return text.slice(0, 200); }
}

let busy = false;
/** Run the next due job. Returns true if one ran (so the caller may loop). */
export async function runNextJob(): Promise<boolean> {
  const pool = getPool(); if (!pool || busy || !agentsEnabled()) return false;
  busy = true;
  let job: { id: number; kind: JobKind; attempts: number } | undefined;
  try {
    await ensureMigrated();
    // A job stuck in 'running' (restart mid-run) is released 15 minutes after its time budget.
    for (const [kind, minutes] of Object.entries(JOB_MINUTES)) {
      await pool.query("UPDATE agent_jobs SET status='queued', error='released after restart or timeout' WHERE status='running' AND kind=$1 AND started_at < now() - ($2 || ' minutes')::interval", [kind, String(minutes + 15)]);
    }
    job = (await pool.query("UPDATE agent_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=(SELECT id FROM agent_jobs WHERE status='queued' AND not_before <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, kind, attempts")).rows[0];
    if (!job) return false;
    const agent = JOB_AGENT[job.kind];
    await audit(`agent:${agent}`, 'job_started', { id: job.id, kind: job.kind, attempt: job.attempts });
    let said = '';
    try { said = await callAgent(agent, Number(job.id), job.kind); }
    catch (e) {
      const msg = (e as Error).message;
      // Sidecar down or still starting: try again later without burning the job.
      const unreachable = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|key file/.test(msg);
      const giveUp = job.attempts >= (unreachable ? 8 : 2);
      await pool.query("UPDATE agent_jobs SET status=$2, error=$3, not_before=now() + ($4 || ' minutes')::interval, finished_at=CASE WHEN $2='failed' THEN now() END WHERE id=$1 AND status='running'", [job.id, giveUp ? 'failed' : 'queued', msg.slice(0, 500), unreachable ? '10' : '3']);
      await audit(`agent:${agent}`, 'job_error', { id: job.id, error: msg.slice(0, 300) });
      // A failed terms job must still reach a human, or the game request would wait forever.
      if (giveUp && job.kind === 'terms_judge') await afterJob(job.kind, Number(job.id)).catch((e) => console.warn('[agents] afterJob failed:', (e as Error).message));
      return true;
    }
    // The agent finished talking. If it never called finish_job, the work it did is kept but a human is told.
    const after = (await pool.query('SELECT status FROM agent_jobs WHERE id=$1', [job.id])).rows[0];
    if (after?.status === 'running') {
      await pool.query("UPDATE agent_jobs SET status='needs_human', summary=$2, finished_at=now() WHERE id=$1", [job.id, `The agent stopped without finishing: ${said.slice(0, 300)}`]);
      await alertOperator(`Agent job #${job.id} (${job.kind}) ended without finish_job; see /admin/quality.`);
    }
    await audit(`agent:${agent}`, 'job_ended', { id: job.id, status: after?.status ?? null });
    if (after?.status === 'done' || after?.status === 'needs_human' || after?.status === 'running') await afterJob(job.kind, Number(job.id)).catch((e) => console.warn('[agents] afterJob failed:', (e as Error).message));
    return true;
  } catch (e) {
    console.warn('[agents] dispatcher error:', (e as Error).message);
    return false;
  } finally { busy = false; }
}

/**
 * After a quality job changed page text, rebuild that source's chunks so search sees the better text.
 * After a terms job, code turns the agent's labels into the verdict and settles the game request.
 */
async function afterJob(kind: JobKind, jobId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  if (kind === 'terms_judge') {
    const j = (await pool.query('SELECT id, status, request_id, result FROM agent_jobs WHERE id=$1', [jobId])).rows[0];
    if (!j?.request_id) return;
    const { afterTermsJudged } = await import('./add-game'); // add-game imports this module; load it lazily
    await afterTermsJudged(Number(j.request_id), { id: Number(j.id), status: j.status, result: j.result ?? {} });
    return;
  }
  if (kind !== 'quality_curate') return;
  const j = (await pool.query('SELECT source_id, result FROM agent_jobs WHERE id=$1', [jobId])).rows[0];
  if (!j || !(Number(j.result?.changedPages) > 0)) return;
  const { indexSource } = await import('./rules-index');
  await indexSource(Number(j.source_id));
}

/**
 * Find work: scored-but-unreviewed rulebooks and rulebooks never searched for text variants. Cheap queries, capped per tick,
 * so existing games are covered without any admin button.
 */
export async function sweepForWork(): Promise<void> {
  const pool = getPool(); if (!pool || !agentsEnabled()) return;
  await ensureMigrated();
  // 1. Score rulebook sources that have no page scores yet (pure code), then queue a curator job for any source with weak pages
  //    that was never curated. Pages an agent already reviewed are not offered again for the same file.
  const unscored = (await pool.query(
    `SELECT s.id FROM sources s JOIN documents d ON d.source_id=s.id WHERE s.text_path IS NOT NULL AND s.availability='available' AND d.kind IN ('rulebook','faq','errata','quickstart')
     AND NOT EXISTS (SELECT 1 FROM page_quality q WHERE q.source_id=s.id) GROUP BY s.id ORDER BY s.id LIMIT 3`)).rows;
  for (const r of unscored) await scoreSource(Number(r.id)).catch(() => null);
  const weak = (await pool.query(
    `SELECT q.source_id FROM page_quality q WHERE q.state='auto' AND q.verdict IN ('suspect','garbled')
     AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.source_id=q.source_id AND j.kind='quality_curate' AND (j.status IN ('queued','running') OR j.created_at > now() - interval '7 days'))
     GROUP BY q.source_id ORDER BY q.source_id LIMIT 3`)).rows;
  for (const r of weak) await enqueueJob('quality_curate', Number(r.source_id));
  // 2. PDF rulebooks never searched for a text version.
  const pdfs = (await pool.query(
    `SELECT s.id FROM sources s JOIN documents d ON d.source_id=s.id WHERE s.text_path IS NOT NULL AND s.availability='available' AND d.kind='rulebook' AND s.content_type ILIKE '%pdf%'
     AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.source_id=s.id AND j.kind='scout_variants') GROUP BY s.id ORDER BY s.id LIMIT 2`)).rows;
  for (const r of pdfs) await enqueueJob('scout_variants', Number(r.id));
}

let started = false;
/** Called from middleware like the other schedulers; idempotent. */
export function startAgentWorker(): void {
  if (started || !getPool() || !agentsEnabled()) return;
  started = true;
  const tick = async () => {
    await sweepForWork().catch((e) => console.warn('[agents] sweep failed:', (e as Error).message));
    for (let i = 0; i < 5 && (await runNextJob()); i++) { /* drain a few jobs per tick */ }
  };
  setInterval(() => void tick(), 60_000).unref();
  setTimeout(() => void tick(), 90_000).unref();
}

export { AGENT_NAMES };
