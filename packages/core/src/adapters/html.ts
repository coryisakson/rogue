import { UnsupportedSourceError, type ExtractedSource, type SourceAdapter } from './types.js';

/**
 * Dependency-free extractor for publisher HTML pages (FAQ, rules, errata).
 * Strategy: tokenise tags, drop boilerplate subtrees, keep text, start a new section at every heading.
 * Not a general HTML parser; it is deliberately small and predictable. The private copy is never served publicly.
 */

// Subtrees that never contain rules text.
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'head', 'dialog']);
const SKIP_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'search', 'dialog']);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'pre', 'dl', 'dt', 'dd', 'details', 'summary', 'figure', 'figcaption', 'br', 'hr']);
const HEADING = /^h[1-6]$/;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The class and id attribute values of a tag, matched by HtmlExtractOptions.skip. */
const classAndId = (attrs: string): string =>
  [...attrs.matchAll(/\b(?:class|id)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').join(' ');

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

/** Read charset from the Content-Type header or a <meta>; default UTF-8. */
function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
  const m = /charset=["']?([\w-]+)/i.exec(contentType) ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  try {
    return new TextDecoder(m?.[1] ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Prefer the page's own <main>, then <article>, so site chrome outside it is ignored. */
function mainRegion(html: string): string {
  for (const tag of ['main', 'article']) {
    const start = html.search(new RegExp(`<${tag}[\\s>]`, 'i'));
    const end = html.toLowerCase().lastIndexOf(`</${tag}>`);
    if (start >= 0 && end > start) return html.slice(start, end);
  }
  return html;
}

interface Section { heading: string; parts: string[] }

/** Options for callers that know the page layout (wiki import, packages/core/src/wiki). Defaults keep the publisher-page behaviour. */
export interface HtmlExtractOptions {
  /** The part of the page to read (already cut out by the caller); default: the page's <main>, else <article>, else all. */
  region?: string;
  /** Skip any element whose class or id matches (table of contents, edit links, comments). */
  skip?: RegExp;
  /** Tables as markdown rows ("| a | b |", a separator under a header row) instead of "a | b |". */
  markdownTables?: boolean;
}

export function extractHtmlSections(html: string, opts: HtmlExtractOptions = {}): { title: string; sections: { heading: string; body: string }[] } {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const region = opts.region !== undefined ? opts.region.replace(/<!--[\s\S]*?-->/g, '') : mainRegion(html.replace(/<!--[\s\S]*?-->/g, ''));
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

  const first: Section = { heading: '', parts: [] };
  const sections: Section[] = [first];
  const current = (): Section => sections[sections.length - 1] ?? first;
  let skipTag = '';
  let skipDepth = 0;
  let headingBuf: string[] | null = null;
  let headingTag = '';
  let last = 0;
  // Markdown tables: cells in the current row, whether it had header cells, and whether the table has its separator yet.
  let rowCells = 0;
  let rowHasHeader = false;
  let tableHasSeparator = false;
  let cellDepth = 0; // inside a markdown table cell, block breaks become spaces so the row stays on one line

  const addText = (raw: string) => {
    if (skipDepth > 0 || !raw) return;
    if (headingBuf) headingBuf.push(raw);
    else current().parts.push(raw);
  };
  const addBreak = () => { if (skipDepth === 0 && !headingBuf) current().parts.push(cellDepth > 0 ? ' ' : '\n'); };

  for (let m = tagRe.exec(region); m; m = tagRe.exec(region)) {
    addText(region.slice(last, m.index));
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';

    if (skipDepth > 0) {
      if (name === skipTag && !VOID_TAGS.has(name)) skipDepth += closing ? -1 : 1;
      continue;
    }
    const role = /\brole=["']?(\w+)/i.exec(attrs)?.[1]?.toLowerCase() ?? '';
    const hidden = /\saria-hidden=["']?true/i.test(attrs) || /\shidden(\s|=|$)/i.test(attrs);
    const skipByOption = !!opts.skip && opts.skip.test(classAndId(attrs));
    if (!closing && !VOID_TAGS.has(name) && (SKIP_TAGS.has(name) || SKIP_ROLES.has(role) || hidden || skipByOption)) {
      skipTag = name;
      skipDepth = 1;
      continue;
    }
    if (HEADING.test(name)) {
      if (!closing) {
        headingBuf = [];
        headingTag = name;
      } else if (headingBuf && name === headingTag) {
        sections.push({ heading: clean(headingBuf.join('')), parts: [] });
        headingBuf = null;
      }
      continue;
    }
    if (name === 'li' && !closing) { addBreak(); addText('- '); continue; }
    if (opts.markdownTables && ['table', 'tr', 'td', 'th'].includes(name)) {
      if (name === 'table') { addBreak(); if (!closing) tableHasSeparator = false; }
      else if (name === 'tr' && !closing) { addBreak(); addText('| '); rowCells = 0; rowHasHeader = false; }
      else if (name === 'tr' && rowHasHeader && !tableHasSeparator && rowCells > 0) { addBreak(); addText(`|${' --- |'.repeat(rowCells)}`); tableHasSeparator = true; }
      else if (name !== 'tr' && !closing) { cellDepth++; if (name === 'th') rowHasHeader = true; }
      else if (name !== 'tr' && closing) { cellDepth = Math.max(0, cellDepth - 1); addText(' | '); rowCells++; }
      continue;
    }
    if (name === 'td' || name === 'th') { if (closing) addText(' | '); continue; }
    if (BLOCK_TAGS.has(name)) addBreak();
  }
  addText(region.slice(last));

  const out = sections
    .map((s) => ({
      heading: s.heading,
      // Collapse whitespace per line but keep line breaks so lists stay readable.
      body: decodeEntities(s.parts.join('')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'),
    }))
    .filter((s) => s.body.length > 0);
  // Text before the first heading gets the page title as its locator.
  const lead = out[0];
  if (lead && !lead.heading) lead.heading = title || 'Introduction';
  return { title, sections: out };
}

export const htmlAdapter: SourceAdapter = {
  name: 'html',
  extension: 'html',
  canHandle: (ct) => /^(text\/html|application\/xhtml\+xml)\b/.test(ct),
  async extract(bytes, contentType): Promise<ExtractedSource> {
    if (!this.canHandle(contentType.toLowerCase())) throw new UnsupportedSourceError(`html adapter cannot read ${contentType}`);
    const html = decode(bytes, contentType);
    if (!/<[a-z][\s\S]*>/i.test(html)) throw new UnsupportedSourceError('body does not look like HTML');
    const { sections } = extractHtmlSections(html);
    if (!sections.length) throw new UnsupportedSourceError('no readable text found in HTML');
    // The heading is repeated inside the section text so quotes can be verified against it and the locator survives.
    const text = sections.map((s, i) => `\n\n=== page ${i + 1} ===\n${s.heading}\n${s.body}`).join('');
    return { text, pageCount: sections.length, locators: sections.map((s) => `section: ${s.heading}`) };
  },
};
