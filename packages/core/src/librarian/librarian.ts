/** Pure helpers for the Librarian (claim drafting). No I/O here so they are easy to test. */

export const TOPICS = ['goal', 'setup', 'turn', 'actions', 'win', 'lose', 'player_count_variant', 'components', 'special_rule', 'faq'] as const;
export type Topic = (typeof TOPICS)[number];

export interface DraftClaim { topic: Topic; playerCount: number | null; body: string; quote: string }

export const norm = (s: string): string => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/** A quote is valid only if it appears verbatim (ignoring case and whitespace) on the cited page. */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const q = norm(quote);
  return q.length >= 12 && norm(pageText).includes(q);
}

/** Pull the first JSON array out of a model reply (may be wrapped in prose or code fences) and keep only well-formed claims. */
export function parseDrafts(reply: string): DraftClaim[] {
  const m = reply.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: DraftClaim[] = [];
  for (const r of raw as Record<string, unknown>[]) { const d = toDraft(r); if (typeof d !== 'string') out.push(d); }
  return out;
}

/** Check and normalise one proposed claim (from a model reply or an agent tool call). Returns the claim or why it is malformed. */
export function toDraft(r: Record<string, unknown> | null | undefined): DraftClaim | string {
  if (!r || typeof r !== 'object') return 'not an object';
  const topic = String(r['topic'] ?? '');
  const body = String(r['body'] ?? '').trim();
  const quote = String(r['quote'] ?? '').trim();
  if (!(TOPICS as readonly string[]).includes(topic)) return `topic must be one of: ${TOPICS.join(', ')}`;
  if (body.length < 15 || body.length > 600) return 'body must be 15 to 600 characters';
  if (!quote) return 'quote is missing';
  const pc = Number(r['player_count']);
  return { topic: topic as Topic, playerCount: Number.isInteger(pc) && pc >= 1 && pc <= 12 ? pc : null, body, quote };
}

/**
 * The code gates every claim passes before the verifier model sees it: the quote must be verbatim on the cited page and
 * must not already back another claim of the same edition. `known` holds lower-cased quotes already cited. Null = passes.
 */
export function screenDraft(d: DraftClaim, pageText: string, known: ReadonlySet<string>): string | null {
  if (!quoteOnPage(d.quote, pageText)) return 'quote not verbatim on the page';
  if (known.has(d.quote.toLowerCase())) return 'already covered (quote is cited by another claim)';
  return null;
}

/** Pages shorter than this are covers, credits or art and are not worth drafting from. */
export const MIN_DRAFT_PAGE_CHARS = 200;

/** Verifier reply must start with SUPPORTED; anything else (including garbage) counts as not supported. */
export function parseVerdict(reply: string): boolean {
  return /^\W*supported\b/i.test(reply.trim()) && !/^\W*not[ _-]?supported/i.test(reply.trim());
}

export const DRAFT_SYSTEM = `You extract rules from ONE page of a board game rulebook into small factual claims.
Rules: write each claim in your own words (do not copy sentences), one fact per claim, state numbers exactly.
For every claim give a "quote": a short (under 25 words) passage copied EXACTLY, character for character, from the page that proves the claim.
Allowed topics: ${TOPICS.join(', ')}. Use player_count only when the fact applies to exactly that many players, else null.
Skip examples, flavour text, credits and anything you are unsure of. Reply with ONLY a JSON array, no prose:
[{"topic":"setup","player_count":null,"body":"...","quote":"..."}]. If the page has no rules, reply [].`;

export const VERIFY_SYSTEM = `You check a claim about a board game against a quote from its rulebook.
Reply with exactly one word: SUPPORTED if the quote clearly states or directly implies every detail of the claim (numbers included), otherwise NOT_SUPPORTED.`;
