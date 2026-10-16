/**
 * A small, safe markdown renderer for reviewing extracted page text (MinerU output: headings, lists, pipe tables).
 * Safety model: every piece of input text is HTML-escaped before any markup is added, and only the tags built here
 * are ever emitted. Links are not rendered as anchors at all, so `javascript:` URLs cannot become clickable.
 */

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Bold, italic and inline code on one already-split line. Escapes first, so markers only wrap escaped text. */
export function renderInline(text: string): string {
  const codes: string[] = [];
  // Pull code spans out first so their contents are not treated as bold/italic.
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([^_]+?)_(?![_\w])/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Split "| a | b |" into trimmed cells; "\|" stays a literal pipe inside a cell. */
function cells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderTable(rows: string[]): string {
  const hasHeader = rows.length > 1 && TABLE_RULE.test(rows[1] ?? '');
  const head = hasHeader ? `<thead><tr>${cells(rows[0] ?? '').map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>` : '';
  const body = (hasHeader ? rows.slice(2) : rows).filter((r) => !TABLE_RULE.test(r));
  return `<table>${head}<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const startsParagraphBreak = (line: string) => !line.trim() || HEADING.test(line) || TABLE_ROW.test(line) || BULLET.test(line) || NUMBERED.test(line);

/** Render markdown to HTML. Blocks: headings, bullet/numbered lists, pipe tables, paragraphs (single newlines become <br>). */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const at = (j: number): string => lines[j] ?? '';
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (!line.trim()) { i++; continue; }
    const h = HEADING.exec(line);
    if (h) { const lvl = (h[1] ?? '#').length; out.push(`<h${lvl}>${renderInline(h[2] ?? '')}</h${lvl}>`); i++; continue; }
    if (TABLE_ROW.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW.test(at(i))) rows.push(at(i++));
      out.push(renderTable(rows));
      continue;
    }
    const list = BULLET.test(line) ? { re: BULLET, tag: 'ul' } : NUMBERED.test(line) ? { re: NUMBERED, tag: 'ol' } : null;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.re.test(at(i))) items.push(`<li>${renderInline(list.re.exec(at(i++))?.[1] ?? '')}</li>`);
      out.push(`<${list.tag}>${items.join('')}</${list.tag}>`);
      continue;
    }
    // Paragraph: runs until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && !startsParagraphBreak(at(i))) para.push(renderInline(at(i++).trim()));
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('\n');
}
