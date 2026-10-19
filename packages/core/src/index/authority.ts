/**
 * Authority ranking: when several sources of one game compete, the rulebook ranks highest (Cory 2026-10-16), then
 * clarifications from the publisher or author (errata, FAQ), then everything else (articles, community, forum).
 * Used as a multiplier on retrieval scores, so it breaks ties and lifts official text without hiding anything.
 */
export type DocKind = 'errata' | 'faq' | 'rulebook' | 'quickstart' | 'article' | 'forum_post' | 'wiki' | 'other';
const KIND_WEIGHT: Record<string, number> = { rulebook: 1.3, errata: 1.15, faq: 1.1, quickstart: 1.0, article: 0.9, forum_post: 0.7, wiki: 0.8, other: 0.85 };
// A wiki page (packages/core/src/wiki, ADR 0006) is community text split into many small pages: below a publisher's own
// product page, above a forum post. Its sources.authority is 'community', so it never outranks the publisher's rulebook.
/** sources.authority column: publisher > author/official > community > forum. */
const AUTHORITY_WEIGHT: Record<string, number> = { publisher: 1.0, author: 1.0, official: 0.97, community: 0.85, forum: 0.75, other: 0.8 };

/**
 * A manual capture (an admin pasted the page text, sources.capture_method) ranks a little below the same text fetched by
 * Rogue: nobody but the admin saw the original, so even a captured publisher page stays below the publisher's own file (2b).
 */
const CAPTURE_WEIGHT = 0.9;

export function sourceWeight(kind: string | null | undefined, authority: string | null | undefined, captureMethod: string | null | undefined = null): number {
  return (KIND_WEIGHT[kind ?? 'other'] ?? 0.85) * (AUTHORITY_WEIGHT[authority ?? 'other'] ?? 0.8) * (captureMethod ? CAPTURE_WEIGHT : 1);
}
