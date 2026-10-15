/**
 * Curator decision for one needs_review claim (docs/CURATION_POLICY.md). Pure function so the rules are testable.
 *  - quote still on the cited source AND the checking model says SUPPORTED -> restore (published again)
 *  - quote gone or claim NOT_SUPPORTED, and an independent (frontier) judge confirms -> reject, with stored evidence
 *  - anything else (no judge available, judge unsure, errors) -> keep in needs_review for the human exception queue
 * Why restore needs no frontier model: restoring only re-asserts what the source quote proves; rejecting removes knowledge, so it needs a second opinion.
 */
export type CuratorVerdict = 'restore' | 'reject' | 'keep';

export interface CuratorInput {
  quoteFound: boolean;
  /** local/first-pass model verdict on claim vs quote; null when it could not run */
  supported: boolean | null;
  /** independent judge ran and confirms the claim is wrong/unsupported; null when no judge is configured or it failed */
  judgeConfirmsWrong: boolean | null;
}

export function curatorDecision(i: CuratorInput): CuratorVerdict {
  if (i.quoteFound && i.supported === true) return 'restore';
  const looksWrong = !i.quoteFound || i.supported === false;
  if (looksWrong && i.judgeConfirmsWrong === true) return 'reject';
  return 'keep';
}
