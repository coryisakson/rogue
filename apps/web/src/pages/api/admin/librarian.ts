import type { APIRoute } from 'astro';
import { agentsEnabled, getJob } from '../../../lib/agent-jobs';
import { describeLibrarianJob, librarianSourceId, librarianStatus, startLibrarian } from '../../../lib/librarian-run';
import { getPool } from '../../../lib/services';

/**
 * POST /api/admin/librarian?game=pandemic[&source=<id>] starts drafting: a `librarian_draft` agent job when the agents sidecar is on,
 * else the in-process run. GET returns progress: for agent jobs ?job=<id>, or the latest job (of ?game=<slug> if given);
 * without agents, the in-process status.
 */
export const POST: APIRoute = async ({ url }) => {
  const game = url.searchParams.get('game') ?? '';
  if (!/^[a-z0-9-]+$/.test(game)) return Response.json({ error: 'use ?game=<slug>' }, { status: 400 });
  if (!agentsEnabled() && librarianStatus()?.running) return Response.json({ started: false, status: librarianStatus() }, { status: 409 });
  const r = await startLibrarian(game, Number(url.searchParams.get('source')) || undefined);
  if ('error' in r) return Response.json({ started: false, error: r.error }, { status: 404 });
  return Response.json({ started: true, ...r });
};

export const GET: APIRoute = async ({ url }) => {
  const headers = { 'cache-control': 'no-store' };
  if (!agentsEnabled()) return Response.json(librarianStatus() ?? { running: false }, { headers });
  let jobId = Number(url.searchParams.get('job') ?? '');
  if (!Number.isInteger(jobId) || jobId < 1) {
    const game = url.searchParams.get('game') ?? '';
    const sourceId = /^[a-z0-9-]+$/.test(game) ? await librarianSourceId(game) : null;
    if (game && !sourceId) return Response.json({ agent: true, running: false, job: null }, { headers });
    const r = (await getPool()?.query(
      `SELECT id FROM agent_jobs WHERE kind='librarian_draft' AND ($1::bigint IS NULL OR source_id=$1) ORDER BY id DESC LIMIT 1`, [sourceId]))?.rows[0];
    if (!r) return Response.json({ agent: true, running: false, job: null }, { headers });
    jobId = Number(r.id);
  }
  const job = await getJob(jobId);
  if (!job || job.kind !== 'librarian_draft') return Response.json({ agent: true, running: false, job: null }, { status: 404, headers });
  return Response.json({ agent: true, running: job.status === 'queued' || job.status === 'running', progress: describeLibrarianJob(job), job }, { headers });
};
