export interface EvalQuestion { q: string; must: string }
export interface EvalRow { q: string; rank: number | null }
export interface EvalSummary { n: number; hitAt1: number; hitAt3: number; hitAt5: number; mrr: number }

/** 1-based rank of the first snippet that matches the required text, or null. */
export function firstRank(snippets: string[], must: string): number | null {
  const re = new RegExp(must, 'i');
  const i = snippets.findIndex((s) => re.test(s));
  return i < 0 ? null : i + 1;
}

export function summarize(rows: EvalRow[]): EvalSummary {
  const n = rows.length || 1;
  const at = (k: number) => rows.filter((r) => r.rank !== null && r.rank <= k).length / n;
  return { n: rows.length, hitAt1: at(1), hitAt3: at(3), hitAt5: at(5), mrr: rows.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / n };
}

/** Parse a model's ranking reply ("[3,1,2]" possibly wrapped in prose/fences) into valid, de-duplicated indexes. */
export function parseRanking(text: string, count: number): number[] {
  const m = text.match(/\[[\d,\s]*\]/);
  const raw: unknown = m ? JSON.parse(m[0]) : [];
  const seen = new Set<number>();
  for (const v of raw as number[]) if (Number.isInteger(v) && v >= 1 && v <= count) seen.add(v);
  return [...seen];
}

/** Put the model's ranked picks first, then everything it did not mention in original order. */
export function applyRanking<T>(items: T[], picks: number[]): T[] {
  const first = picks.map((p) => items[p - 1]).filter((x): x is T => x !== undefined);
  const rest = items.filter((_, i) => !picks.includes(i + 1));
  return [...first, ...rest];
}

/** One answer-level eval question (see packages/core/eval/ask-*.json). */
export interface AskEvalQuestion { q: string; must: string; mustNot?: string; expected?: string; kind?: string }
export interface AskEvalResult { pass: boolean; reasons: string[] }

/** Score one Ask answer: must match `must`, not `mustNot`, carry a citation, and have no citation warning. */
export function scoreAskAnswer(item: AskEvalQuestion, a: { answer: string; sources: unknown[]; warning?: string }): AskEvalResult {
  const reasons: string[] = [];
  if (!new RegExp(item.must, 'i').test(a.answer)) reasons.push('answer does not match the expected pattern');
  if (item.mustNot && new RegExp(item.mustNot, 'i').test(a.answer)) reasons.push('answer matches a forbidden pattern');
  if (!/\((?:p|s)\.\s*\d+/i.test(a.answer) && !a.sources.length) reasons.push('no citation');
  if (a.warning) reasons.push('citation warning');
  return { pass: reasons.length === 0, reasons };
}
