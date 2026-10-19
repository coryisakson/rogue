import { decodeEntities } from '../adapters/html.js';

/**
 * Wiki links: which links on a wiki page are other content pages worth importing. Same host only, inside the path prefix
 * of the start URL, normalised (no #fragment, no tracking parameters), and never the wiki's own tools (login, edit,
 * history, search, user and tag pages, exports, MediaWiki namespaces like Special: or File:).
 */

/** Query parameters that never change the page content (tracking, sharing). */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|share|shared)$/i;

/** Path segments of wiki tools, accounts and listings that are not rules text. Matched per segment, case-insensitive. */
const JUNK_SEGMENTS = new Set([
  'login', 'logout', 'register', 'password', 'mfa', 'saml2', 'oidc', 'search', 'edit', 'create-page', 'draft', 'drafts', 'history', 'revisions',
  'export', 'user', 'users', 'my-account', 'settings', 'tags', 'tag', 'permissions', 'delete', 'copy', 'move', 'sort', 'attachments', 'audit',
  'favourites', 'favorites', 'notifications', 'comment', 'comments', 'references', 'templates', 'api', 'uploads', 'images', 'files',
  'feed', 'rss', 'atom', 'print', 'raw', 'theme', 'status',
]);

/** MediaWiki namespaces (title prefixes) that are not content. `Category:` pages are kept: they list rules pages. */
const JUNK_NAMESPACE = /^(special|talk|user|user_talk|file|file_talk|image|media|mediawiki|template|template_talk|help|help_talk|module|project|project_talk|[a-z_]+_talk):/i;

/** Query parameters that turn a page into a tool view (edit, history, diff, old revision, print). */
const JUNK_QUERY = /^(action|oldid|diff|curid|printable|veaction|redlink|returnto|search|term|tags?|sort|order)$/i;

/** File types that are not wiki pages. */
const NON_PAGE_EXT = /\.(pdf|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|zip|gz|mp[34]|webm|txt|csv|docx?|xlsx?)$/i;

/** Clean URL: https, no fragment, no tracking parameters, no trailing slash except the root. Null when it is not a web page link. */
export function normaliseWikiUrl(raw: string, base: string): string | null {
  let u: URL;
  try { u = new URL(decodeEntities(raw.trim()), base); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.hash = '';
  u.username = ''; u.password = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.search = u.searchParams.toString() ? `?${u.searchParams.toString()}` : '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/** True for wiki tool, account and listing URLs (login, edit, history, search, Special:, File:, ...). */
export function isJunkWikiUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (NON_PAGE_EXT.test(u.pathname)) return true;
  const segments = u.pathname.split('/').filter(Boolean).map((s) => safeDecode(s));
  if (segments.some((s) => JUNK_SEGMENTS.has(s.toLowerCase()))) return true;
  if (segments.some((s) => JUNK_NAMESPACE.test(s))) return true;
  const title = u.searchParams.get('title');
  if (title && JUNK_NAMESPACE.test(title)) return true;
  for (const k of u.searchParams.keys()) if (JUNK_QUERY.test(k)) return true;
  // MediaWiki script entry points other than a plain page view.
  if (/\/(api|load|opensearch_desc|rest)\.php$/i.test(u.pathname)) return true;
  return false;
}

/**
 * The crawl scope of a start URL: its host and a path prefix.
 * - BookStack book, chapter or page: the book ("/books/rules/page/x" -> "/books/rules/").
 * - BookStack shelf: the whole host (a shelf's books live under /books/, outside the shelf path).
 * - MediaWiki article ("/wiki/Main_Page"): the article directory ("/wiki/").
 * - A path ending in a file name ("/rules/intro.html"): its directory; any other path: itself as a directory.
 */
export function wikiScope(startUrl: string): { host: string; prefix: string } {
  const u = new URL(startUrl);
  const path = u.pathname.replace(/\/+$/, '');
  const book = /^(.*\/books\/[^/]+)(\/(page|chapter)\/.*)?$/.exec(path);
  if (book) return { host: u.host, prefix: `${book[1]}/` };
  if (/\/shelves(\/|$)/.test(path)) return { host: u.host, prefix: '/' };
  const article = /^(.*\/wiki)\/[^/]+$/.exec(path);
  if (article) return { host: u.host, prefix: `${article[1]}/` };
  if (/\/[^/]+\.[a-z0-9]{2,5}$/i.test(path)) return { host: u.host, prefix: path.replace(/[^/]+$/, '') };
  return { host: u.host, prefix: path ? `${path}/` : '/' };
}

/** Same host, and the path is the scope directory itself or inside it. The root scope "/" allows the whole host. */
export function inWikiScope(url: string, startUrl: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const scope = wikiScope(startUrl);
  if (u.host !== scope.host) return false;
  if (scope.prefix === '/') return true;
  const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
  return path.startsWith(scope.prefix);
}

/**
 * In-scope page links of a wiki page, normalised, deduplicated, in document order (the wiki's own reading order).
 * `baseUrl` resolves relative links (the page's final URL); `startUrl` sets the scope.
 */
export function extractWikiLinks(html: string, baseUrl: string, startUrl: string): string[] {
  const base = /<base[^>]+href=["']([^"']+)["']/i.exec(html)?.[1];
  const resolveFrom = base ? (normaliseWikiUrl(base, baseUrl) ?? baseUrl) : baseUrl;
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*?\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    if (!href || /^(mailto|javascript|tel|data):/i.test(href) || href.startsWith('#')) continue;
    const url = normaliseWikiUrl(href, resolveFrom);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (!inWikiScope(url, startUrl) || isJunkWikiUrl(url)) continue;
    out.push(url);
  }
  return out;
}

/**
 * A listing page (wiki root, BookStack shelves/books/chapters, MediaWiki categories): read for its links, not imported,
 * because its text is only a list of page names.
 */
export function isWikiIndexUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const path = safeDecode(u.pathname).replace(/\/+$/, '');
  if (path === '' || path === '/wiki/Main_Page') return true;
  if (/^\/(books|shelves)(\/[^/]+)?$/.test(path) || /^\/books\/[^/]+\/chapter\/[^/]+$/.test(path)) return true;
  return /\/wiki\/Category:/i.test(path) || /^Category:/i.test(u.searchParams.get('title') ?? '');
}

/**
 * Validate an admin's pasted page list (mode 'pages'): one URL per line, all on the start URL's host, no wiki tool links.
 * Returns the clean, deduplicated list or the first problem.
 */
export function parseWikiPageList(text: string, startUrl: string, maxPages: number): { ok: true; urls: string[] } | { ok: false; error: string } {
  const host = new URL(startUrl).host;
  const urls: string[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const url = normaliseWikiUrl(line, startUrl);
    if (!url || !/^https:/.test(url)) return { ok: false, error: `Not an https link: ${line.slice(0, 120)}` };
    if (new URL(url).host !== host) return { ok: false, error: `Every page must be on ${host}: ${line.slice(0, 120)}` };
    if (isJunkWikiUrl(url)) return { ok: false, error: `That is a wiki tool page, not a rules page: ${line.slice(0, 120)}` };
    if (!urls.includes(url)) urls.push(url);
  }
  if (!urls.length) return { ok: false, error: 'Paste at least one page link (one per line).' };
  if (urls.length > maxPages) return { ok: false, error: `That is ${urls.length} pages; the limit is ${maxPages}.` };
  return { ok: true, urls };
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
