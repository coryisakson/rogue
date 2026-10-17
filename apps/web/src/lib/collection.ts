/**
 * The signed-in user's BGG username and imported collection (migration 0033). One stored collection per user; a new
 * import replaces it. API imports double as the per-username cache: a fresh one (any user, same username) is reused.
 */
import { sameOrigin, type BggItem, type RogueGameRef } from '@rogue/core';
import type { SessionUser } from './auth';
import { ensureMigrated, getPool } from './services';

export const COLLECTION_PAGE = '/account/collection';

/** Every collection POST: same origin and signed in. Returns the user, or the Response to send instead. */
export function collectionPostGuard(request: Request, user: SessionUser | null): SessionUser | Response {
  const h = request.headers;
  if (!sameOrigin(h.get('origin'), h.get('referer'), h.get('x-forwarded-host') ?? h.get('host'))) return new Response('Bad origin', { status: 403 });
  if (!user) return new Response(null, { status: 303, headers: { location: `/login?next=${COLLECTION_PAGE}` } });
  return user;
}

/** Back to the collection page with a status code (and optional count) the page turns into a message. */
export function backToCollection(msg: string, n?: number): Response {
  const q = new URLSearchParams({ msg });
  if (n !== undefined) q.set('n', String(n));
  return new Response(null, { status: 303, headers: { location: `${COLLECTION_PAGE}?${q}`, 'cache-control': 'no-store' } });
}

/** How long an API import is reused before we ask BGG again. */
export const BGG_CACHE_HOURS = 24;

export interface StoredCollection { username: string | null; source: 'api' | 'csv'; items: BggItem[]; fetchedAt: Date }

export async function getBggUsername(userId: number): Promise<string | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  return (await pool.query('SELECT bgg_username FROM users WHERE id=$1', [userId])).rows[0]?.bgg_username ?? null;
}

/** Saves (or clears, with null) the user's BGG username. */
export async function setBggUsername(userId: number, username: string | null): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  await pool.query('UPDATE users SET bgg_username=$1 WHERE id=$2', [username, userId]);
}

const toStored = (r: { username: string | null; source: 'api' | 'csv'; items: BggItem[]; fetched_at: Date }): StoredCollection =>
  ({ username: r.username, source: r.source, items: r.items, fetchedAt: r.fetched_at });

export async function getCollection(userId: number): Promise<StoredCollection | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query('SELECT username, source, items, fetched_at FROM bgg_collections WHERE user_id=$1', [userId])).rows[0];
  return r ? toStored(r) : null;
}

/** The newest API import of this username younger than the cache TTL, from any user. */
export async function cachedApiCollection(username: string): Promise<StoredCollection | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const r = (await pool.query(
    `SELECT username, source, items, fetched_at FROM bgg_collections
     WHERE source='api' AND lower(username)=lower($1) AND fetched_at > now() - make_interval(hours => $2)
     ORDER BY fetched_at DESC LIMIT 1`, [username, BGG_CACHE_HOURS])).rows[0];
  return r ? toStored(r) : null;
}

/** Replaces the user's stored collection. `fetchedAt` keeps a reused cache entry's age, so the TTL is not extended. */
export async function saveCollection(userId: number, c: { username: string | null; source: 'api' | 'csv'; items: BggItem[]; fetchedAt?: Date }): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  await pool.query(
    `INSERT INTO bgg_collections (user_id, username, source, items, fetched_at) VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (user_id) DO UPDATE SET username=EXCLUDED.username, source=EXCLUDED.source, items=EXCLUDED.items, fetched_at=EXCLUDED.fetched_at`,
    [userId, c.username, c.source, JSON.stringify(c.items), c.fetchedAt ?? new Date()]);
}

export async function deleteCollection(userId: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  await pool.query('DELETE FROM bgg_collections WHERE user_id=$1', [userId]);
}

/** Rogue games that carry a BGG id, for the comparison. */
export async function rogueGamesWithBggId(): Promise<RogueGameRef[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const r = await pool.query('SELECT bgg_id, slug, name FROM games WHERE bgg_id IS NOT NULL');
  return r.rows.map((g: { bgg_id: number; slug: string; name: string }) => ({ bggId: g.bgg_id, slug: g.slug, name: g.name }));
}
