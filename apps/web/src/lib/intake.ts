import { extractLinks, rankCandidates, pickFromSearch, rankPublisherPages, scoutQueries, slugify, isAggregator, type GameMatch } from '@rogue/core';
import { runChecks } from './add-game';
import { alertOperator } from './notify';
import { readPage, scoutRequest } from './scout';
import { searchEnabled, webSearch } from './search';
import { ensureMigrated, getPool } from './services';

const MAX_OPEN_PER_USER = 5;
const audit = (actor: string, action: string, detail: unknown) => getPool()?.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, action, detail]).catch(() => {});

async function guard(userId: number, slug: string, bggId: number | null): Promise<string | null> {
  const pool = getPool(); if (!pool) return 'The database is not available.';
  await ensureMigrated();
  if (slug && (await pool.query('SELECT 1 FROM games WHERE slug=$1', [slug])).rowCount) return 'That game is already in Rogue.';
  if (bggId && (await pool.query('SELECT 1 FROM games WHERE bgg_id=$1', [bggId])).rowCount) return 'That game is already in Rogue.';
  if (bggId && (await pool.query("SELECT 1 FROM game_requests WHERE bgg_id=$1 AND status IN ('submitted','queued','manual','checked','approved')", [bggId])).rowCount) return 'Someone already requested that game; it is in the queue.';
  const open = (await pool.query("SELECT count(*)::int n FROM game_requests WHERE user_id=$1 AND status IN ('submitted','queued','manual','checked')", [userId])).rows[0].n;
  if (open >= MAX_OPEN_PER_USER) return `You have ${MAX_OPEN_PER_USER} requests waiting already. Please wait for a decision.`;
  return null;
}

/** User picked a match from the list. Waits for an admin to approve the game (nothing is fetched yet). */
export async function submitPick(userId: number, m: GameMatch): Promise<{ id: number } | { error: string }> {
  const slug = slugify(m.title);
  const err = await guard(userId, slug, m.bggId); if (err) return { error: err };
  const r = await getPool()!.query("INSERT INTO game_requests(user_id, name, slug, year, mode, bgg_id, stage) VALUES ($1,$2,$3,$4,'pick',$5,'waiting for an admin to approve the game') RETURNING id", [userId, m.title, slug, m.year, m.bggId]);
  void alertOperator(`New game request #${r.rows[0].id}: ${m.title}${m.year ? ` (${m.year})` : ''}, picked from the list. Approve at /admin/requests.`);
  return { id: Number(r.rows[0].id) };
}

/** No match found (or search is off): the user describes the game, the admin researches it by hand. */
export async function submitDetails(userId: number, details: string): Promise<{ id: number } | { error: string }> {
  const name = details.split('\n')[0]!.slice(0, 80);
  const slug = slugify(name);
  const err = await guard(userId, '', null); if (err) return { error: err };
  const r = await getPool()!.query("INSERT INTO game_requests(user_id, name, slug, mode, details, status, stage) VALUES ($1,$2,$3,'details',$4,'manual','waiting for an admin to research the game') RETURNING id", [userId, name, slug || 'game', details]);
  void alertOperator(`New game request #${r.rows[0].id} (free text, needs manual research): ${name}. See /admin/requests.`);
  return { id: Number(r.rows[0].id) };
}

// ---- queue: one job at a time, in order. The row's status is the source of truth, so a restart can re-enqueue. ----
let chain: Promise<void> = Promise.resolve();
const queued = new Set<number>();
function enqueue(id: number) {
  if (queued.has(id)) return;
  queued.add(id);
  chain = chain.then(() => scoutJob(id)).catch(() => {}).finally(() => queued.delete(id));
}
/** Admin approves the game itself (name level). It joins the queue for the Scout. */
export async function approveGame(id: number, adminId: number): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'no database' };
  const r = await pool.query("UPDATE game_requests SET status='queued', stage='in the queue for the Scout', decided_by=$2 WHERE id=$1 AND status='submitted' AND mode='pick' RETURNING id", [id, adminId]);
  if (!r.rowCount) return { ok: false, error: 'Request is not waiting for game approval.' };
  await audit(`admin:${adminId}`, 'game_request_game_approved', { id });
  enqueue(id);
  return { ok: true };
}
/** Re-enqueue jobs left 'queued' by a restart. Safe to call often. */
export async function resumeQueue(): Promise<void> {
  const rows = (await getPool()?.query("SELECT id FROM game_requests WHERE status='queued' ORDER BY id"))?.rows ?? [];
  for (const r of rows) enqueue(Number(r.id));
}

const stage = (id: number, text: string) => getPool()?.query('UPDATE game_requests SET stage=$2 WHERE id=$1', [id, text.slice(0, 300)]).catch(() => {});
const toManual = async (id: number, why: string) => {
  await getPool()?.query("UPDATE game_requests SET status='manual', stage=$2 WHERE id=$1", [id, why.slice(0, 300)]);
  await audit('scout', 'game_request_needs_manual', { id, why });
  await alertOperator(`Game request #${id} needs manual research: ${why}`);
};

/** Read one publisher page; if it has no rulebook PDF, follow its best same-host rules/downloads/support link once. */
async function findRulebookOnSite(pageUrl: string, gameName: string): Promise<{ pdf: string; page: string } | null> {
  const p = await readPage(pageUrl);
  if ('note' in p) return null;
  const ranked = rankCandidates(extractLinks(p.html, p.finalUrl), gameName);
  const pdf = ranked.find((c) => c.role === 'rulebook' && c.isPdf);
  if (pdf) return { pdf: pdf.url, page: p.finalUrl };
  const host = new URL(p.finalUrl).host;
  const next = ranked.find((c) => c.role === 'rulebook' && !c.isPdf && new URL(c.url).host === host && c.url !== p.finalUrl);
  if (!next) return null;
  const q = await readPage(next.url);
  if ('note' in q) return null;
  const pdf2 = rankCandidates(extractLinks(q.html, q.finalUrl), gameName).find((c) => c.role === 'rulebook' && c.isPdf);
  return pdf2 ? { pdf: pdf2.url, page: q.finalUrl } : null;
}

/** Scout job: search, choose a rulebook, then hand over to the Rights Officer (runChecks) and the terms scan. */
async function scoutJob(id: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  const r = (await pool.query("SELECT name, year FROM game_requests WHERE id=$1 AND status='queued'", [id])).rows[0];
  if (!r) return;
  try {
    if (!searchEnabled()) return await toManual(id, 'web search is not configured (ROGUE_SEARCH_BASE_URL)');
    await stage(id, 'searching the web');
    let hits = [] as Awaited<ReturnType<typeof webSearch>>;
    for (const q of scoutQueries(r.name, r.year)) hits = hits.concat(await webSearch(q, 15));
    // 1. Publisher first: read the most likely publisher pages and follow rules/downloads links one level.
    let rulebookUrl: string | null = null;
    let foundOn: string | null = null;
    for (const page of rankPublisherPages(hits, r.name)) {
      await stage(id, `reading ${new URL(page).host}`);
      const found = await findRulebookOnSite(page, r.name);
      if (found) { rulebookUrl = found.pdf; foundOn = found.page; break; }
    }
    // 2. Fallback: a rulebook PDF straight from the search results (non-aggregator host).
    if (!rulebookUrl) rulebookUrl = pickFromSearch(hits, r.name).rulebook?.url ?? null;
    if (!rulebookUrl) return await toManual(id, 'the Scout found no publisher rulebook in the search results');
    if (isAggregator(new URL(rulebookUrl).hostname)) return await toManual(id, 'only third-party copies were found');
    const host = new URL(rulebookUrl).hostname.replace(/^www\./, '');
    await pool.query("UPDATE game_requests SET rulebook_url=$2, found_on=$3, publisher=COALESCE(publisher,$4), status='submitted', stage='rights checks running' WHERE id=$1", [id, rulebookUrl, foundOn, host]);
    await audit('scout', 'game_request_scouted_source', { id, rulebookUrl, foundOn, queries: scoutQueries(r.name, r.year) });
    await runChecks(id);      // Rights Officer (code): robots, TDM, opt-out; status -> checked
    if (foundOn) await scoutRequest(id); // terms-of-use flags for the human
    await stage(id, 'waiting for an admin to read the terms and approve the source');
  } catch (e) {
    await toManual(id, `Scout error: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

/** Admin finished researching by hand: fill in the details and send through the normal rights checks. */
export async function completeManual(id: number, adminId: number, v: { name: string; publisher: string; rulebookUrl: string; foundOn: string | null }): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool(); if (!pool) return { ok: false, error: 'no database' };
  try {
    const r = await pool.query("UPDATE game_requests SET name=$2, slug=$3, publisher=$4, rulebook_url=$5, found_on=$6, status='submitted', stage='rights checks running' WHERE id=$1 AND status='manual' RETURNING id", [id, v.name, slugify(v.name), v.publisher, v.rulebookUrl, v.foundOn]);
    if (!r.rowCount) return { ok: false, error: 'Request is not waiting for manual research.' };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, error: 'That rulebook link is already requested.' };
    throw e;
  }
  await audit(`admin:${adminId}`, 'game_request_manual_source', { id, url: v.rulebookUrl });
  await runChecks(id);
  if (v.foundOn) await scoutRequest(id);
  return { ok: true };
}
