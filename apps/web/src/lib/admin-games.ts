import { extractNote, type IngestedGame, type PageScore } from '@rogue/core';
import { gameSources, type SourceRow } from './game-sources';
import { ensureMigrated, getPool } from './services';

/**
 * Admin game hub (/admin/games, /admin/games/<slug> and its sources/extracts subpages): the SQL. Pure ordering, search,
 * timeline and quality helpers are in packages/core/src/admin-games.ts; the source list reuses gameSources().
 */

/** The game a source belongs to (first by name), for old /admin/extracts?source= links. */
export async function sourceGameSlug(sourceId: number): Promise<string | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query('SELECT g.slug FROM documents d JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE d.source_id=$1 ORDER BY g.name LIMIT 1', [sourceId])).rows[0];
  return r ? String(r.slug) : null;
}

const date = (v: unknown): Date | null => (v instanceof Date ? v : v == null ? null : new Date(String(v)));

/** Games in the games table with at least one source (what "ingested" means for admin search). */
export async function ingestedGames(): Promise<IngestedGame[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const rows = (await pool.query(
    `SELECT g.slug, g.name, g.created_at, max(s.fetched_at) last_fetched,
       (SELECT max(r.decided_at) FROM game_requests r WHERE r.slug=g.slug) last_decided
     FROM games g JOIN editions e ON e.game_id=g.id JOIN documents d ON d.edition_id=e.id JOIN sources s ON s.id=d.source_id
     GROUP BY g.id ORDER BY g.name`)).rows;
  return rows.map((r) => ({ slug: r.slug, name: r.name, createdAt: date(r.created_at), lastFetchedAt: date(r.last_fetched), lastDecidedAt: date(r.last_decided) }));
}

export interface HubGame { slug: string; name: string; publisher: string | null; year: number | null; bggId: number | null; createdAt: Date | null }

export async function hubGame(slug: string): Promise<HubGame | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query('SELECT slug, name, publisher, year, bgg_id, created_at FROM games WHERE slug=$1', [slug])).rows[0];
  return r ? { slug: r.slug, name: r.name, publisher: r.publisher, year: r.year, bggId: r.bgg_id == null ? null : Number(r.bgg_id), createdAt: date(r.created_at) } : null;
}

export interface HubRequest {
  id: number; name: string; status: string; mode: string; requester: string | null; decider: string | null; createdAt: Date | null; decidedAt: Date | null;
  rejectReason: string | null; stage: string | null; progress: string | null; rulebookUrl: string | null;
  rightsVerdict: string | null; termsVerdict: string | null; termsUrl: string | null;
}

/** Every request whose slug is this game (normally one; a rejected one may have been asked again). Newest first. */
export async function hubRequests(slug: string): Promise<HubRequest[]> {
  const pool = getPool(); if (!pool) return [];
  const rows = (await pool.query(
    `SELECT r.id, r.name, r.status, r.mode, r.created_at, r.decided_at, r.reject_reason, r.stage, r.progress, r.rulebook_url,
       r.report->>'verdict' rights_verdict, r.terms_check->>'verdict' terms_verdict, r.terms_check->>'termsUrl' terms_url,
       u.display_name requester, du.display_name decider
     FROM game_requests r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users du ON du.id=r.decided_by
     WHERE r.slug=$1 ORDER BY r.id DESC LIMIT 20`, [slug])).rows;
  return rows.map((r) => ({
    id: Number(r.id), name: r.name, status: r.status, mode: r.mode, requester: r.requester, decider: r.decider, createdAt: date(r.created_at), decidedAt: date(r.decided_at),
    rejectReason: r.reject_reason, stage: r.stage, progress: r.progress, rulebookUrl: r.rulebook_url,
    rightsVerdict: r.rights_verdict, termsVerdict: r.terms_verdict, termsUrl: r.terms_url,
  }));
}

export interface HubSource extends SourceRow {
  authority: string; fetchedAtDate: Date | null; chunks: number; embedded: number; hasText: boolean; extract: string;
  /** Detail of the latest 'fetched' audit entry (page counts, OCR notes; never text). */
  fetchedDetail: Record<string, unknown> | null;
}

/** gameSources() plus authority, chunk/embedding counts and how the text was made (latest 'fetched' audit entry). */
export async function hubSources(slug: string): Promise<HubSource[]> {
  const pool = getPool(); if (!pool) return [];
  const base = await gameSources(slug);
  if (!base.length) return [];
  const extra = new Map((await pool.query(
    `SELECT s.id, s.authority, s.fetched_at, s.text_path IS NOT NULL has_text,
       (SELECT count(*)::int FROM chunks ch WHERE ch.source_id=s.id) chunks,
       (SELECT count(*)::int FROM chunks ch WHERE ch.source_id=s.id AND ch.embedding IS NOT NULL) embedded,
       (SELECT a.detail FROM audit_log a WHERE a.action='fetched' AND a.detail->>'url'=s.url ORDER BY a.id DESC LIMIT 1) fetched_detail
     FROM sources s WHERE s.id = ANY($1::bigint[])`, [base.map((s) => s.id)])).rows.map((r) => [Number(r.id), r]));
  return base.map((s) => {
    const x = extra.get(s.id);
    return {
      ...s, authority: x?.authority ?? '?', fetchedAtDate: date(x?.fetched_at), chunks: Number(x?.chunks ?? 0), embedded: Number(x?.embedded ?? 0),
      hasText: !!x?.has_text, extract: extractNote(x?.fetched_detail ?? null), fetchedDetail: x?.fetched_detail ?? null,
    };
  });
}

export interface HubAudit { id: number; actor: string; action: string; at: Date | null; url: string | null; detail: Record<string, unknown> }

export const HUB_AUDIT_ACTIONS = ['fetched', 'extract_empty', 'extract_failed', 'extract_deleted', 'source_deleted', 'takedown'] as const;

/**
 * audit_log entries about this game's links. The log stores URLs, not games, so the URLs come from the game's sources, its
 * admin-added links and its requests' rulebook links (a deleted source is still found through the last two).
 */
export async function hubAudit(slug: string, sourceUrls: string[]): Promise<HubAudit[]> {
  const pool = getPool(); if (!pool) return [];
  const more = (await pool.query(
    `SELECT url FROM runtime_sources WHERE game_slug=$1 UNION SELECT rulebook_url FROM game_requests WHERE slug=$1 AND rulebook_url IS NOT NULL`, [slug])).rows.map((r) => String(r.url));
  const urls = [...new Set([...sourceUrls, ...more])];
  if (!urls.length) return [];
  const rows = (await pool.query(
    `SELECT id, actor, action, detail, created_at FROM audit_log
     WHERE action = ANY($2::text[]) AND (detail->>'url' = ANY($1::text[]) OR (jsonb_typeof(detail->'urls')='array' AND detail->'urls' ?| $1::text[]))
     ORDER BY id DESC LIMIT 200`, [urls, [...HUB_AUDIT_ACTIONS]])).rows;
  return rows.map((r) => ({ id: Number(r.id), actor: r.actor, action: r.action, at: date(r.created_at), url: typeof r.detail?.url === 'string' ? r.detail.url : null, detail: r.detail ?? {} }));
}

/** page_quality rows per source (same table /admin/quality summarizes), for the text quality card on the game page. */
export async function hubPageScores(sourceIds: number[]): Promise<Map<number, PageScore[]>> {
  const out = new Map<number, PageScore[]>();
  const pool = getPool(); if (!pool || !sourceIds.length) return out;
  const rows = (await pool.query('SELECT source_id, page, score, verdict, state FROM page_quality WHERE source_id = ANY($1::bigint[]) ORDER BY source_id, page', [sourceIds])).rows;
  for (const r of rows) {
    const id = Number(r.source_id);
    out.set(id, [...(out.get(id) ?? []), { page: Number(r.page), score: Number(r.score), verdict: r.verdict, state: r.state }]);
  }
  return out;
}

export interface ViewerSource { id: number; url: string; title: string | null; publisher: string | null; pageCount: number | null; contentType: string | null; ocr: string }

/** One source for the extract viewer (/admin/games/<slug>/extracts?source=), with how its text was made. */
export async function viewerSource(sourceId: number): Promise<ViewerSource | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `SELECT s.id, s.url, s.title, s.publisher, s.page_count, s.content_type,
       (SELECT a.detail FROM audit_log a WHERE a.action='fetched' AND a.detail->>'url'=s.url ORDER BY a.id DESC LIMIT 1) fetched_detail
     FROM sources s WHERE s.id=$1`, [sourceId])).rows[0];
  if (!r) return null;
  return {
    id: Number(r.id), url: r.url, title: r.title, publisher: r.publisher, pageCount: r.page_count == null ? null : Number(r.page_count),
    contentType: r.content_type, ocr: extractNote(r.fetched_detail ?? null),
  };
}
