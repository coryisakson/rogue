import { inWikiScope, isJunkWikiUrl, normaliseWikiUrl } from './links.js';

/**
 * Crawl plan for a wiki import: a breadth-first queue with a page cap and a depth cap, scoped to the start URL's host and
 * path prefix, deduplicated, in a deterministic order (start pages first, then links in the order the wiki lists them).
 * The plan is plain JSON so the web app can store it after every page and resume after a restart.
 */
export const WIKI_DEFAULT_MAX_PAGES = 150;
export const WIKI_HARD_MAX_PAGES = 500;
export const WIKI_DEFAULT_MAX_DEPTH = 4;

export interface CrawlItem { url: string; depth: number }
export interface CrawlPlan {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  /** Pages still to visit, in order. */
  queue: CrawlItem[];
  /** Every URL ever queued (visited or not), so nothing is queued twice. */
  seen: string[];
  /** Pages taken from the queue so far (counts against maxPages). */
  visited: number;
}

/** A page cap the admin asked for, clamped to 1..500; anything unreadable becomes the default 150. */
export function clampMaxPages(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return WIKI_DEFAULT_MAX_PAGES;
  return Math.min(WIKI_HARD_MAX_PAGES, Math.max(1, Math.floor(n)));
}

/**
 * Start a plan. Mode 'site': the start URL at depth 0, links followed up to maxDepth. Mode 'pages': exactly the given
 * pages (maxDepth 0, no link following).
 */
export function planCrawl(o: { startUrl: string; mode: 'pages' | 'site'; urls?: string[]; maxPages?: number; maxDepth?: number }): CrawlPlan {
  const maxPages = clampMaxPages(o.maxPages);
  const maxDepth = o.mode === 'pages' ? 0 : Math.min(10, Math.max(0, Math.floor(o.maxDepth ?? WIKI_DEFAULT_MAX_DEPTH)));
  const start = normaliseWikiUrl(o.startUrl, o.startUrl) ?? o.startUrl;
  const plan: CrawlPlan = { startUrl: start, maxPages, maxDepth, queue: [], seen: [], visited: 0 };
  const first = o.mode === 'pages' ? (o.urls ?? []) : [start];
  for (const u of first) enqueue(plan, u, 0, o.mode === 'pages');
  return plan;
}

/** Take the next page to visit, or null when the queue is empty or the page cap is reached. Mutates the plan. */
export function nextCrawlItem(plan: CrawlPlan): CrawlItem | null {
  if (plan.visited >= plan.maxPages) return null;
  const item = plan.queue.shift() ?? null;
  if (item) plan.visited++;
  return item;
}

/** Queue the links found on a page at `fromDepth` (when below maxDepth). Returns how many were new. Mutates the plan. */
export function addCrawlLinks(plan: CrawlPlan, links: readonly string[], fromDepth: number): number {
  if (fromDepth >= plan.maxDepth) return 0;
  let added = 0;
  for (const l of links) if (enqueue(plan, l, fromDepth + 1, false)) added++;
  return added;
}

/**
 * Queue one URL when it is new, in scope and not a wiki tool page. The queue never grows past what the page cap can still
 * visit, so a huge wiki does not bloat the stored plan.
 */
function enqueue(plan: CrawlPlan, raw: string, depth: number, explicit: boolean): boolean {
  const url = normaliseWikiUrl(raw, plan.startUrl);
  if (!url || plan.seen.includes(url)) return false;
  // Pages the admin listed by hand only need the same host; discovered links must stay inside the start URL's prefix.
  if (explicit ? new URL(url).host !== new URL(plan.startUrl).host : !inWikiScope(url, plan.startUrl)) return false;
  if (isJunkWikiUrl(url)) return false;
  if (plan.visited + plan.queue.length >= plan.maxPages) return false;
  plan.seen.push(url);
  plan.queue.push({ url, depth });
  return true;
}

/** Loose check that a stored JSON value is a plan (resume after restart). */
export function isCrawlPlan(v: unknown): v is CrawlPlan {
  const p = v as CrawlPlan;
  return !!p && typeof p.startUrl === 'string' && Array.isArray(p.queue) && Array.isArray(p.seen) && Number.isFinite(p.maxPages) && Number.isFinite(p.maxDepth) && Number.isFinite(p.visited);
}
