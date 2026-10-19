import {
  FetchDenied, FetchHttpError, addCrawlLinks, authorityLabel, extractWikiLinks, isAuthorityAttested, isCrawlPlan, isJunkWikiUrl, isWikiIndexUrl, isWikiStopStatus, looksLikeBotWall,
  nextCrawlItem, planCrawl, sourceProbeGate, termsGate, wikiEditionLabel, wikiExtractedSource, wikiProgressText,
  type CrawlPlan, type WikiAuthority, type WikiCrawlCounts, type WikiImportInput,
} from '@rogue/core';
import { probeRulebook, type RightsReport } from './add-game';
import { syncApprovedHosts } from './dynamic-sources';
import { gatedFetch, ingestSeed, type IngestOptions, type IngestSeed } from './ingest';
import { indexSource } from './rules-index';
import { ensureMigrated, getPool, storage } from './services';
import { ALLOWED_HOSTS } from './source-seeds';

/**
 * Wiki import (docs/WIKI_IMPORT.md, ADR 0006): a game whose rules live in a wiki (BookStack, MediaWiki, any site with
 * linked pages). Same gates as "Add rules link" (game-sources.ts addGameSource): the admin confirms the site's terms for a
 * new host, the Rights Officer probes the start URL, and only then is the host approved. Every page is then fetched by the
 * rights-gated fetcher (robots, 2 s per host, size cap, RogueBot UA) and stored as its own source: document kind 'wiki',
 * authority 'community' (ranks below publisher text, AGENTS.md 2b) unless the admin attested that the wiki is the publisher's
 * official documentation (authority 'publisher', wiki_crawls.authority), rights_status link_only, title = wiki breadcrumb.
 * The crawl runs in the background, one per game, and stores its plan after every page so it resumes after a restart.
 * A 403, 429 or captcha page stops it: Rogue never tries to get past a bot wall.
 */

const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

export interface WikiCrawlRow {
  id: number; startUrl: string; mode: 'pages' | 'site'; status: 'running' | 'done' | 'stopped' | 'failed'; progress: string | null;
  counts: Partial<WikiCrawlCounts>; createdAt: string; updatedAt: string;
  authority: WikiAuthority; authorityLabel: string;
}
export interface DiscoveredPage { url: string; index: boolean }

type Gate = { ok: true; report: RightsReport } | { ok: false; error: string; report?: RightsReport };

/** Crawls running in this process (a 'running' row without an entry here was interrupted by a restart and is resumed). */
const g = globalThis as Record<string, unknown>;
const active = (g['__rogueWikiCrawls'] ??= new Set<number>()) as Set<number>;

/** The add-source gates for a wiki start URL: game exists, not tombstoned, terms confirmed for a new host, Rights Officer probe. */
async function wikiGates(slug: string, startUrl: string, termsChecked: boolean, adminId: number | null): Promise<Gate> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
  await ensureMigrated();
  if (!(await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return { ok: false, error: 'Unknown game.' };
  if ((await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [startUrl])).rowCount) return { ok: false, error: 'That link was taken down (tombstoned); it cannot be imported.' };
  // Gate 1: terms. A host already approved by a human skips the checkbox (same rule as addGameSource).
  await syncApprovedHosts();
  const termsError = termsGate(new URL(startUrl).host, ALLOWED_HOSTS, termsChecked);
  if (termsError) return { ok: false, error: termsError };
  // Gate 2: Rights Officer probe of the start URL (robots, TDM reservation, opt-out headers, reachability), headers only.
  const report = await probeRulebook(startUrl);
  await audit('rights-officer', 'wiki_source_checked', { slug, url: startUrl, verdict: report.verdict, policyVersion: report.policyVersion });
  const probeError = sourceProbeGate(report.verdict, report.host, startUrl);
  if (probeError) return { ok: false, error: probeError, report };
  await pool.query('INSERT INTO approved_hosts(host, approved_by) VALUES ($1,$2) ON CONFLICT (host) DO NOTHING', [report.host, adminId]);
  await syncApprovedHosts();
  return { ok: true, report };
}

const decodeHtml = (bytes: Uint8Array) => new TextDecoder('utf-8').decode(bytes);

/** Why a fetched wiki page must stop the crawl (bot wall), or null. */
function botWall(html: string): string | null {
  return looksLikeBotWall(html) ? 'bot wall: the site answered with a captcha or challenge page' : null;
}

/**
 * "Discover pages" (dry run): fetch the start page once through the gates and list the in-scope page links on it, so the
 * admin can untick pages before importing. Nothing is stored. Listing pages (books, chapters, categories) are marked.
 */
export async function discoverWikiPages(slug: string, v: WikiImportInput, adminId: number, termsChecked: boolean): Promise<{ ok: true; pages: DiscoveredPage[]; report: RightsReport } | { ok: false; error: string; report?: RightsReport }> {
  const gate = await wikiGates(slug, v.startUrl, termsChecked, adminId);
  if (!gate.ok) return gate;
  let html: string; let finalUrl: string;
  try {
    const doc = await gatedFetch(v.startUrl);
    if (!/html/i.test(doc.contentType)) return { ok: false, error: `The start URL is not a web page (${doc.contentType}).`, report: gate.report };
    html = decodeHtml(doc.bytes); finalUrl = doc.finalUrl;
  } catch (e) {
    return { ok: false, error: fetchError(e), report: gate.report };
  }
  const wall = botWall(html);
  if (wall) { await audit(`admin:${adminId}`, 'wiki_discover_stopped', { slug, url: v.startUrl, reason: wall }); return { ok: false, error: `${wall}. Rogue does not get past bot walls; use Capture from browser instead.`, report: gate.report }; }
  const links = [v.startUrl, ...extractWikiLinks(html, finalUrl, v.startUrl)].filter((u, i, a) => a.indexOf(u) === i).slice(0, v.maxPages);
  await audit(`admin:${adminId}`, 'wiki_discover', { slug, startUrl: v.startUrl, found: links.length });
  return { ok: true, pages: links.map((url) => ({ url, index: isWikiIndexUrl(url) })), report: gate.report };
}

function fetchError(e: unknown): string {
  if (e instanceof FetchHttpError) return isWikiStopStatus(e.status) ? `The wiki refused Rogue (HTTP ${e.status}); Rogue does not retry around that.` : `The wiki answered HTTP ${e.status}.`;
  if (e instanceof FetchDenied) return e.decision.reason;
  return e instanceof Error ? e.message : 'fetch failed';
}

/**
 * Start a wiki import in the background (mode 'site': crawl from the start URL inside its host and path prefix; mode
 * 'pages': exactly the listed pages). One crawl per game at a time.
 */
export async function crawlWiki(o: { gameSlug: string; input: WikiImportInput; adminId: number | null; termsChecked: boolean; requestId?: number | null }): Promise<{ ok: true; id: number; report: RightsReport } | { ok: false; error: string; report?: RightsReport }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'The database is not available.' };
  await ensureMigrated();
  const { gameSlug: slug, input: v } = o;
  if ((await pool.query("SELECT 1 FROM wiki_crawls WHERE game_slug=$1 AND status='running'", [slug])).rowCount) return { ok: false, error: 'A wiki import is already running for this game; wait for it or stop it first.' };
  const actor = o.adminId === null ? 'game-request' : `admin:${o.adminId}`;
  const gate = await wikiGates(slug, v.startUrl, o.termsChecked, o.adminId);
  if (!gate.ok) return gate;
  const plan = planCrawl({ startUrl: v.startUrl, mode: v.mode, urls: v.urls, maxPages: v.maxPages });
  let id: number;
  try {
    id = Number((await pool.query(
      `INSERT INTO wiki_crawls(game_slug, start_url, mode, publisher, language, force, plan, counts, progress, request_id, started_by, authority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11) RETURNING id`,
      [slug, v.startUrl, v.mode, v.publisher, v.language, v.force, plan, emptyCounts(), o.requestId ?? null, o.adminId, v.authority])).rows[0].id);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, error: 'A wiki import is already running for this game.' };
    throw e;
  }
  await audit(actor, 'wiki_crawl_started', { slug, crawlId: id, startUrl: v.startUrl, mode: v.mode, pages: v.urls.length || null, maxPages: plan.maxPages, host: gate.report.host, verdict: gate.report.verdict, termsChecked: o.termsChecked,
    // 'publisher' only when the admin ticked "This wiki is the publisher's official documentation" (their attestation).
    authority: v.authority, attested: isAuthorityAttested(v.authority, true) });
  void runCrawl(id);
  return { ok: true, id, report: gate.report };
}

const emptyCounts = (): WikiCrawlCounts => ({ ingested: 0, skipped: 0, failed: 0, tombstoned: 0, discovered: 0 });

/** Latest wiki import of a game, for the sources page. Resumes it when it was interrupted by a restart. */
export async function wikiCrawlStatus(slug: string): Promise<WikiCrawlRow | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `SELECT id, start_url, mode, status, progress, counts, authority, to_char(created_at,'YYYY-MM-DD HH24:MI') created, to_char(updated_at,'YYYY-MM-DD HH24:MI') updated
     FROM wiki_crawls WHERE game_slug=$1 ORDER BY id DESC LIMIT 1`, [slug])).rows[0];
  if (!r) return null;
  if (r.status === 'running' && !active.has(Number(r.id))) void runCrawl(Number(r.id));
  return { id: Number(r.id), startUrl: r.start_url, mode: r.mode, status: r.status, progress: r.progress, counts: r.counts ?? {}, createdAt: r.created, updatedAt: r.updated,
    authority: r.authority, authorityLabel: authorityLabel(r.authority, true) };
}

/** Wait for one import to end (wiki-only game requests run the Librarian after it), reporting its progress. */
export async function waitForWikiCrawl(id: number, onProgress: (text: string) => unknown): Promise<WikiCrawlRow | null> {
  const pool = getPool(); if (!pool) return null;
  for (let last = '';;) {
    const r = (await pool.query('SELECT game_slug, status, progress FROM wiki_crawls WHERE id=$1', [id])).rows[0];
    if (!r) return null;
    if (r.status !== 'running') return (await wikiCrawlStatus(r.game_slug));
    if (r.progress && r.progress !== last) { last = r.progress; await onProgress(last); }
    await new Promise((res) => setTimeout(res, 5_000));
  }
}

/** Stop the running import of a game (it ends after the page it is on). */
export async function stopWikiCrawl(slug: string, adminId: number): Promise<boolean> {
  const r = await getPool()?.query("UPDATE wiki_crawls SET status='stopped', progress=COALESCE(progress,'') || ' (stopped by an admin)', updated_at=now() WHERE game_slug=$1 AND status='running' RETURNING id", [slug]);
  if (!r?.rowCount) return false;
  await audit(`admin:${adminId}`, 'wiki_crawl_stopped', { slug, crawlId: Number(r.rows[0].id), reason: 'admin' });
  return true;
}

/** Resume every interrupted import (after a restart; the sources page also resumes its own game's import). */
export async function resumeWikiCrawls(): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  const rows = (await pool.query("SELECT id FROM wiki_crawls WHERE status='running' ORDER BY id")).rows;
  for (const r of rows) if (!active.has(Number(r.id))) void runCrawl(Number(r.id));
}

/** Once per server process (middleware): pick up imports a restart interrupted. */
export function startWikiCrawlResume(): void {
  if (g['__rogueWikiResume']) return;
  g['__rogueWikiResume'] = true;
  setTimeout(() => void resumeWikiCrawls().catch(() => {}), 15_000);
}

/**
 * The ingest options for one wiki page: wiki text cleanup with breadcrumb title, the crawl's authority (community unless the
 * admin attested publisher), bytes kept for links.
 */
const wikiIngest = (authority: WikiAuthority): IngestOptions => ({
  authority,
  keepBody: true,
  extract: (bytes, contentType, finalUrl) => {
    if (!/html/i.test(contentType)) throw new Error(`not a wiki page (${contentType})`);
    const html = decodeHtml(bytes);
    const wall = botWall(html);
    if (wall) throw new Error(wall);
    // A private page redirects to the login form: never store that as rules text.
    if (isJunkWikiUrl(finalUrl)) throw new Error(`redirected to ${new URL(finalUrl).pathname} (login or wiki tool page)`);
    return wikiExtractedSource(html, finalUrl);
  },
});

function wikiSeed(slug: string, url: string, row: { publisher: string; language: string; start_url: string }): IngestSeed {
  const host = new URL(url).host;
  // Placeholder until the page is read: the extraction replaces it with the breadcrumb title.
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? host;
  let name = last; try { name = decodeURIComponent(last); } catch { /* keep it encoded */ }
  return { gameSlug: slug, url, title: name.replace(/[-_]+/g, ' '),
    publisher: row.publisher, language: row.language, kind: 'wiki', editionLabel: wikiEditionLabel(host), foundOn: row.start_url };
}

/** Re-fetch one wiki page (Re-ingest now on the sources page): same wiki options and stored authority, forced, then re-index. */
export async function reingestWikiPage(slug: string, sourceId: number): Promise<{ ok: boolean; detail: string; chunks?: number }> {
  const pool = getPool(); if (!pool) return { ok: false, detail: 'The database is not available.' };
  const s = (await pool.query(
    `SELECT s.url, s.publisher, s.language, s.authority, e.label FROM sources s JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id
     JOIN games g ON g.id=e.game_id WHERE s.id=$1 AND g.slug=$2 AND d.kind='wiki' LIMIT 1`, [sourceId, slug])).rows[0];
  if (!s) return { ok: false, detail: 'Not a wiki page of this game.' };
  const res = await ingestSeed(wikiSeed(slug, s.url, { publisher: s.publisher ?? '', language: s.language ?? 'en', start_url: s.url }), true, wikiIngest(s.authority === 'publisher' ? 'publisher' : 'community'));
  if (!res.ok || !res.sourceId) return { ok: false, detail: res.detail };
  const idx = await indexSource(res.sourceId);
  return { ok: true, detail: 'done', chunks: idx.chunks };
}

/** Is this source a wiki page? (Re-ingest picks the wiki path for it.) */
export async function isWikiSource(sourceId: number): Promise<boolean> {
  return !!(await getPool()?.query("SELECT 1 FROM documents WHERE source_id=$1 AND kind='wiki'", [sourceId]))?.rowCount;
}

/** The page loop. Saves plan, counts and progress after every page; checks for an admin stop between pages. */
async function runCrawl(id: number): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  const pool = getPool();
  const imported: string[] = [];
  let final: { status: 'done' | 'stopped' | 'failed'; reason?: string; url?: string } = { status: 'done' };
  try {
    if (!pool) return;
    const row = (await pool.query("SELECT game_slug, start_url, mode, publisher, language, force, plan, counts, authority FROM wiki_crawls WHERE id=$1 AND status='running'", [id])).rows[0];
    if (!row) return;
    if (!isCrawlPlan(row.plan)) { final = { status: 'failed', reason: 'stored crawl plan is unreadable' }; return; }
    const plan: CrawlPlan = row.plan;
    const ingestOpts = wikiIngest(row.authority === 'publisher' ? 'publisher' : 'community');
    const counts: WikiCrawlCounts = { ...emptyCounts(), ...(row.counts ?? {}) };
    const save = async (progress: string) => {
      const r = await pool.query("UPDATE wiki_crawls SET plan=$2, counts=$3, progress=$4, updated_at=now() WHERE id=$1 AND status='running' RETURNING id", [id, plan, counts, progress.slice(0, 300)]);
      return !!r.rowCount; // false: an admin stopped it
    };
    for (let item = nextCrawlItem(plan); item; item = nextCrawlItem(plan)) {
      const { url, depth } = item;
      if ((await pool.query('SELECT 1 FROM tombstones WHERE url=$1', [url])).rowCount) { counts.tombstoned++; }
      else if (row.mode === 'site' && isWikiIndexUrl(url)) {
        // Listing page: read for its links only, nothing stored.
        try {
          const doc = await gatedFetch(url);
          const html = /html/i.test(doc.contentType) ? decodeHtml(doc.bytes) : '';
          const wall = botWall(html);
          if (wall) { final = { status: 'stopped', reason: wall, url }; break; }
          counts.discovered += addCrawlLinks(plan, extractWikiLinks(html, doc.finalUrl, plan.startUrl), depth);
        } catch (e) {
          if (e instanceof FetchHttpError && isWikiStopStatus(e.status)) { final = { status: 'stopped', reason: `HTTP ${e.status}`, url }; break; }
          counts.failed++;
        }
      } else {
        const res = await ingestSeed(wikiSeed(row.game_slug, url, row), !!row.force, ingestOpts);
        if (isWikiStopStatus(res.httpStatus) || res.detail.startsWith('bot wall')) { final = { status: 'stopped', reason: res.httpStatus ? `HTTP ${res.httpStatus}` : res.detail, url }; break; }
        if (res.tombstoned) counts.tombstoned++;
        else if (!res.ok || !res.sourceId) counts.failed++;
        else {
          let html = res.body ? decodeHtml(res.body) : '';
          if (res.skipped) {
            counts.skipped++;
            // Unchanged in the last 24h: read its links from the private copy instead of fetching again.
            if (row.mode === 'site') html = await privateCopy(res.sourceId);
          } else {
            await pool.query('UPDATE wiki_crawls SET progress=$2 WHERE id=$1', [id, `indexing ${url}`.slice(0, 300)]);
            await indexSource(res.sourceId);
            counts.ingested++;
            imported.push(url);
          }
          if (html) counts.discovered += addCrawlLinks(plan, extractWikiLinks(html, res.finalUrl ?? url, plan.startUrl), depth);
        }
      }
      if (!(await save(wikiProgressText(counts, plan.visited, plan.maxPages, plan.queue.length)))) return; // stopped by an admin
    }
    const text = final.status === 'stopped'
      ? `stopped at ${final.url}: ${final.reason}. Rogue does not get past refusals or bot walls. ${wikiProgressText(counts, plan.visited, plan.maxPages, plan.queue.length)}`
      : `done: ${wikiProgressText(counts, plan.visited, plan.maxPages, plan.queue.length)}`;
    await pool.query("UPDATE wiki_crawls SET status=$2, plan=$3, counts=$4, progress=$5, updated_at=now() WHERE id=$1 AND status='running'", [id, final.status, plan, counts, text.slice(0, 300)]);
    await audit('wiki-crawl', 'wiki_crawl_finished', { slug: row.game_slug, crawlId: id, status: final.status, reason: final.reason ?? null, stoppedAt: final.url ?? null, counts, urls: imported.slice(0, 500) });
  } catch (e) {
    final = { status: 'failed', reason: e instanceof Error ? e.message : 'unknown' };
  } finally {
    if (final.status === 'failed') {
      await pool?.query("UPDATE wiki_crawls SET status='failed', progress=$2, updated_at=now() WHERE id=$1 AND status='running'", [id, `error: ${final.reason}`.slice(0, 300)]).catch(() => {});
      await audit('wiki-crawl', 'wiki_crawl_finished', { crawlId: id, status: 'failed', reason: final.reason ?? null, urls: imported.slice(0, 500) });
    }
    active.delete(id);
  }
}

async function privateCopy(sourceId: number): Promise<string> {
  const p = (await getPool()?.query('SELECT private_path FROM sources WHERE id=$1', [sourceId]))?.rows[0]?.private_path as string | undefined;
  const bytes = p ? await storage.get(p).catch(() => null) : null;
  return bytes ? decodeHtml(bytes) : '';
}
