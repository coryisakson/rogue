/**
 * FAQ Curator, pure gates (ADR 0002). The Nanobot FAQ Curator (job kind faq_curate, one game) reads the game's well-rated
 * player questions and PROPOSES one short canonical answer for each group of duplicates. Code decides here: it may only merge
 * this game's listed questions (never ones an admin hid), cite only pages those answers already cited, and use only numbers
 * those answers already contain. So the agent can reword and merge, but cannot invent a claim, a source or a count.
 */

export const FAQ_CANONICAL_MAX_ANSWER = 600;
export const FAQ_CANONICAL_MAX_QUESTION = 200;

export interface FaqCitation { page: number; url: string }

/** One player question as the code lists it for the agent (from the rating tally in apps/web/src/lib/faq.ts). */
export interface FaqCandidate {
  question_norm: string;
  question: string;
  answer: string;
  sources: (FaqCitation & { section?: string | null; title?: string })[] | null;
  up: number;
  total: number;
  /** faq_state status; 'hidden' means an admin removed it and it is never merged. */
  status: string | null;
}

export interface CanonicalProposal { question: string; answer: string; source_qnorms: string[]; citations: FaqCitation[] }

export type CanonicalDecision =
  | { ok: true; question: string; answer: string; source_qnorms: string[]; citations: (FaqCitation & { section?: string | null; title?: string })[] }
  | { ok: false; reason: string };

/** Numbers as written ("2", "1.5", "10"), with thousands separators and trailing zeros left as-is so "1,000" stays one token. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]$/, ''));
}

const sameCitation = (a: FaqCitation, b: FaqCitation) => Number(a.page) === Number(b.page) && String(a.url).trim() === String(b.url).trim();

/**
 * Accept or reject one proposed canonical entry.
 * `candidates` are this game's listed questions; `alreadyMerged` are question keys an earlier accepted entry of the same job used.
 */
export function judgeCanonical(p: CanonicalProposal, candidates: readonly FaqCandidate[], alreadyMerged: ReadonlySet<string> = new Set()): CanonicalDecision {
  const question = String(p.question ?? '').trim();
  const answer = String(p.answer ?? '').trim();
  if (!question) return { ok: false, reason: 'The question is empty.' };
  if (question.length > FAQ_CANONICAL_MAX_QUESTION) return { ok: false, reason: `The question is longer than ${FAQ_CANONICAL_MAX_QUESTION} characters.` };
  if (!answer) return { ok: false, reason: 'The answer is empty.' };
  if (answer.length > FAQ_CANONICAL_MAX_ANSWER) return { ok: false, reason: `The answer is longer than ${FAQ_CANONICAL_MAX_ANSWER} characters; make it shorter.` };

  const qnorms = [...new Set((Array.isArray(p.source_qnorms) ? p.source_qnorms : []).map((q) => String(q).trim()).filter(Boolean))];
  if (qnorms.length === 0) return { ok: false, reason: 'Name at least one question_norm from list_faq_candidates.' };
  const byNorm = new Map(candidates.map((c) => [c.question_norm, c]));
  const merged: FaqCandidate[] = [];
  for (const q of qnorms) {
    const c = byNorm.get(q);
    if (!c) return { ok: false, reason: `"${q}" is not one of this game's candidate questions.` };
    if (c.status === 'hidden') return { ok: false, reason: `"${q}" was removed by an admin and cannot be merged.` };
    if (alreadyMerged.has(q)) return { ok: false, reason: `"${q}" is already part of another entry in this job.` };
    merged.push(c);
  }

  // Provenance: at least one citation, and every citation must already back one of the merged answers.
  const cites = Array.isArray(p.citations) ? p.citations : [];
  if (cites.length === 0) return { ok: false, reason: 'Give at least one citation (page and url) from the merged questions\' sources.' };
  const known = merged.flatMap((c) => c.sources ?? []);
  const citations: (FaqCitation & { section?: string | null; title?: string })[] = [];
  for (const cite of cites) {
    const hit = known.find((s) => sameCitation(s, cite));
    if (!hit) return { ok: false, reason: `Citation p.${cite?.page} ${cite?.url ?? ''} is not among the merged questions' sources.` };
    if (!citations.some((x) => sameCitation(x, hit))) citations.push({ page: Number(hit.page), url: hit.url, section: hit.section ?? null, title: hit.title ?? '' });
  }

  // No invented numbers: each number in the answer must occur in at least one merged answer.
  const allowed = new Set(merged.flatMap((c) => numbersIn(c.answer)));
  const invented = numbersIn(answer).filter((n) => !allowed.has(n));
  if (invented.length) return { ok: false, reason: `The answer uses ${invented.join(', ')}, which no merged answer says.` };

  return { ok: true, question, answer, source_qnorms: qnorms, citations };
}
