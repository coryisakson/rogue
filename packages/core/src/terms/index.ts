/**
 * Terms Agent, pure parts. The agent has to answer one question without a human where it can:
 * "does the PUBLISHER's site forbid bots, scraping or AI use?" Two things make that hard:
 * the file often sits on a CDN (whose terms say nothing useful), and terms pages are long legal text.
 * Principle (AGENTS.md rule 2/6): code decides what is safe to clear; anything doubtful goes to a human.
 */
import { flagTerms, type TermsFlag } from '../scout/index.js';

/** Hosts that only serve files for somebody else. Their own terms are not the publisher's terms. */
const ASSET_HOST = /(^|\.)(cdn|assets?|static|media|files?|downloads?|content|img|images|cloudfront|akamaized|fastly|cloudinary|imgix|azureedge|blob\.core\.windows|storage\.googleapis|s3[.-][a-z0-9-]*\.amazonaws|amazonaws|googleusercontent|digitaloceanspaces|b-cdn|kxcdn|wp)(\.|$)/i;

export function isAssetHost(host: string): boolean {
  return ASSET_HOST.test(host.toLowerCase());
}

const TWO_PART_TLD = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'co.jp', 'com.br']);

/** "cdn.svc.asmodee.net" -> "asmodee.net". Good enough for known publisher hosts; no public-suffix list needed. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return parts.slice(TWO_PART_TLD.has(last2) ? -3 : -2).join('.');
}

/**
 * Which sites could hold the terms that govern this download, best first?
 * 1. the page that linked the file (the publisher's own page), 2. the file's host if it is a real site,
 * 3. the main site of the file's domain (a CDN's parent domain is usually the publisher).
 * Returns origins (https only); duplicates removed.
 */
export function termsSiteCandidates(rulebookUrl: string, foundOn: string | null): { origin: string; why: string }[] {
  const out: { origin: string; why: string }[] = [];
  const add = (origin: string, why: string) => { if (!out.some((o) => o.origin === origin)) out.push({ origin, why }); };
  if (foundOn) { try { const u = new URL(foundOn); add(u.origin, 'the page that links the rulebook'); } catch { /* ignore */ } }
  try {
    const u = new URL(rulebookUrl);
    if (!isAssetHost(u.hostname)) add(u.origin, 'the rulebook host');
    const root = registrableDomain(u.hostname);
    add(`https://www.${root}`, `main site of ${root}${isAssetHost(u.hostname) ? ` (${u.hostname} is a file host, not the publisher)` : ''}`);
    add(`https://${root}`, `main site of ${root}`);
  } catch { /* ignore */ }
  return out;
}

/** Common places for a terms page when the home page does not link one in a way we can find. */
export const TERMS_GUESSES = ['/terms-of-use', '/terms-and-conditions', '/terms', '/legal', '/legal-notice', '/conditions-of-use', '/terms-of-service', '/legal-information'];

export type TermsVerdict = 'clear' | 'restricted' | 'unclear';
export interface TermsJudgement { verdict: TermsVerdict; reasons: string[]; flags: TermsFlag[] }

/** A sentence that actually forbids something (versus merely mentioning "download" or "copy"). */
const PROHIBITION = /\b(prohibit\w*|forbid\w*|not (be )?(permitted|allowed)|may not|must not|shall not|cannot|can not|no (person|one|user)|you (agree )?(not to|will not)|strictly|unauthori[sz]ed|without (our |the )?(prior |express |written )?(written )?(consent|permission|authori[sz]ation))\b/i;
const MIN_TERMS_CHARS = 1200; // shorter than this is usually a JS-built page or a login wall, not the real terms

/**
 * Decide what the terms text allows.
 *  - restricted: a bot/AI/TDM sentence also contains prohibiting words. A human decides; recommendation is reject.
 *  - clear: enough real text was read and nothing in it mentions bots, scraping, AI, mining or copying limits.
 *  - unclear: too little text, or mentions without a clear prohibition (a human reads the highlighted lines).
 * Only 'clear' lets the admin skip reading the terms. It is deliberately strict.
 */
export function judgeTerms(text: string): TermsJudgement {
  const clean = text.replace(/\s+/g, ' ').trim();
  const flags = flagTerms(clean, 12);
  if (clean.length < MIN_TERMS_CHARS) return { verdict: 'unclear', flags, reasons: [`Only ${clean.length} characters of terms text could be read (the page may need JavaScript).`] };
  const serious = flags.filter((f) => (f.kind === 'bot' || f.kind === 'ai') && PROHIBITION.test(f.excerpt));
  if (serious.length) return { verdict: 'restricted', flags, reasons: [`${serious.length} sentence(s) about bots, scraping or AI also contain a prohibition.`] };
  if (flags.some((f) => f.kind === 'bot' || f.kind === 'ai')) return { verdict: 'unclear', flags, reasons: ['The terms mention bots, scraping or AI without a clear rule; a human should read the highlighted lines.'] };
  // Generic copyright wording ("do not copy or republish without permission") is on nearly every site. Cory accepted it
  // as clear for now (2026-10-15, Review Log R28): we only keep short cited quotes and never host the file.
  const generic = flags.filter((f) => f.kind === 'copy' || f.kind === 'permission');
  if (generic.length) return { verdict: 'clear', flags, reasons: [`Read ${clean.length} characters of terms; no bot, scraping or AI restriction. Passed ${generic.length} generic copyright sentence(s) (accepted risk R28).`] };
  return { verdict: 'clear', flags, reasons: [`Read ${clean.length} characters of terms; no bot, scraping, AI, mining or copying restriction was found.`] };
}
