import type { APIRoute } from 'astro';
import { sameOrigin } from '@rogue/core';
import { isAdmin } from '../../../lib/admin';
import { agentsEnabled, enqueueGameJob, getJob } from '../../../lib/agent-jobs';
import { getGame } from '../../../lib/kb';

/**
 * POST /api/admin/faq-curate?game=pandemic queues a `faq_curate` agent job (the FAQ Curator merges duplicate player questions
 * into canonical answers). Answers {mode:'agent', jobId}, or {mode:'off'} when the agents sidecar is off: the public FAQ then
 * keeps showing the plain rating tally. GET ?job=<id> returns that job's progress.
 * The middleware already requires the admin token for /api/admin/*. A browser call must also be same-origin, and a signed-in
 * user who is not an admin gets 404.
 */
export const POST: APIRoute = async ({ url, request, locals }) => {
  const h = request.headers;
  if (locals.user && !isAdmin(locals.user)) return new Response('Not found', { status: 404 });
  if ((h.has('origin') || h.has('referer')) && !sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  const game = url.searchParams.get('game') ?? '';
  if (!/^[a-z0-9-]+$/.test(game)) return Response.json({ error: 'use ?game=<slug>' }, { status: 400 });
  if (!(await getGame(game))) return Response.json({ error: 'unknown game' }, { status: 404 });
  if (!agentsEnabled()) return Response.json({ mode: 'off' });
  const jobId = await enqueueGameJob('faq_curate', game);
  if (jobId === null) return Response.json({ error: 'database not available' }, { status: 503 });
  return Response.json({ mode: 'agent', jobId });
};

export const GET: APIRoute = async ({ url }) => {
  const headers = { 'cache-control': 'no-store' };
  const jobId = Number(url.searchParams.get('job') ?? '');
  if (!Number.isInteger(jobId) || jobId < 1) return Response.json({ error: 'use ?job=<id>' }, { status: 400, headers });
  const job = await getJob(jobId);
  if (!job || job.kind !== 'faq_curate') return Response.json({ running: false, job: null }, { status: 404, headers });
  return Response.json({ running: job.status === 'queued' || job.status === 'running', job }, { headers });
};
