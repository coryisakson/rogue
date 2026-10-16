import { lookup } from 'node:dns/promises';
import {
  RightsGatedFetcher, POLICY_VERSION, USER_AGENT, assessRights, findOptOut, isPrivateAddress, slugify, tdmReserved,
  type GameRequestInput, type ProbeFacts, type RightsAssessment,
} from '@rogue/core';
import { allSeeds } from './dynamic-sources';
import { ingestGame } from './ingest';
import { librarianStatus, queueLibrarianJob, runLibrarian, waitForLibrarianJob } from './librarian-run';
import { agentsEnabled, enqueueRequestJob } from './agent-jobs';
import { alertOperator } from './notify';
import { indexSource } from './rules-index';
import { applyAgentJudgement, markTermsQueued, termsAgentForRequest, type TermsCheck } from './terms-agent';
import { ensureMigrated, getPool } from './services';

const MAX_OPEN_PER_USER = 5;

export interface RightsReport extends RightsAssessment { checkedAt: string; policyVersion: string; host: string }

/** Create a request. Returns an error message for the user, or the new id. */
export async function submitRequest(userId: number, v: GameRequestInput): Promise<{ id: number } | { error: string }> {
  const pool = getPool(); if (!pool) return { error: 'The database is not available.' };
  await ensureMigrated();
  const slug = slugify(v.name);
  if ((await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return { error: 'That game is already in Rogue.' };
  const open = (await pool.query("SELECT count(*)::int n FROM game_requests WHERE user_id=$1 AND status IN ('submitted','checked')", [userId])).rows[0].n;
  if (open >= MAX_OPEN_PER_USER) return { error: `You have ${MAX_OPEN_PER_USER} requests waiting already. Please wait for a decision.` };
  try {
    const r = await pool.query(
      'INSERT INTO game_requests(user_id, name, slug, publisher, year, language, rulebook_url, found_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [userId, v.name, slug, v.publisher, v.year, v.language, v.rulebookUrl, v.foundOn]);
    const id = Number(r.rows[0].id);
    void runChecks(id); // background: the user does not wait for the network
    return { id };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { error: 'This rulebook link is already requested.' };
    throw e;
  }
}

async function fetchLimited(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(ms), headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) } }); } catch { return null; }
}

/** Rights Officer v0: robots, TDM reservation, opt-out headers, reachability. Reads headers only, never the whole file. */
export async function probeRulebook(rawUrl: string): Promise<RightsReport> {
  const u = new URL(rawUrl);
  // SSRF guard: every address the name resolves to must be public.
  let resolvedPrivate = false;
  try { resolvedPrivate = (await lookup(u.hostname, { all: true })).some((a) => isPrivateAddress(a.address)); } catch { /* unreachable is reported below */ }

  const facts: ProbeFacts = { robots: 'allowed', tdmReserved: false, optOut: null, status: null, contentType: null, contentLength: null, redirectHost: null, resolvedPrivate };
  if (!resolvedPrivate) {
    const gate = await new RightsGatedFetcher({ allowedHosts: [u.host], minDelayMs: 500 }).check(rawUrl);
    if (!gate.allowed) facts.robots = 'blocked';

    const tdm = await fetchLimited(`${u.origin}/.well-known/tdmrep.json`, {}, 8000);
    if (tdm?.ok) { try { facts.tdmReserved = tdmReserved(JSON.parse((await tdm.text()).slice(0, 100_000)), u.pathname); } catch { /* not JSON: ignore */ } }

    // HEAD without following redirects (a redirect could point at an internal host); GET of 1 byte if HEAD is refused.
    let res = await fetchLimited(rawUrl, { method: 'HEAD', redirect: 'manual' }, 10_000);
    if (res && (res.status === 405 || res.status === 501)) res = await fetchLimited(rawUrl, { method: 'GET', redirect: 'manual', headers: { range: 'bytes=0-0' } }, 10_000);
    if (res) {
      facts.status = res.status;
      const h: Record<string, string> = {}; res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
      void res.body?.cancel().catch(() => {});
      if (res.status >= 300 && res.status < 400 && h['location']) {
        try { const t = new URL(h['location'], rawUrl); if (t.host !== u.host) facts.redirectHost = t.host; else facts.status = 200; } catch { /* ignore */ }
      }
      facts.contentType = h['content-type'] ?? null;
      const len = Number(h['content-length']); facts.contentLength = Number.isFinite(len) && len > 0 ? len : null;
      facts.optOut = findOptOut(h);
    }
  }
  return { ...assessRights(facts, u.host), checkedAt: new Date().toISOString(), policyVersion: POLICY_VERSION, host: u.host };
}

/** Run (or re-run) the checks for one request and tell the operator when it is ready for a decision. */
export async function runChecks(id: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  try {
    const r = (await pool.query("SELECT * FROM game_requests WHERE id=$1 AND status IN ('submitted','checked')", [id])).rows[0];
    if (!r) return;
    const report = await probeRulebook(r.rulebook_url);
    await pool.query("UPDATE game_requests SET report=$2, status='checked' WHERE id=$1", [id, report]);
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['rights-officer', 'game_request_checked', { id, url: r.rulebook_url, verdict: report.verdict, policyVersion: report.policyVersion }]);
    // Terms Agent: reads the PUBLISHER's terms (not the CDN's). Only when rights pass and the terms are clearly fine
    // does the source approve itself (Cory 2026-10-15: admins see exceptions only). The game itself was admin-approved earlier.
    const terms = report.verdict === 'blocked' ? null : await termsAgentForRequest(id).catch(() => null);
    // Unclear because of bot/AI sentences: the Nanobot terms agent reads them first (ADR 0002); the job's end settles the request.
    if (terms?.toJudge?.length && agentsEnabled()) {
      const jobId = await enqueueRequestJob('terms_judge', id);
      if (jobId !== null) { await markTermsQueued(id, terms, jobId); return; }
    }
    await settleRequest(id, terms);
  } catch (e) {
    console.warn('[add-game] checks failed', e instanceof Error ? e.message : 'error');
  }
}

/**
 * The terms verdict is final: approve by itself when rights pass and the terms are clear, otherwise tell the operator.
 * Does nothing when an admin already decided the request in the meantime.
 */
async function settleRequest(id: number, terms: TermsCheck | null): Promise<void> {
  const r = (await getPool()?.query("SELECT name, publisher, report FROM game_requests WHERE id=$1 AND status='checked'", [id]))?.rows[0];
  if (!r) return;
  const verdict = r.report?.verdict ?? 'unknown';
  if (verdict === 'pass' && terms?.verdict === 'clear' && autoApproveEnabled()) {
    const a = await approveRequest(id, null, true, 'terms-agent');
    if (a.ok) return;
  }
  const why = terms ? `Terms Agent: ${terms.verdict}${terms.verdict === 'clear' ? '' : ' - needs you'}` : 'terms not read';
  await alertOperator(`Game request #${id}: ${r.name} (${r.publisher}). Rights check: ${verdict}. ${why}. Review at /admin/requests.`);
}

/** Called by the agent worker when a terms_judge job ended (done, needs_human or failed). */
export async function afterTermsJudged(requestId: number, job: { id: number; status: string; result: Record<string, unknown> }): Promise<void> {
  const terms = await applyAgentJudgement(requestId, job);
  await settleRequest(requestId, terms);
}

export async function rejectRequest(id: number, adminId: number, reason: string): Promise<boolean> {
  const pool = getPool(); if (!pool) return false;
  const r = await pool.query("UPDATE game_requests SET status='rejected', reject_reason=$3, decided_by=$2, decided_at=now() WHERE id=$1 AND status IN ('submitted','checked')", [id, adminId, reason.slice(0, 200)]);
  if (r.rowCount) await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [`admin:${adminId}`, 'game_request_rejected', { id, reason: reason.slice(0, 200) }]);
  return !!r.rowCount;
}

/**
 * Human approval. Allowed only when the automated verdict is not 'blocked' AND the admin confirmed they read the site's terms.
 * Creates the game, allowlists the host, then ingests + indexes + runs the Librarian in the background.
 */
/** Auto-approval by the Terms Agent can be switched off with ROGUE_AUTO_APPROVE_SOURCES=0 (kill switch). */
const autoApproveEnabled = () => process.env.ROGUE_AUTO_APPROVE_SOURCES !== '0';

export async function approveRequest(id: number, adminId: number | null, termsChecked: boolean, actor = `admin:${adminId}`): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'no database' };
  if (!termsChecked) return { ok: false, error: 'Confirm that you read the site terms first.' };
  const c = await pool.connect();
  let r;
  try {
    await c.query('BEGIN');
    r = (await c.query("SELECT * FROM game_requests WHERE id=$1 AND status='checked' FOR UPDATE", [id])).rows[0];
    if (!r) { await c.query('ROLLBACK'); return { ok: false, error: 'Request is not waiting for a decision.' }; }
    if (r.report?.verdict === 'blocked') { await c.query('ROLLBACK'); return { ok: false, error: 'Rights checks blocked this source; it cannot be approved.' }; }
    if (r.report?.host !== new URL(r.rulebook_url).host) { await c.query('ROLLBACK'); return { ok: false, error: 'Checks do not match the link; re-run them.' }; }
    await c.query('INSERT INTO games(slug, name, publisher, year, bgg_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING', [r.slug, r.name, r.publisher, r.year, r.bgg_id ?? null]);
    await c.query('INSERT INTO approved_hosts(host, request_id, approved_by) VALUES ($1,$2,$3) ON CONFLICT (host) DO NOTHING', [r.report.host, id, adminId]);
    await c.query("UPDATE game_requests SET status='approved', decided_by=$2, decided_at=now(), progress='queued' WHERE id=$1", [id, adminId]);
    await c.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'game_request_approved', { id, slug: r.slug, host: r.report.host, url: r.rulebook_url, termsChecked, termsVerdict: r.terms_check?.verdict ?? null, termsSite: r.terms_check?.site ?? null }]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  void runPipeline(id, r.slug);
  return { ok: true };
}

const setProgress = (id: number, text: string) => getPool()?.query('UPDATE game_requests SET progress=$2 WHERE id=$1', [id, text.slice(0, 300)]).catch(() => {});

/** After approval: fetch through the rights gate, index for search, then let the Librarian draft cited claims. */
export async function runPipeline(id: number, slug: string): Promise<void> {
  try {
    await setProgress(id, 'fetching rulebook');
    const results = await ingestGame(slug, true);
    const ok = results.find((x) => x.ok && x.sourceId);
    if (!ok) { await setProgress(id, `ingest failed: ${results[0]?.detail ?? 'unknown'}`); await alertOperator(`Game ${slug}: ingest failed (${results[0]?.detail}).`); return; }
    await setProgress(id, `indexing ${ok.pages ?? '?'} pages`);
    const idx = await indexSource(ok.sourceId!);
    if (agentsEnabled()) {
      // ADR 0002: the Nanobot Librarian drafts in the background; this pipeline only watches the job.
      const start = await queueLibrarianJob(slug);
      if ('error' in start) { await setProgress(id, `Librarian error: ${start.error}`); return; }
      await setProgress(id, `Librarian agent queued (${idx.chunks} chunks indexed)`);
      const j = await waitForLibrarianJob(start.jobId, (text) => setProgress(id, text));
      const published = Number(j?.result['published'] ?? 0);
      if (j?.status === 'done' || j?.status === 'needs_human') await alertOperator(`Game ${slug} is ready: ${published} cited facts published${j.status === 'needs_human' ? ' (the Librarian asked for a person; see /admin/quality)' : ''}.`);
      else if (j?.status === 'failed') await alertOperator(`Game ${slug}: Librarian job #${j.id} failed (${j.error ?? 'unknown'}).`);
      return;
    }
    for (let i = 0; i < 60 && librarianStatus()?.running; i++) { await setProgress(id, 'waiting for the Librarian (busy with another game)'); await new Promise((r) => setTimeout(r, 10_000)); }
    await setProgress(id, `Librarian drafting claims (${idx.chunks} chunks indexed)`);
    await runLibrarian(slug);
    const st = librarianStatus();
    await setProgress(id, st?.error ? `Librarian error: ${st.error}` : `done: ${st?.published ?? 0} cited facts published, ${st?.rejected.length ?? 0} rejected by the quote gates`);
    await alertOperator(`Game ${slug} is ready: ${st?.published ?? 0} cited facts published.`);
  } catch (e) {
    await setProgress(id, `error: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

export { allSeeds };
