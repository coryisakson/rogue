/**
 * Authority ranking: when several sources of one game compete, an official correction beats a clarification,
 * a clarification beats the rulebook, and a product page (box contents, player count) ranks below the rules.
 * Used as a multiplier on retrieval scores, so it breaks ties and lifts official text without hiding anything.
 */
export type DocKind = 'errata' | 'faq' | 'rulebook' | 'quickstart' | 'article' | 'forum_post' | 'other';
const KIND_WEIGHT: Record<string, number> = { errata: 1.3, faq: 1.2, rulebook: 1.1, quickstart: 1.0, article: 0.9, forum_post: 0.8, other: 0.85 };
/** sources.authority column: publisher > author/official > community > forum. */
const AUTHORITY_WEIGHT: Record<string, number> = { publisher: 1.0, author: 1.0, official: 0.97, community: 0.85, forum: 0.75, other: 0.8 };

export function sourceWeight(kind: string | null | undefined, authority: string | null | undefined): number {
  return (KIND_WEIGHT[kind ?? 'other'] ?? 0.85) * (AUTHORITY_WEIGHT[authority ?? 'other'] ?? 0.8);
}
