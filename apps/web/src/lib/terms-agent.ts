import {
  decideTermsWithAgent, extractHtmlSections, extractLinks, findTermsLink, judgeTerms, registrableDomain, screenSentenceAnswers, sentencesToJudge, termsSiteCandidates, TERMS_GUESSES,
  type SentenceAnswer, type TermsJudgement, type TermsSentence,
} from '@rogue/core';
import { readPage } from './scout';
import { getPool } from './services';

export interface TermsCheck extends TermsJudgement {
  checkedAt: string;
  site: string | null;      // the publisher site whose terms were read
  termsUrl: string | null;
  tried: string[];          // plain-language log of every page looked at, for the admin when a human is needed
  toJudge?: TermsSentence[]; // bot/AI sentences of an 'unclear' page, for the Nanobot terms agent
  agent?: { jobId: number; status: string; answers: SentenceAnswer[]; judgedAt?: string }; // set once the agent job is queued / finished
}

const MAX_READS = 14; // politeness cap per request

async function termsText(url: string): Promise<{ text: string; finalUrl: string } | { note: string }> {
  const t = await readPage(url);
  if ('note' in t) return t;
  const text = extractHtmlSections(t.html).sections.map((s) => `${s.heading}. ${s.body}`).join(' ');
  return { text, finalUrl: t.finalUrl };
}

/**
 * Terms Agent: find the terms of the PUBLISHER (not of a CDN that happens to serve the file), read them and judge.
 * Order: page that linked the file -> the file's host (if it is a real site) -> main site of its domain.
 * On each site: the footer terms link, then a few well-known paths. Stops at the first readable terms page.
 * Proposes only; the caller decides whether a 'clear' verdict may skip the human.
 */
export async function runTermsAgent(rulebookUrl: string, foundOn: string | null): Promise<TermsCheck> {
  const tried: string[] = [];
  let reads = 0;
  let best: TermsCheck | null = null;
  const done = (c: Omit<TermsCheck, 'checkedAt' | 'tried'>): TermsCheck => ({ ...c, checkedAt: new Date().toISOString(), tried });

  for (const site of termsSiteCandidates(rulebookUrl, foundOn)) {
    if (reads >= MAX_READS) break;
    const domain = registrableDomain(new URL(site.origin).hostname);
    const urls: string[] = [];
    reads++;
    const home = await readPage(site.origin);
    if ('note' in home) { tried.push(`${site.origin} (${site.why}): ${home.note}`); }
    else {
      tried.push(`${site.origin} (${site.why}): read`);
      const link = findTermsLink(extractLinks(home.html, home.finalUrl));
      // A footer link may point to a group site; accept it only on the same registrable domain.
      if (link && registrableDomain(new URL(link.url).hostname) === domain) urls.push(link.url);
    }
    for (const g of TERMS_GUESSES.slice(0, 4)) urls.push(new URL(g, site.origin).toString());
    for (const u of [...new Set(urls)]) {
      if (reads >= MAX_READS) break;
      reads++;
      const t = await termsText(u);
      if ('note' in t) { tried.push(`${u}: ${t.note.replace(u, '').trim() || 'not available'}`); continue; }
      const j = judgeTerms(t.text);
      tried.push(`${u}: read ${t.text.length} characters, ${j.verdict}`);
      const toJudge = sentencesToJudge(t.text, j);
      const cand = done({ ...j, site: site.origin, termsUrl: t.finalUrl, ...(toJudge.length ? { toJudge } : {}) });
      if (j.verdict !== 'unclear' || !best || t.text.length > 1200) { best = cand; }
      if (j.verdict !== 'unclear' || t.text.length >= 1200) return { ...best, tried }; // real text read: decide on it
    }
  }
  return best ? { ...best, tried } : done({ verdict: 'unclear', flags: [], reasons: ['No terms-of-use page could be found or read on the publisher site.'], site: null, termsUrl: null });
}

/** Run the agent for one request and store the result. */
export async function termsAgentForRequest(id: number): Promise<TermsCheck | null> {
  const pool = getPool(); if (!pool) return null;
  // A wiki-only request (ADR 0006): the terms of the wiki's site are read.
  const r = (await pool.query('SELECT COALESCE(rulebook_url, wiki_url) rulebook_url, found_on FROM game_requests WHERE id=$1', [id])).rows[0];
  if (!r?.rulebook_url) return null;
  const check = await runTermsAgent(r.rulebook_url, r.found_on ?? null);
  await pool.query('UPDATE game_requests SET terms_check=$2 WHERE id=$1', [id, check]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['terms-agent', 'game_request_terms_checked', { id, site: check.site, termsUrl: check.termsUrl, verdict: check.verdict, flags: check.flags.length }]);
  return check;
}

/** Note on the request that the Nanobot terms agent has the flagged sentences (the admin page shows the reasons). */
export async function markTermsQueued(id: number, check: TermsCheck, jobId: number): Promise<void> {
  const queued: TermsCheck = { ...check, reasons: [...check.reasons, `Sent to the terms agent (job #${jobId}) to read the flagged lines.`], agent: { jobId, status: 'queued', answers: [] } };
  await getPool()?.query('UPDATE game_requests SET terms_check=$2 WHERE id=$1', [id, queued]);
}

/**
 * After the terms agent's job ended: the code gates in core turn its labels into the verdict (the model never sets it).
 * A job that failed or asked for a human leaves the request 'unclear'. Returns the stored check.
 */
export async function applyAgentJudgement(id: number, job: { id: number; status: string; result: Record<string, unknown> }): Promise<TermsCheck | null> {
  const pool = getPool(); if (!pool) return null;
  const check = (await pool.query('SELECT terms_check FROM game_requests WHERE id=$1', [id])).rows[0]?.terms_check as TermsCheck | undefined;
  if (!check?.toJudge?.length) return check ?? null;
  const { answers } = screenSentenceAnswers(check.toJudge, job.result['answers']);
  const code: TermsJudgement = { verdict: 'unclear', flags: check.flags, reasons: check.reasons };
  const d = decideTermsWithAgent(code, check.toJudge, answers, job.status !== 'done');
  const next: TermsCheck = { ...check, ...d, agent: { jobId: job.id, status: job.status, answers, judgedAt: new Date().toISOString() } };
  await pool.query('UPDATE game_requests SET terms_check=$2 WHERE id=$1', [id, next]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['agent:terms-agent', 'game_request_terms_judged', { id, job: job.id, jobStatus: job.status, verdict: d.verdict, answers: answers.map((a) => `${a.n}:${a.meaning}`) }]);
  return next;
}
