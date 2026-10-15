import { extractHtmlSections, extractLinks, findTermsLink, judgeTerms, registrableDomain, termsSiteCandidates, TERMS_GUESSES, type TermsJudgement } from '@rogue/core';
import { readPage } from './scout';
import { getPool } from './services';

export interface TermsCheck extends TermsJudgement {
  checkedAt: string;
  site: string | null;      // the publisher site whose terms were read
  termsUrl: string | null;
  tried: string[];          // plain-language log of every page looked at, for the admin when a human is needed
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
      const cand = done({ ...j, site: site.origin, termsUrl: t.finalUrl });
      if (j.verdict !== 'unclear' || !best || t.text.length > 1200) { best = cand; }
      if (j.verdict !== 'unclear' || t.text.length >= 1200) return { ...best, tried }; // real text read: decide on it
    }
  }
  return best ? { ...best, tried } : done({ verdict: 'unclear', flags: [], reasons: ['No terms-of-use page could be found or read on the publisher site.'], site: null, termsUrl: null });
}

/** Run the agent for one request and store the result. */
export async function termsAgentForRequest(id: number): Promise<TermsCheck | null> {
  const pool = getPool(); if (!pool) return null;
  const r = (await pool.query('SELECT rulebook_url, found_on FROM game_requests WHERE id=$1', [id])).rows[0];
  if (!r?.rulebook_url) return null;
  const check = await runTermsAgent(r.rulebook_url, r.found_on ?? null);
  await pool.query('UPDATE game_requests SET terms_check=$2 WHERE id=$1', [id, check]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['terms-agent', 'game_request_terms_checked', { id, site: check.site, termsUrl: check.termsUrl, verdict: check.verdict, flags: check.flags.length }]);
  return check;
}
