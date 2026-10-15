import { chunkText, rrf } from '@rogue/core';
import { ensureMigrated, getAi, getPool, storage } from './services';

/** Chunk a source's extracted text and (best effort) embed it. Re-running replaces the source's chunks. */
const running = new Set<number>();

export async function indexSource(sourceId: number): Promise<{ chunks: number; embedded: number; model: string | null; note?: string }> {
  // Retried or concurrent requests must not index the same source twice at once.
  if (running.has(sourceId)) return { chunks: 0, embedded: 0, model: null, note: 'already indexing; skipped' };
  running.add(sourceId);
  try { return await indexSourceInner(sourceId); } finally { running.delete(sourceId); }
}

async function indexSourceInner(sourceId: number): Promise<{ chunks: number; embedded: number; model: string | null; note?: string }> {
  const pool = getPool(); if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const s = (await pool.query('SELECT text_path, language FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!s?.text_path) throw new Error('source has no extracted text (taken down or not ingested)');
  const raw = await storage.get(s.text_path); if (!raw) throw new Error('text file missing');
  const chunks = chunkText(new TextDecoder().decode(raw));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [sourceId]);
    await client.query('DELETE FROM chunks WHERE source_id=$1', [sourceId]);
    for (const c of chunks) await client.query('INSERT INTO chunks(source_id,page,ord,text,lang) VALUES ($1,$2,$3,$4,$5)', [sourceId, c.page, c.ord, c.text, s.language ?? 'en']);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  let embedded = 0; let model: string | null = null; let note: string | undefined;
  const ai = getAi();
  if (!ai) note = 'no AI provider configured; keyword search only';
  else {
    const rows = (await pool.query('SELECT id, text FROM chunks WHERE source_id=$1 ORDER BY ord', [sourceId])).rows;
    try {
      // The Router embedding model accepts one text per request (single-concurrency), so go sequentially.
      for (const row of rows as { id: string; text: string }[]) {
        const r = await ai.embed([row.text]);
        model = r.model;
        const v = r.vectors[0];
        if (!v || v.length !== 768) throw new Error(`unexpected embedding size ${v?.length}`);
        await pool.query('UPDATE chunks SET embedding=$2::vector, embed_model=$3 WHERE id=$1', [row.id, `[${v.join(',')}]`, r.model]);
        embedded++;
      }
    } catch (e) { note = `embedding stopped: ${(e as Error).message}; keyword search still works`; }
  }
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['indexer', 'index_source', { sourceId, chunks: chunks.length, embedded, model, note }]);
  return { chunks: chunks.length, embedded, model, ...(note ? { note } : {}) };
}

export interface RuleHit { chunk_id: string; game: string; slug: string; page: number; snippet: string; source_title: string; source_url: string; publisher: string | null; availability: string; via: string }

/** Hybrid retrieval over whole rulebooks. Snippets are capped: the full private text is never returned. */
export async function searchRules(q: string, opts: { game?: string; limit?: number; snippet?: number } = {}): Promise<RuleHit[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const limit = Math.min(opts.limit ?? 6, 20);
  const snip = Math.min(opts.snippet ?? 400, 600);
  const game = opts.game ?? null;
  const base = `FROM chunks ch JOIN sources s ON s.id=ch.source_id JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id`;
  const kw = (await pool.query(
    `SELECT ch.id::text id ${base}, websearch_to_tsquery('simple',$1) tq WHERE ch.tsv @@ tq AND ($2::text IS NULL OR g.slug=$2) ORDER BY ts_rank_cd(ch.tsv,tq) DESC LIMIT 30`, [q, game])).rows.map((r) => r.id as string);
  let vec: string[] = [];
  const ai = getAi();
  if (ai) {
    try {
      const v = (await ai.embed([q])).vectors[0];
      if (v?.length === 768) vec = (await pool.query(
        `SELECT ch.id::text id ${base} WHERE ch.embedding IS NOT NULL AND ($2::text IS NULL OR g.slug=$2) ORDER BY ch.embedding <=> $1::vector LIMIT 30`, [`[${v.join(',')}]`, game])).rows.map((r) => r.id as string);
    } catch { /* keyword results still returned */ }
  }
  const ids = rrf([kw, vec]).slice(0, limit);
  if (!ids.length) return [];
  const rows = (await pool.query(
    `SELECT ch.id::text chunk_id, g.name game, g.slug, ch.page, left(ch.text, $2) snippet, s.title source_title, s.url source_url, s.publisher, s.availability ${base} WHERE ch.id = ANY($1::bigint[])`, [ids, snip])).rows;
  const byId = new Map(rows.map((r) => [r.chunk_id as string, r]));
  return ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), via: kw.includes(id) && vec.includes(id) ? 'keyword+semantic' : kw.includes(id) ? 'keyword' : 'semantic' }));
}
