/**
 * Admin capture from the browser (Cory 2026-10-18, feasibility experiment). Some rules pages sit behind a bot wall Rogue
 * must not bypass. An admin opens the page in their own browser and pastes (or sends with the bookmarklet) its text; Rogue
 * stores it as a source marked "manual capture by <admin>". This fixes ACCESS, not PERMISSION: the admin confirms they read
 * the site's terms, the source stays link_only, tombstones still win and some hosts carry an explicit warning.
 * Pure helpers here; the database and storage work is in apps/web/src/lib/source-capture.ts.
 */
import { parseSourceUrl, SOURCE_KINDS, SOURCE_LANGUAGES, type SourceKind, type SourceLanguage } from './addgame/sources.js';
import { splitPages } from './index/chunker.js';
import { hasExtractedText } from './ocr/has-text.js';

/** sources.capture_method value for a manual capture (null = fetched by Rogue). */
export const CAPTURE_METHOD = 'manual_capture';
/** Authorities an admin may give a capture; 'community' is the default (AGENTS.md 2b: lower weight than the publisher). */
export const CAPTURE_AUTHORITIES = ['community', 'publisher', 'forum', 'other'] as const;
export type CaptureAuthority = (typeof CAPTURE_AUTHORITIES)[number];
/** Largest captured text (characters) and uploaded file (bytes). The bookmarklet caps its payload to the same text size. */
export const CAPTURE_MAX_CHARS = 2_000_000;
export const CAPTURE_MAX_FILE_BYTES = 25_000_000;
export const CAPTURE_NOTES_MAX = 500;
/** File types an admin may upload (saved from the browser), by extension. */
export const CAPTURE_FILE_TYPES = { txt: 'text/plain', md: 'text/plain', html: 'text/html', htm: 'text/html', pdf: 'application/pdf' } as const;

/**
 * Hosts whose content stays out unless Cory says otherwise. Capturing one shows a red warning and needs the host name typed.
 * officialgamerules.org: R36 (2026-10-18) decided link only; their terms forbid copying.
 */
export const CAPTURE_WARNED_HOSTS: readonly { host: string; why: string }[] = [
  { host: 'officialgamerules.org', why: "Review Log R36: this site's terms forbid copying; Cory decided link only. Capture only if Cory said so." },
];

/** The warning for a host (the host itself or a subdomain of a listed host), or null. */
export function captureHostWarning(host: string): { host: string; why: string } | null {
  const h = host.toLowerCase().replace(/^www\./, '');
  return CAPTURE_WARNED_HOSTS.find((w) => h === w.host || h.endsWith(`.${w.host}`)) ?? null;
}

/** Errors by code: the POST handler redirects back with ?capture_err=<code>, so nothing typed is reflected through the URL. */
export const CAPTURE_ERRORS = {
  game: 'Pick a game that is already in Rogue.',
  url: 'Give the page address (a public https link).',
  title: 'The title is too long (120 characters at most).',
  language: `Language must be one of ${SOURCE_LANGUAGES.join(', ')}.`,
  kind: `Kind must be one of ${SOURCE_KINDS.join(', ')}.`,
  authority: `Authority must be one of ${CAPTURE_AUTHORITIES.join(', ')}.`,
  terms: "Tick the box: you read the site's terms and understand capture does not grant permission.",
  host: 'This host is on the warning list: type its host name exactly to confirm the capture.',
  notes: `Notes are too long (${CAPTURE_NOTES_MAX} characters at most).`,
  both: 'Paste the text or upload a file, not both.',
  empty: 'No text: paste the page text or upload a file with readable text.',
  toolarge: `The text is too long (${CAPTURE_MAX_CHARS.toLocaleString('en')} characters at most) or the file too big.`,
  file: 'Unsupported file: upload a .txt, .md, .html or .pdf file saved from the browser.',
  unreadable: 'The file could not be read (no text layer or a broken file). Paste the text instead.',
  challenge: 'This looks like a bot-check page ("Just a moment", "security verification" or a captcha), not the rules. Solve the check in your browser, wait for the real page, then capture again.',
  tombstoned: 'That link was taken down (tombstoned); it cannot be captured.',
  fetched: 'That link is already a source Rogue fetched itself. Delete its extract first (Manage extracts) if the fetched text is wrong.',
  othergame: 'That link is already a source of another game.',
  queued: 'That link is waiting in the admin-added links pipeline; wait for it to finish or fail first.',
  db: 'The database is not available.',
} as const;
export type CaptureError = keyof typeof CAPTURE_ERRORS;

export interface CaptureForm {
  game: string; url: string; host: string; title: string; language: SourceLanguage; kind: SourceKind; authority: CaptureAuthority;
  notes: string | null; hostWarned: boolean;
}

const one = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max + 1);

/** Validate every field except the text itself (pasted or from a file; see checkCapturedText). */
export function parseCaptureForm(f: Record<string, unknown>): { ok: true; value: CaptureForm } | { ok: false; code: CaptureError } {
  const game = one(f['game'], 80);
  if (!/^[a-z0-9-]{1,80}$/.test(game)) return { ok: false, code: 'game' };
  const u = parseSourceUrl(f['url'], 'Page address');
  if (!u.ok) return { ok: false, code: 'url' };
  const host = new URL(u.url).host.toLowerCase();
  const titleRaw = one(f['title'], 120);
  if (titleRaw.length > 120) return { ok: false, code: 'title' };
  const language = (one(f['language'], 8) || 'en').toLowerCase();
  if (!(SOURCE_LANGUAGES as readonly string[]).includes(language)) return { ok: false, code: 'language' };
  const kind = (one(f['kind'], 16) || 'rulebook').toLowerCase();
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) return { ok: false, code: 'kind' };
  const authority = (one(f['authority'], 16) || 'community').toLowerCase();
  if (!(CAPTURE_AUTHORITIES as readonly string[]).includes(authority)) return { ok: false, code: 'authority' };
  if (f['terms'] !== 'yes') return { ok: false, code: 'terms' };
  const warned = captureHostWarning(host);
  const typed = one(f['hostConfirm'], 200).toLowerCase();
  if (warned && typed !== host && typed !== host.replace(/^www\./, '')) return { ok: false, code: 'host' };
  const notes = (typeof f['notes'] === 'string' ? f['notes'] : '').trim();
  if (notes.length > CAPTURE_NOTES_MAX) return { ok: false, code: 'notes' };
  return {
    ok: true,
    value: {
      game, url: u.url, host, title: titleRaw || host, language: language as SourceLanguage, kind: kind as SourceKind,
      authority: authority as CaptureAuthority, notes: notes || null, hostWarned: !!warned,
    },
  };
}

/** The file type of an uploaded capture by its extension, or null when not allowed. */
export function captureFileType(name: string): (typeof CAPTURE_FILE_TYPES)[keyof typeof CAPTURE_FILE_TYPES] | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  return (CAPTURE_FILE_TYPES as Record<string, (typeof CAPTURE_FILE_TYPES)[keyof typeof CAPTURE_FILE_TYPES]>)[ext] ?? null;
}

// Phrases bot walls (Cloudflare, Akamai, DataDome and friends) show instead of the page. Strong phrases count anywhere near
// the top; the bare word "captcha" counts only on a short page, because real pages often say "protected by reCAPTCHA".
const CHALLENGE_STRONG = [/just a moment\.{0,3}/i, /performing security verification/i, /checking (if the site connection is secure|your browser)/i, /verify(ing)? (that )?you are (a )?human/i, /enable javascript and cookies to continue/i, /attention required!? \| cloudflare/i];
const CHALLENGE_SHORT_PAGE = 3000;

/** The bot-check phrase found in a captured text, or null when it looks like a real page. */
export function botChallengePhrase(text: string): string | null {
  const body = text.replace(/=== page \d+ ===/g, '').trim();
  const head = body.slice(0, 2000);
  for (const re of CHALLENGE_STRONG) { const m = re.exec(head); if (m) return m[0]; }
  if (body.length < CHALLENGE_SHORT_PAGE) { const m = /\b\w*captcha\b/i.exec(body); if (m) return m[0]; }
  return null;
}

/** Refusal code for a captured text (empty, too long, a bot-check page), or null when it may be stored. */
export function checkCapturedText(text: string): CaptureError | null {
  if (!hasExtractedText(text.replace(/\f/g, ''))) return 'empty';
  if (text.length > CAPTURE_MAX_CHARS) return 'toolarge';
  if (botChallengePhrase(text)) return 'challenge';
  return null;
}

/**
 * Captured text as the stored "=== page N ===" text the chunker reads. Pages come from form feeds (a PDF text saved from the
 * browser), else from existing "=== page N ===" markers, else the whole capture is one page. Empty pages are left out but keep
 * their numbers, so page citations match the original.
 */
export function splitCapturedText(raw: string): { text: string; pages: number } {
  const t = raw.replace(/\r\n?/g, '\n');
  let pages: Map<number, string>;
  if (t.includes('\f')) pages = new Map(t.split('\f').map((p, i) => [i + 1, p.trim()]));
  else if (/(^|\n)=== page \d+ ===\n/.test(t)) pages = splitPages(t.startsWith('=== page') ? `\n${t}` : t);
  else pages = new Map([[1, t.trim()]]);
  const kept = [...pages].filter(([, p]) => p.length > 0).sort((a, b) => a[0] - b[0]);
  return { text: kept.map(([n, p]) => `\n\n=== page ${n} ===\n${p}`).join(''), pages: kept.length ? Math.max(...kept.map(([n]) => n)) : 0 };
}

/** Edition label for a captured document, like runtimeEditionLabel but naming the capture. */
export function captureEditionLabel(host: string, kind: SourceKind, language: string, day: string): string {
  return `${host} ${kind} (${language}, manual capture ${day})`;
}

/** The provenance line shown wherever sources are listed. */
export function captureLabel(method: string | null | undefined, by: string | null | undefined, at: Date | string | null | undefined): string | null {
  if (method !== CAPTURE_METHOD) return null;
  const day = at ? (typeof at === 'string' ? at : at.toISOString()).slice(0, 10) : 'an unknown date';
  return `Manual capture by ${by || 'an unknown admin'} on ${day}`;
}

/** The bookmarklet's postMessage payload, validated in the inbox page and again by the handler (same caps). */
export interface CapturePayload { url: string; title: string; text: string; truncated: boolean }
export function parseCapturePayload(data: unknown, senderOrigin: string): CapturePayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d['type'] !== 'rogue-capture' || typeof d['url'] !== 'string' || typeof d['text'] !== 'string') return null;
  let origin: string;
  try { origin = new URL(d['url']).origin; } catch { return null; }
  // The page that sends must be the page it claims to be: a different site cannot plant text under someone else's URL.
  if (origin !== senderOrigin) return null;
  if (d['text'].length > CAPTURE_MAX_CHARS) return null;
  return { url: d['url'], title: typeof d['title'] === 'string' ? d['title'].slice(0, 120) : '', text: d['text'], truncated: d['truncated'] === true };
}

/**
 * The bookmarklet (a javascript: link the admin drags to the bookmarks bar). On the target page it takes the selection, or
 * else the page's visible text, opens /admin/capture-inbox on Rogue and, once the inbox says it is ready, hands the text over
 * with postMessage addressed to Rogue's origin only. No token inside: the admin's own session cookie signs the inbox in.
 * The inbox checks the sender (parseCapturePayload). A site's CSP or pop-up blocker can stop it; then use the paste box.
 */
export function captureBookmarklet(rogueOrigin: string): string {
  const R = JSON.stringify(new URL(rogueOrigin).origin);
  const js = `(function(){var R=${R},M=${CAPTURE_MAX_CHARS};var s=String(window.getSelection?getSelection():'');`
    + `var t=s.trim()?s:(document.body?document.body.innerText:'');var c=t.length>M;`
    + `var p={type:'rogue-capture',url:location.href,title:document.title,text:c?t.slice(0,M):t,truncated:c};`
    + `var w=window.open(R+'/admin/capture-inbox','rogue-capture','width=760,height=860');`
    + `if(!w){alert('Rogue capture: the pop-up was blocked. Allow pop-ups for this site or use the paste box.');return;}`
    + `function h(e){if(e.source===w&&e.origin===R&&e.data==='rogue-capture-ready'){w.postMessage(p,R);removeEventListener('message',h);}}`
    + `addEventListener('message',h);})();`;
  return `javascript:${encodeURIComponent(js)}`;
}
