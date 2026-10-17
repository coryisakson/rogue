/**
 * Game sources (admin): adding a rules link to an EXISTING game, pure parts. Validation of the admin's form, the terms gate
 * decision and the seed the ingest path reads. The network calls live in apps/web/src/lib/game-sources.ts.
 * Same principle as the add-game flow: code decides the gates, a human confirms the terms, nothing is fetched before.
 */
import { hostProblem, slugify } from './index.js';

export const SOURCE_LANGUAGES = ['en', 'de', 'zh', 'es', 'it'] as const;
export const SOURCE_KINDS = ['rulebook', 'faq', 'errata', 'other'] as const;
export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceInput { url: string; title: string; publisher: string; language: SourceLanguage; kind: SourceKind; foundOn: string | null }
export type ParsedSource = { ok: true; value: SourceInput } | { ok: false; error: string };

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A public https link (same host rules as game requests), without its #fragment; or an error for the admin. */
export function parseSourceUrl(raw: unknown, label: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = text(raw, 400);
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: `${label} is not a valid web address.` }; }
  const problem = hostProblem(u);
  if (problem) return { ok: false, error: `${label}: ${problem}` };
  u.hash = '';
  return { ok: true, url: u.toString() };
}

/** Validate the "Add rules link" form. */
export function parseSourceInput(f: Record<string, unknown>): ParsedSource {
  const url = parseSourceUrl(f['url'], 'Rules link');
  if (!url.ok) return url;
  const title = text(f['title'], 120);
  if (title.length < 2) return { ok: false, error: 'Give the document a title (at least 2 characters).' };
  const publisher = text(f['publisher'], 80);
  if (publisher.length < 2) return { ok: false, error: 'Give the publisher. We only use documents from the publisher or rights holder.' };
  const language = text(f['language'] || 'en', 8).toLowerCase();
  if (!(SOURCE_LANGUAGES as readonly string[]).includes(language)) return { ok: false, error: `Language must be one of ${SOURCE_LANGUAGES.join(', ')}.` };
  const kind = text(f['kind'] || 'rulebook', 16).toLowerCase();
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `Kind must be one of ${SOURCE_KINDS.join(', ')}.` };
  let foundOn: string | null = null;
  if (text(f['foundOn'], 400)) {
    const p = parseSourceUrl(f['foundOn'], "'Found on' page");
    if (!p.ok) return p;
    foundOn = p.url;
  }
  return { ok: true, value: { url: url.url, title, publisher, language: language as SourceLanguage, kind: kind as SourceKind, foundOn } };
}

/**
 * Terms gate. A host a human already approved (approved_hosts or the built-in allowlist) skips the "I read the publisher's
 * terms" confirmation; a new host needs it. The Rights Officer probe runs for every link either way (see sourceProbeGate).
 */
export function termsGate(host: string, knownHosts: readonly string[], termsChecked: boolean): string | null {
  if (knownHosts.includes(host.toLowerCase())) return null;
  return termsChecked ? null : `${host} is not an approved host yet. Read the publisher's terms and tick the box first.`;
}

/** Rights Officer gate: same rule as approving a game request. 'blocked' never passes; 'problem' is shown but a human may go on. */
export function sourceProbeGate(verdict: 'pass' | 'problem' | 'blocked', probedHost: string, url: string): string | null {
  if (probedHost !== new URL(url).host) return 'Checks do not match the link; run them again.';
  return verdict === 'blocked' ? 'Rights checks blocked this link (robots, TDM reservation or opt-out); it cannot be added.' : null;
}

/** The shape apps/web reads as a SourceSeed (kept structural so core does not import the web app). */
export interface RuntimeSeed { gameSlug: string; url: string; title: string; publisher: string; language: string; kind: SourceKind; editionLabel: string; foundOn: string }
export interface RuntimeSourceRow { game_slug: string; url: string; title: string; publisher: string; language: string; kind: string; edition_label: string; found_on: string | null }

/** Edition label for an admin-added document, mirroring the add-game label ("<publisher> rulebook (user-submitted, ...)"). */
export function runtimeEditionLabel(publisher: string, kind: SourceKind, language: string, day: string): string {
  return `${publisher} ${kind} (${language}, admin-added ${day})`;
}

/** A runtime_sources row as a seed for allSeeds(); unknown kinds fall back to 'other'. */
export function runtimeSeed(r: RuntimeSourceRow): RuntimeSeed {
  const kind = (SOURCE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as SourceKind) : 'other';
  return { gameSlug: r.game_slug, url: r.url, title: r.title, publisher: r.publisher, language: r.language, kind, editionLabel: r.edition_label, foundOn: r.found_on ?? r.url };
}

/**
 * Admin title search: the slug of the game in Rogue that a search result points at (same BGG id, else same slug), or null.
 * A hit means "open its sources page"; a miss means "start an approved request".
 */
export function libraryMatch(m: { bggId: number; title: string }, games: readonly { slug: string; bggId: number | null }[]): string | null {
  const byId = games.find((g) => g.bggId !== null && g.bggId === m.bggId);
  if (byId) return byId.slug;
  const slug = slugify(m.title);
  return games.find((g) => g.slug === slug)?.slug ?? null;
}
