import { ensureMigrated, getPool } from './services';

export interface Game { slug: string; name: string; publisher: string | null; year: number | null; min_players: number | null; max_players: number | null; bgg_id: number | null; claim_count: number }
export interface Claim { id: string; topic: string; player_count: number | null; body: string; created_by: string; locator: string | null; quote: string | null; source_title: string; source_url: string; publisher: string | null; availability: string; avg_stars: number | null; rating_count: number; my_stars: number | null; edition: string }

export async function listGames(): Promise<Game[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const r = await pool.query(
    `SELECT g.slug, g.name, g.publisher, g.year, g.min_players, g.max_players, g.bgg_id,
            (SELECT count(*) FROM claims c JOIN editions e ON e.id=c.edition_id WHERE e.game_id=g.id AND c.status='published')::int AS claim_count
     FROM games g ORDER BY claim_count DESC, g.name`,
  );
  return r.rows;
}

export async function getGame(slug: string): Promise<Game | null> {
  return (await listGames()).find((g) => g.slug === slug) ?? null;
}

export async function getClaims(slug: string, opts: { topic?: string; q?: string; userId?: number } = {}): Promise<Claim[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const r = await pool.query(
    `SELECT c.id, c.topic, c.player_count, c.body, c.created_by, ci.locator, ci.quote, s.title source_title, s.url source_url, s.publisher, s.availability, e.label edition,
            (SELECT avg(stars)::float FROM claim_ratings cr WHERE cr.claim_id=c.id) avg_stars,
            (SELECT count(*)::int FROM claim_ratings cr WHERE cr.claim_id=c.id) rating_count,
            (SELECT stars FROM claim_ratings cr WHERE cr.claim_id=c.id AND cr.user_id=$4) my_stars
     FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id
     LEFT JOIN citations ci ON ci.claim_id=c.id LEFT JOIN documents d ON d.id=ci.document_id LEFT JOIN sources s ON s.id=d.source_id
     WHERE g.slug=$1 AND c.status='published' AND ($2::text IS NULL OR c.topic=$2) AND ($3::text IS NULL OR c.body ILIKE '%'||$3||'%')
     ORDER BY c.id`,
    [slug, opts.topic ?? null, opts.q ?? null, opts.userId != null ? String(opts.userId) : null],
  );
  return r.rows;
}

/** Plain text search across published claims of every game (stand-in until embeddings/hybrid search land). */
export async function searchClaims(q: string) {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const r = await pool.query(
    `SELECT g.slug, g.name game, c.topic, c.player_count, c.body, ci.locator, s.title source_title, s.url source_url
     FROM claims c JOIN editions e ON e.id=c.edition_id JOIN games g ON g.id=e.game_id
     LEFT JOIN citations ci ON ci.claim_id=c.id LEFT JOIN documents d ON d.id=ci.document_id LEFT JOIN sources s ON s.id=d.source_id
     WHERE c.status='published' AND c.body ILIKE '%'||$1||'%' ORDER BY g.name, c.id LIMIT 50`,
    [q],
  );
  return r.rows;
}
