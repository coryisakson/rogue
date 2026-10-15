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

export function extractHtmlSections(html: string): { title: string; sections: { heading: string; body: string }[] } {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const region = mainRegion(html.replace(/<!--[\s\S]*?-->/g, ''));
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

  const first: Section = { heading: '', parts: [] };
  const sections: Section[] = [first];
  const current = (): Section => sections[sections.length - 1] ?? first;
  let skipTag = '';
  let skipDepth = 0;
  let headingBuf: string[] | null = null;
  let headingTag = '';
  let last = 0;

  const addText = (raw: string) => {
    if (skipDepth > 0 || !raw) return;
    if (headingBuf) headingBuf.push(raw);
    else current().parts.push(raw);
  };
  const addBreak = () => { if (skipDepth === 0 && !headingBuf) current().parts.push('\n'); };

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
    if (!closing && !VOID_TAGS.has(name) && (SKIP_TAGS.has(name) || SKIP_ROLES.has(role) || hidden)) {
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
