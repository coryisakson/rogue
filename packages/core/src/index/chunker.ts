/**
 * Split extracted rulebook text (pages marked "=== page N ===") into overlapping, page-cited chunks for retrieval.
 * Chunks never cross pages so every chunk has an exact citation. Language-agnostic: splits on whitespace and sentence-ish breaks only.
 */
export interface Chunk { page: number; ord: number; text: string }

export function splitPages(text: string): Map<number, string> {
  const parts = text.split(/\n*=== page (\d+) ===\n/);
  const pages = new Map<number, string>();
  for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), (parts[i + 1] ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  return pages;
}

export function chunkText(text: string, opts: { target?: number; overlap?: number } = {}): Chunk[] {
  const target = opts.target ?? 900;
  const overlap = opts.overlap ?? 150;
  const out: Chunk[] = [];
  let ord = 0;
  for (const [page, body] of splitPages(text)) {
    if (body.length < 20) continue;
    let start = 0;
    while (start < body.length) {
      let end = Math.min(body.length, start + target);
      if (end < body.length) {
        const window = body.slice(start + Math.floor(target * 0.6), end);
        const brk = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf('; '));
        if (brk > 0) end = start + Math.floor(target * 0.6) + brk + 1;
      }
      const piece = body.slice(start, end).trim();
      if (piece.length >= 20) out.push({ page, ord: ord++, text: piece });
      if (end >= body.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return out;
}

/** Reciprocal rank fusion of ranked id lists (best first). Used to merge keyword and vector results. */
export function rrf(lists: string[][], k = 60, weight: (id: string) => number = () => 1): string[] {
  const score = new Map<string, number>();
  for (const l of lists) l.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  for (const [id, v] of score) score.set(id, v * weight(id));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const STOP = new Set('a an the of to in on for and or is are was be do does did can i you we it that this with as at by from how what when who why which my your me if then than so not no'.split(' '));
/** Conversational question -> OR query over content words (websearch_to_tsquery is AND-only and returns nothing for questions). */
export function orQuery(q: string): string {
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)))];
  return words.join(' | ');
}


/** Heading of each "=== page N ===" block (HTML adapter writes the section heading on the first line after the marker). */
export function sectionHeadings(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of text.matchAll(/=== page (\d+) ===\n([^\n]*)/g)) out.set(Number(m[1]), (m[2] ?? "").trim());
  return out;
}
