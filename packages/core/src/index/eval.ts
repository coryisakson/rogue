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
