/**
 * Source authority an admin chooses (task wiki-publisher, Cory 2026-10-19). Some games are published ONLY as a wiki, so an
 * admin may attest that a wiki is the publisher's official documentation. The choice is stored per source
 * (runtime_sources.authority, wiki_crawls.authority, migration 0043), written to sources.authority by ingest, audited, and
 * weighted in ranking (packages/core/src/index/authority.ts). Pure parsing only; the forms live in apps/web.
 */

/** Authorities an admin may pick for an added or replacing link (any URL). */
export const SOURCE_AUTHORITIES = ['publisher', 'official', 'community'] as const;
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];
/** Authorities of a wiki import: community by default, publisher only when the admin attests it. */
export const WIKI_AUTHORITIES = ['publisher', 'community'] as const;
export type WikiAuthority = (typeof WIKI_AUTHORITIES)[number];

/** Default of the generic add-source form: the publisher's own document, as before the choice existed. */
export const DEFAULT_SOURCE_AUTHORITY: SourceAuthority = 'publisher';
/** Default of a wiki import: community text (AGENTS.md 2b). */
export const DEFAULT_WIKI_AUTHORITY: WikiAuthority = 'community';

/** Form field of the wiki checkbox "This wiki is the publisher's official documentation" (value 'yes'). */
export const PUBLISHER_WIKI_FIELD = 'publisherWiki';

export type ParsedAuthority<T> = { ok: true; value: T } | { ok: false; error: string };

const clean = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** The Authority select of the add/replace form. Empty means the default (publisher); anything unknown is refused. */
export function parseSourceAuthority(raw: unknown): ParsedAuthority<SourceAuthority> {
  const s = clean(raw);
  if (!s) return { ok: true, value: DEFAULT_SOURCE_AUTHORITY };
  if ((SOURCE_AUTHORITIES as readonly string[]).includes(s)) return { ok: true, value: s as SourceAuthority };
  return { ok: false, error: `Authority must be one of ${SOURCE_AUTHORITIES.join(', ')}.` };
}

/**
 * A wiki import's authority: from the checkbox (field publisherWiki = 'yes'), or from an explicit `authority` value
 * (internal callers, the hidden field of "Import selected pages"). Only 'publisher' and 'community'; empty means community.
 */
export function parseWikiAuthority(f: Record<string, unknown>): ParsedAuthority<WikiAuthority> {
  if (clean(f[PUBLISHER_WIKI_FIELD]) === 'yes') return { ok: true, value: 'publisher' };
  const s = clean(f['authority']);
  if (!s) return { ok: true, value: DEFAULT_WIKI_AUTHORITY };
  if ((WIKI_AUTHORITIES as readonly string[]).includes(s)) return { ok: true, value: s as WikiAuthority };
  return { ok: false, error: `A wiki's authority must be one of ${WIKI_AUTHORITIES.join(', ')}.` };
}

/** Did the admin attest something the default would not have said? (Audited with the authority.) */
export function isAuthorityAttested(authority: string, isWiki: boolean): boolean {
  return isWiki ? authority === 'publisher' : authority !== DEFAULT_SOURCE_AUTHORITY;
}

/** Badge / list wording: "Publisher wiki" vs "Community wiki" for wikis, else the authority with a capital. */
export function authorityLabel(authority: string | null | undefined, isWiki: boolean): string {
  const a = authority || (isWiki ? DEFAULT_WIKI_AUTHORITY : 'other');
  const word = a.charAt(0).toUpperCase() + a.slice(1);
  if (!isWiki) return word;
  return a === 'publisher' ? 'Publisher wiki' : 'Community wiki';
}
