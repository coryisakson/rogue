/**
 * Wiki import (docs/WIKI_IMPORT.md, ADR 0006), pure parts: which wiki software a page comes from.
 * The kind decides where the page text lives (BookStack `.page-content`, MediaWiki `#mw-content-text`) and which URLs are junk.
 */
export type WikiKind = 'bookstack' | 'mediawiki' | 'generic';

/** Detect the wiki software from the generator meta tag, body classes and known markup or paths. */
export function detectWiki(html: string, url: string): WikiKind {
  const head = html.slice(0, 200_000);
  const generator = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)["']/i.exec(head)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']generator["']/i.exec(head)?.[1] ?? '';
  if (/mediawiki/i.test(generator)) return 'mediawiki';
  if (/bookstack/i.test(generator)) return 'bookstack';
  if (/<body[^>]+class=["'][^"']*\bmediawiki\b/i.test(head) || /\bid=["']mw-content-text["']/i.test(head)) return 'mediawiki';
  // BookStack has no generator tag: its markup (page-content, entity lists, base-url meta) and /books/<book>/page/<page> paths give it away.
  const bookstackMarkup = /\bclass=["'][^"']*\bpage-content\b/i.test(head) || /\bclass=["'][^"']*\bentity-list-item\b/i.test(head);
  const bookstackPath = /\/(books|shelves)(\/|$)/.test(safePath(url)) || /href=["'][^"']*\/books\/[^"'/]+\/(page|chapter)\//i.test(head);
  if (/<meta[^>]+name=["']base-url["']/i.test(head) && (bookstackMarkup || bookstackPath)) return 'bookstack';
  if (bookstackMarkup && bookstackPath) return 'bookstack';
  return 'generic';
}

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}
