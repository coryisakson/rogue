import { lookup } from 'node:dns/promises';
import {
  RightsGatedFetcher, extractLinks, findTermsLink, flagTerms, hostProblem, isPrivateAddress, rankCandidates,
  extractHtmlSections, latestPicks, scoutJudgementNotes, type DocCandidate, type PageLink, type SourcePick, type TermsFlag,
} from '@rogue/core';
import { agentsEnabled, enqueueRequestJob } from './agent-jobs';
import { getPool } from './services';

export interface ScoutReport {
  scoutedAt: string;
  pageUrl: string | null;
  candidates: DocCandidate[];
  termsUrl: string | null;
  termsFlags: TermsFlag[];
  notes: string[];
  /** The Nanobot Scout's judgement of the candidates (scout_judge job), once it ended. Absent when agents are off. */
  agent?: { jobId: number; status: string; picks: SourcePick[] };
}

/** Public https host, no internal names, and every resolved address is public (same guard as the add-game flow). */
export async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (hostProblem(u)) return null;
  try { if ((await lookup(u.hostname, { all: true })).some((a) => isPrivateAddress(a.address))) return null; } catch { return null; }
  return u;
}

/** Fetch one HTML page through the robots-gated fetcher, only for its own host. Returns text or a note. */
export async function readPage(url: string): Promise<{ html: string; finalUrl: string } | { note: string }> {
  const u = await safeUrl(url);
  if (!u) return { note: `${url} was refused (not a public https address).` };
  try {
    const doc = await new RightsGatedFetcher({ allowedHosts: [u.host], maxBytes: 2_000_000, minDelayMs: 1000 }).fetch(url);
    if (!/html/i.test(doc.contentType)) return { note: `${url} is ${doc.contentType}, not a web page.` };
    return { html: new TextDecoder().decode(doc.bytes), finalUrl: doc.finalUrl };
  } catch (e) {
    return { note: `${url}: ${e instanceof Error ? e.message : 'failed'}` };
  }
}

/**
 * Scout v0 (playbook steps 2, 3, 4): read the publisher page the requester pointed to, list and rank the
 * documents it links, find the terms-of-use page and flag clauses a human must read. Proposes only; nothing is
 * downloaded except these two HTML pages, each gated by robots.txt and opt-out headers.
 */
export async function scoutRequest(id: number): Promise<ScoutReport | null> {
  const pool = getPool(); if (!pool) return null;
  const r = (await pool.query("SELECT name, rulebook_url, found_on FROM game_requests WHERE id=$1 AND status IN ('submitted','checked')", [id])).rows[0];
  if (!r || !r.rulebook_url) return null;
  const report: ScoutReport = { scoutedAt: new Date().toISOString(), pageUrl: r.found_on ?? null, candidates: [], termsUrl: null, termsFlags: [], notes: [] };

  let links: PageLink[] = [];
  if (!r.found_on) report.notes.push('No publisher page was given, so there is nothing to scan. Ask the requester for the page that links the rulebook.');
  else {
    const page = await readPage(r.found_on);
    if ('note' in page) report.notes.push(page.note);
    else {
      links = extractLinks(page.html, page.finalUrl);
      report.candidates = rankCandidates(links, r.name).slice(0, 25);
      if (!report.candidates.length) report.notes.push('The page links no PDF or rules/FAQ pages (it may build links with JavaScript).');
      const terms = findTermsLink(links);
      // Terms are read only from the same host as the rulebook or the publisher page; other hosts stay a human task.
      const allowed = new Set([new URL(r.found_on).host, new URL(r.rulebook_url).host]);
      if (terms) {
        report.termsUrl = terms.url;
        if (!allowed.has(new URL(terms.url).host)) report.notes.push('The terms page is on another host; read it yourself.');
        else {
          const t = await readPage(terms.url);
          if ('note' in t) report.notes.push(t.note);
          else {
            const text = extractHtmlSections(t.html).sections.map((s) => `${s.heading}. ${s.body}`).join(' ');
            report.termsFlags = flagTerms(text);
            if (!report.termsFlags.length) report.notes.push('No bot/AI/copy clauses were matched in the terms text. That is not a clearance; read the terms.');
          }
        }
      } else report.notes.push('No terms-of-use link found on the page; find it in the site footer.');
    }
  }
  const listed = report.candidates.some((c) => c.url === r.rulebook_url);
  if (links.length && !listed) report.notes.push('The requested rulebook link is not among the links on that page.');
  await pool.query('UPDATE game_requests SET scout=$2 WHERE id=$1', [id, report]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['scout', 'game_request_scouted', { id, page: r.found_on, candidates: report.candidates.length, termsFlags: report.termsFlags.length }]);
  // The code ranking above is the fallback. With agents on, the Nanobot Scout judges which candidates are THIS game's official
  // rulebook, FAQ or errata (ADR 0002). Callers do not wait (an admin form calls this): the job id goes on the report for anyone
  // polling the job row, and the worker merges the gated picks when the job ends (applyScoutJudgement).
  if (report.candidates.length && agentsEnabled()) {
    const jobId = await enqueueRequestJob('scout_judge', id);
    if (jobId !== null) {
      report.agent = { jobId, status: 'queued', picks: [] };
      await pool.query('UPDATE game_requests SET scout=$2 WHERE id=$1', [id, report]);
    }
  }
  return report;
}

/**
 * Called by the agent worker when a scout_judge job ended (done, needs_human or failed). The picks were already decided by
 * judgeSourcePick when the agent proposed them; this only writes them and plain notes into the scout report.
 */
export async function applyScoutJudgement(requestId: number, job: { id: number; status: string; result: Record<string, unknown> }): Promise<void> {
  const pool = getPool(); if (!pool) return;
  const r = (await pool.query('SELECT scout, rulebook_url FROM game_requests WHERE id=$1', [requestId])).rows[0];
  if (!r?.scout) return;
  const report = r.scout as ScoutReport;
  const picks = latestPicks(Array.isArray(job.result['picks']) ? (job.result['picks'] as SourcePick[]) : []);
  report.agent = { jobId: job.id, status: job.status, picks };
  report.notes = report.notes.filter((n) => !n.startsWith('The Scout agent') && !n.startsWith('Scout agent:')).concat(scoutJudgementNotes(picks, job.status, r.rulebook_url ?? null));
  await pool.query('UPDATE game_requests SET scout=$2 WHERE id=$1', [requestId, report]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['scout', 'game_request_scout_judged', { id: requestId, job: job.id, status: job.status, picks: picks.map((p) => `${p.role}:${p.status}`) }]);
}

/**
 * Read a candidate text version of a rulebook (HTML or plain text) through the robots-gated fetcher: public https only, 2 MB cap.
 * Returns plain text with headings kept as lines. Reading is allowed for any public host; INGESTING needs an approved host (ingest.ts).
 */
export async function readTextDoc(url: string): Promise<{ text: string; finalUrl: string; kind: 'html' | 'text'; title: string } | { note: string }> {
  const u = await safeUrl(url);
  if (!u) return { note: `${url} was refused (not a public https address).` };
  try {
    const doc = await new RightsGatedFetcher({ allowedHosts: [u.host], maxBytes: 2_000_000, minDelayMs: 1000 }).fetch(url);
    const ct = doc.contentType.toLowerCase();
    const raw = new TextDecoder().decode(doc.bytes);
    if (ct.includes('text/plain')) return { text: raw, finalUrl: doc.finalUrl, kind: 'text', title: '' };
    if (!ct.includes('html')) return { note: `${url} is ${doc.contentType}; only web pages and plain text are text versions.` };
    const ex = extractHtmlSections(raw);
    return { text: ex.sections.map((s) => `${s.heading}\n${s.body}`).join('\n\n'), finalUrl: doc.finalUrl, kind: 'html', title: ex.title };
  } catch (e) {
    return { note: `${url}: ${e instanceof Error ? e.message : 'failed'}` };
  }
}
