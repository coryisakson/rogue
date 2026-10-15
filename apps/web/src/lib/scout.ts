import { lookup } from 'node:dns/promises';
import {
  RightsGatedFetcher, extractLinks, findTermsLink, flagTerms, hostProblem, isPrivateAddress, rankCandidates,
  extractHtmlSections, type DocCandidate, type PageLink, type TermsFlag,
} from '@rogue/core';
import { getPool } from './services';

export interface ScoutReport {
  scoutedAt: string;
  pageUrl: string | null;
  candidates: DocCandidate[];
  termsUrl: string | null;
  termsFlags: TermsFlag[];
  notes: string[];
}

/** Public https host, no internal names, and every resolved address is public (same guard as the add-game flow). */
async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (hostProblem(u)) return null;
  try { if ((await lookup(u.hostname, { all: true })).some((a) => isPrivateAddress(a.address))) return null; } catch { return null; }
  return u;
}

/** Fetch one HTML page through the robots-gated fetcher, only for its own host. Returns text or a note. */
async function readPage(url: string): Promise<{ html: string; finalUrl: string } | { note: string }> {
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
  if (!r) return null;
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
  return report;
}
