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
/** At most this many flagged sentences are kept. When the cap is hit, later bot/AI sentences may be unseen. */
export const MAX_TERMS_FLAGS = 12;

/**
 * Decide what the terms text allows.
 *  - restricted: a bot/AI/TDM sentence also contains prohibiting words. A human decides; recommendation is reject.
 *  - clear: enough real text was read and nothing in it mentions bots, scraping, AI, mining or copying limits.
 *  - unclear: too little text, or mentions without a clear prohibition (a human reads the highlighted lines).
 * Only 'clear' lets the admin skip reading the terms. It is deliberately strict.
 */
export function judgeTerms(text: string): TermsJudgement {
  const clean = text.replace(/\s+/g, ' ').trim();
  const flags = flagTerms(clean, MAX_TERMS_FLAGS);
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

// ---- Terms Agent judgement (Nanobot agent, ADR 0002) ----------------------------------------------------------------
// judgeTerms is strict on purpose: a sentence that mentions bots or AI without a prohibition word is 'unclear', and a human
// used to read it. The terms agent now reads those sentences first. It only labels each one; the verdict is still made here.

/** One bot/AI sentence the agent must label, numbered from 1, with the text around it (lists often put "you may not" above). */
export interface TermsSentence { n: number; kind: 'bot' | 'ai'; text: string; context: string }
export type SentenceMeaning = 'forbids' | 'allows' | 'unrelated' | 'unsure';
export interface SentenceAnswer { n: number; meaning: SentenceMeaning; why: string }
export const SENTENCE_MEANINGS: readonly SentenceMeaning[] = ['forbids', 'allows', 'unrelated', 'unsure'];

const CONTEXT_BEFORE = 500;
const CONTEXT_AFTER = 200;

/**
 * Sentences worth giving to the agent. Empty unless the code verdict is 'unclear' because of bot/AI mentions in enough real
 * text: a 'clear' or 'restricted' verdict needs no help, and too little text cannot be judged by anyone.
 */
export function sentencesToJudge(text: string, j: TermsJudgement): TermsSentence[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (j.verdict !== 'unclear' || clean.length < MIN_TERMS_CHARS) return [];
  const out: TermsSentence[] = [];
  for (const f of j.flags) {
    if (f.kind !== 'bot' && f.kind !== 'ai') continue;
    const at = clean.indexOf(f.excerpt.replace(/\.\.\.$/, '').slice(0, 200));
    const context = at < 0 ? f.excerpt : clean.slice(Math.max(0, at - CONTEXT_BEFORE), at + f.excerpt.length + CONTEXT_AFTER);
    out.push({ n: out.length + 1, kind: f.kind, text: f.excerpt, context });
  }
  return out;
}

/** Check the agent's answers. Returns the clean answers plus plain-language problems (unknown numbers, missing reasons). */
export function screenSentenceAnswers(sentences: TermsSentence[], raw: unknown): { answers: SentenceAnswer[]; problems: string[] } {
  const problems: string[] = [];
  const byN = new Map<number, SentenceAnswer>();
  for (const a of Array.isArray(raw) ? raw : []) {
    const r = (a ?? {}) as Record<string, unknown>;
    const n = Number(r['n']);
    const meaning = String(r['meaning'] ?? '') as SentenceMeaning;
    const why = typeof r['why'] === 'string' ? r['why'].trim().slice(0, 400) : '';
    if (!sentences.some((s) => s.n === n)) { problems.push(`There is no sentence ${String(r['n'])}.`); continue; }
    if (!SENTENCE_MEANINGS.includes(meaning)) { problems.push(`Sentence ${n}: meaning must be one of ${SENTENCE_MEANINGS.join(', ')}.`); continue; }
    // A reason is required for anything that could clear the site; without one the answer counts as unsure.
    if (meaning !== 'unsure' && why.length < 10) { problems.push(`Sentence ${n}: give a short reason (why).`); byN.set(n, { n, meaning: 'unsure', why }); continue; }
    byN.set(n, { n, meaning, why });
  }
  const missing = sentences.filter((s) => !byN.has(s.n)).map((s) => s.n);
  if (missing.length) problems.push(`No answer for sentence(s) ${missing.join(', ')}.`);
  return { answers: [...byN.values()].sort((a, b) => a.n - b.n), problems };
}

/**
 * The verdict after the agent labelled the sentences. Code decides, never the model:
 *  - any sentence the agent says forbids bots, scraping or AI -> restricted (a human decides; recommendation is reject);
 *  - every sentence answered allows/unrelated with a reason, and the flag cap was not hit -> clear;
 *  - anything else (unsure, missing, agent asked for a human) -> unclear, a human reads the lines.
 * Only an 'unclear' code verdict can change; 'clear' and 'restricted' are returned as they were.
 */
export function decideTermsWithAgent(code: TermsJudgement, sentences: TermsSentence[], answers: SentenceAnswer[], agentWantsHuman = false): TermsJudgement {
  if (code.verdict !== 'unclear' || sentences.length === 0) return code;
  const line = (a: SentenceAnswer) => `Sentence ${a.n} (${sentences.find((s) => s.n === a.n)?.kind ?? '?'}): ${a.meaning}. ${a.why}`.trim();
  const forbids = answers.filter((a) => a.meaning === 'forbids');
  if (forbids.length) return { ...code, verdict: 'restricted', reasons: [`The terms agent found ${forbids.length} sentence(s) that forbid bots, scraping or AI.`, ...forbids.map(line)] };
  const allOk = sentences.every((s) => answers.some((a) => a.n === s.n && (a.meaning === 'allows' || a.meaning === 'unrelated')));
  if (allOk && !agentWantsHuman && code.flags.length < MAX_TERMS_FLAGS) {
    return { ...code, verdict: 'clear', reasons: [`The terms agent read all ${sentences.length} bot/AI sentence(s); none forbids our use.`, ...answers.map(line)] };
  }
  const why = agentWantsHuman ? 'The terms agent asked for a human.'
    : code.flags.length >= MAX_TERMS_FLAGS ? 'Too many flagged sentences to clear automatically; a human reads them.'
    : 'The terms agent was unsure about some sentences; a human reads them.';
  return { ...code, reasons: [...code.reasons, why, ...answers.map(line)] };
}
