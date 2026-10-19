import { decodeEntities, extractHtmlSections } from '../adapters/html.js';
import { UnsupportedSourceError, type ExtractedSource } from '../adapters/types.js';
import { detectWiki, type WikiKind } from './detect.js';

/**
 * Wiki page text: only the article body, without the wiki's navigation, sidebars, footers, table of contents, edit links
 * and comments. Headings, lists and tables survive (tables as markdown). The title carries the wiki breadcrumb
 * ("Book > Chapter > Page") so a citation names where in the wiki the text came from.
 * Reuses the publisher-page extractor (adapters/html.ts) with a region and a skip list; no second HTML parser.
 */

/** Elements inside the article body that are not rules text (by class or id). */
const WIKI_SKIP = /\b(toc|toctitle|mw-editsection|mw-jump-link|mw-indicators|catlinks|printfooter|navbox|noprint|mw-references-wrap|reference|comments?|comment-box|comments-container|page-nav|sidebar|tri-layout-left|tri-layout-right|breadcrumbs|entity-meta|edit-link|editsection|pagination|tag-box|action-buttons|page-revisions)\b/i;

/** The opening tag with an attribute matching `attr`, and everything up to its balanced closing tag; null when absent. */
export function elementByAttr(html: string, attr: RegExp): string | null {
  const open = /<([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!attr.test(m[2] ?? '')) continue;
    const tag = (m[1] ?? '').toLowerCase();
    const tagRe = new RegExp(`<(/?)${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      depth += t[1] === '/' ? -1 : 1;
      if (depth === 0) return html.slice(m.index, t.index + t[0].length);
    }
    return html.slice(m.index); // unclosed: take the rest of the page
  }
  return null;
}

/** The article body of a wiki page for its software; falls back to <main>/<article> (generic) and then the whole page. */
export function wikiContentRegion(html: string, kind: WikiKind): string {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const candidates: RegExp[] = kind === 'bookstack' ? [/\bclass=["'][^"']*\bpage-content\b/i, /\bid=["']main-content["']/i]
    : kind === 'mediawiki' ? [/\bid=["']mw-content-text["']/i, /\bid=["']bodyContent["']/i, /\bid=["']content["']/i]
    : [];
  for (const c of candidates) { const r = elementByAttr(noComments, c); if (r) return r; }
  for (const tag of ['main', 'article']) {
    const r = elementByAttr(noComments.replace(new RegExp(`<${tag}(\\s|>)`, 'i'), `<${tag} data-wiki-region="1"$1`), /data-wiki-region="1"/);
    if (r) return r;
  }
  return noComments;
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Breadcrumb trail (without the page itself): BookStack book > chapter; MediaWiki subpage parents; else none. */
export function wikiBreadcrumb(html: string, kind: WikiKind, url: string): string[] {
  if (kind === 'bookstack') {
    const nav = elementByAttr(html, /\bclass=["'][^"']*\bbreadcrumbs\b/i) ?? '';
    const crumbs = [...nav.matchAll(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      // Only books and chapters: shelves and the "Books" listing are navigation, the page itself is the title.
      .filter((m) => /\/books\/[^/]+(\/chapter\/[^/]+)?\/?$/.test(m[1] ?? ''))
      .map((m) => clean(m[2] ?? '')).filter(Boolean);
    return crumbs.filter((c, i) => crumbs.indexOf(c) === i);
  }
  if (kind === 'mediawiki') {
    const path = (() => { try { return decodeURIComponent(new URL(url).pathname); } catch { return ''; } })();
    const article = /\/wiki\/(.+)$/.exec(path)?.[1];
    if (!article) return [];
    const parts = article.split('/').map((p) => p.replace(/_/g, ' '));
    return parts.slice(0, -1);
  }
  return [];
}

/** The page's own title: BookStack page h1, MediaWiki firstHeading, else <h1>, else <title> without the site suffix. */
export function wikiPageTitle(html: string, kind: WikiKind): string {
  const region = kind === 'mediawiki' ? (elementByAttr(html, /\bid=["']firstHeading["']/i) ?? '') : '';
  const h1 = region || (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(wikiContentRegion(html, kind))?.[1] ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const t = clean(h1);
  if (t) return t;
  // "<page> | <book> | <site>" (BookStack) or "<page> - <site>" (MediaWiki): the first part is the page.
  return clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').split(/\s+[|–—-]\s+/)[0] ?? '';
}

export interface WikiPage { kind: WikiKind; title: string; sections: { heading: string; body: string }[] }

/** Clean text of one wiki page, with the breadcrumb title ("Book > Chapter > Page"). */
export function extractWikiPage(html: string, url: string): WikiPage {
  const kind = detectWiki(html, url);
  const fullTitle = wikiPageTitle(html, kind);
  const trail = wikiBreadcrumb(html, kind, url).filter((c) => c !== fullTitle);
  // A MediaWiki subpage heading repeats its parents ("Setup/Two players"); the breadcrumb already names them.
  const page = kind === 'mediawiki' && trail.length ? (fullTitle.split('/').pop() ?? fullTitle).trim() : fullTitle;
  const title = [...trail, page].filter(Boolean).join(' > ').slice(0, 300);
  const { title: htmlTitle, sections } = extractHtmlSections(html, { region: wikiContentRegion(html, kind), skip: WIKI_SKIP, markdownTables: true });
  // Text before the first heading is labelled with the <title> ("Page - Site"); the page name is the better locator.
  const lead = sections[0];
  if (lead && page && (lead.heading === htmlTitle || lead.heading === 'Introduction')) lead.heading = page;
  return { kind, title, sections };
}

/**
 * A wiki page as an ingest result: same "=== page N ===" section format as the HTML adapter (each heading block is one
 * citable section), plus the breadcrumb title for the source row.
 */
export function wikiExtractedSource(html: string, url: string): ExtractedSource & { title: string; wikiKind: WikiKind } {
  const p = extractWikiPage(html, url);
  if (!p.sections.length) throw new UnsupportedSourceError('no readable text found on the wiki page');
  const text = p.sections.map((s, i) => `\n\n=== page ${i + 1} ===\n${s.heading}\n${s.body}`).join('');
  return { text, pageCount: p.sections.length, locators: p.sections.map((s) => `section: ${s.heading}`), title: p.title, wikiKind: p.kind, notes: { wikiKind: p.kind } };
}

/**
 * A bot wall or challenge page instead of the wiki page (captcha, Cloudflare/DDoS-Guard check). The crawl stops and
 * reports; it never tries to get past one (AGENTS.md rule 2b).
 */
export function looksLikeBotWall(html: string): boolean {
  const head = html.slice(0, 50_000);
  return /\b(g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api|cf-challenge|cf_chl_|challenge-platform|turnstile|ddos-guard|px-captcha|captcha-delivery)\b/i.test(head)
    || /<title>[^<]*(just a moment|attention required|access denied|are you a robot|verify you are human)[^<]*<\/title>/i.test(head);
}
