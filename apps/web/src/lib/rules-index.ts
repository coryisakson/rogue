import { sectionHeadings, detectPageLabels, applyRanking, pickNeighbours, type RetrievalPlan, chunkText, keywordMatchSql, keywordRankSql, orQuery, parseRanking, qualityWeight, rrf, sourceWeight } from '@rogue/core';
import { agentsEnabled, enqueueJob } from './agent-jobs';
import { loadSourcePages, pagesToText, scoreSource } from './page-text';
import { ensureMigrated, getAi, getEmbedder, getPool, getReranker } from './services';

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
  const s = (await pool.query('SELECT text_path, language, content_type FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!s?.text_path) throw new Error('source has no extracted text (taken down or not ingested)');
  // Effective text: accepted page repairs laid over the extraction, pages an agent judged unreadable left out.
  const sp = await loadSourcePages(sourceId); if (!sp) throw new Error('text file missing');
  const fullText = pagesToText(sp.pages);
  const chunks = chunkText(fullText);
  const ct = String(s.content_type ?? '');
  // Web pages have sections, not pages: remember each section's heading so citations can name it. Plain text sections are numbered.
  const headings = /html/i.test(ct) ? sectionHeadings(fullText) : /text\/plain/i.test(ct) ? new Map([...sp.pages.keys()].map((n) => [n, `section ${n}`])) : null;
  // PDFs only: the page number printed in the footer, so citations can say "p.7 (printed 5)". Missing pages count as blank.
  const printed = headings ? null : detectPageLabels(Array.from({ length: Math.max(0, ...sp.pages.keys()) }, (_, i) => sp.pages.get(i + 1) ?? '')).labels;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [sourceId]);
    await client.query('DELETE FROM chunks WHERE source_id=$1', [sourceId]);
    for (const c of chunks) await client.query('INSERT INTO chunks(source_id,page,ord,text,lang,locator,printed_page) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sourceId, c.page, c.ord, c.text, s.language ?? 'en', headings?.get(c.page) ?? null, printed?.[c.page - 1] ?? null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const quality = await scoreSource(sourceId).catch(() => null); // page text quality; stamps chunks.quality for retrieval weighting
  // Weak pages go to the Quality Curator agent (background job; nothing waits on it). A no-op when agents are off.
  if (quality && quality.open > 0 && agentsEnabled()) await enqueueJob('quality_curate', sourceId).catch(() => {});

  let embedded = 0; let model: string | null = null; let note: string | undefined;
  const ai = getEmbedder();
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
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['indexer', 'index_source', { sourceId, chunks: chunks.length, embedded, model, note, quality }]);
  return { chunks: chunks.length, embedded, model, ...(note ? { note } : {}) };
}

const qCache = new Map<string, number[]>();
async function embedQuery(q: string): Promise<number[] | null> {
  const hit = qCache.get(q); if (hit) return hit;
  const ai = getEmbedder(); if (!ai) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const v = (await ai.embed([q])).vectors[0];
      if (v?.length === 768) { if (qCache.size > 500) qCache.clear(); qCache.set(q, v); return v; }
    } catch (e) { console.warn(`[rules-search] query embed attempt ${attempt + 1} failed: ${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return null;
}

/** `printed` is the page number printed in the PDF (display only; `page` stays the physical page used by citations). */
export interface RuleHit { chunk_id: string; game: string; slug: string; page: number; printed: number | null; section: string | null; snippet: string; source_title: string; source_url: string; publisher: string | null; availability: string; via: string; lang: string }

/** Hybrid retrieval over whole rulebooks. Snippets are capped: the full private text is never returned. */
/** Filled by searchRules when passed: per-stage time and the reranker's token use, for the chat's timing log and cost columns. */
export interface SearchStats { embedMs: number; searchMs: number; rerankMs: number; promptTokens: number; completionTokens: number }

/** Languages of a game's indexed rulebooks (chunks.lang, base tag), e.g. ['de', 'en']. A game can hold several editions/sources. */
export async function gameRuleLangs(game: string): Promise<string[]> {
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  return (await pool.query(
    `SELECT DISTINCT lower(split_part(ch.lang, '-', 1)) lang FROM chunks ch JOIN sources s ON s.id=ch.source_id JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug=$1 ORDER BY 1`, [game])).rows.map((r) => r.lang as string).filter(Boolean);
}

/**
 * `alt` are extra phrasings of the same question (translations into the rulebook languages): each is searched by keyword and
 * vector like `q`, and all ranked lists are merged with rrf, so a German question still finds an English rulebook and vice versa.
 */
export async function searchRules(q: string, opts: { game?: string; limit?: number; snippet?: number; rerank?: boolean; stats?: SearchStats; alt?: string[] } = {}): Promise<RuleHit[]> {
  const stats = opts.stats;
  let t0 = Date.now();
  const pool = getPool(); if (!pool) return [];
  await ensureMigrated();
  const limit = Math.min(opts.limit ?? 6, 20);
  const snip = Math.min(opts.snippet ?? 400, 600);
  const game = opts.game ?? null;
  const base = `FROM chunks ch JOIN sources s ON s.id=ch.source_id JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id`;
  const queries = [...new Set([q, ...(opts.alt ?? [])].map((x) => x.trim()).filter(Boolean))];
  const kwLists: string[][] = []; const vecLists: string[][] = [];
  if (stats) stats.embedMs = 0;
  for (const query of queries) {
    // Each chunk is matched with its own language's config (chunks.tsv is built the same way, migration 0031).
    const oq = orQuery(query);
    kwLists.push(oq ? (await pool.query(
      `SELECT ch.id::text id ${base} WHERE ${keywordMatchSql('$1')} AND ($2::text IS NULL OR g.slug=$2) ORDER BY ${keywordRankSql('$1')} DESC LIMIT 30`, [oq, game])).rows.map((r) => r.id as string) : []);
    const tEmbed = Date.now();
    const v = await embedQuery(query);
    if (stats) stats.embedMs += Date.now() - tEmbed;
    vecLists.push(v ? (await pool.query(
      `SELECT ch.id::text id ${base} WHERE ch.embedding IS NOT NULL AND ($2::text IS NULL OR g.slug=$2) ORDER BY ch.embedding <=> $1::vector LIMIT 30`, [`[${v.join(',')}]`, game])).rows.map((r) => r.id as string) : []);
  }
  const kw = kwLists.flat(); const vec = vecLists.flat();
  // Authority ranking: official FAQ/errata and publisher sources lift above product pages and community text; garbled OCR text sinks.
  const cand = [...new Set([...kw, ...vec])];
  const wrows = cand.length ? (await pool.query(
    `SELECT ch.id::text id, d.kind, s.authority, s.capture_method, ch.quality ${base} WHERE ch.id = ANY($1::bigint[])`, [cand])).rows : [];
  const weights = new Map(wrows.map((r) => [r.id as string, sourceWeight(r.kind, r.authority, r.capture_method) * qualityWeight(r.quality as number | null)]));
  let ids = rrf([...kwLists, ...vecLists], 60, (id) => weights.get(id) ?? 1).slice(0, opts.rerank ? Math.max(limit, 10) : limit);
  if (!ids.length) return [];
  const rows = (await pool.query(
    `SELECT ch.id::text chunk_id, g.name game, g.slug, ch.page, ch.printed_page printed, ch.locator section, left(ch.text, $2) snippet, ch.lang, s.title source_title, s.url source_url, s.publisher, s.availability ${base} WHERE ch.id = ANY($1::bigint[])`, [ids, snip])).rows;
  const byId = new Map(rows.map((r) => [r.chunk_id as string, r]));
  if (stats) stats.searchMs = Date.now() - t0 - stats.embedMs;
  // Reranking only reorders; when the fused list already fits in `limit`, every candidate is kept anyway, so skip the LLM round trip.
  if (opts.rerank && ids.length > limit) {
    t0 = Date.now();
    ids = (await rerank(q, ids.filter((id) => byId.has(id)), byId, stats)).slice(0, limit);
    if (stats) stats.rerankMs = Date.now() - t0;
  }
  return ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), via: kw.includes(id) && vec.includes(id) ? 'keyword+semantic' : kw.includes(id) ? 'keyword' : 'semantic' }));
}

const rerankCache = new Map<string, string[]>();

/**
 * Order the candidates by usefulness for the question: with a rerank model (ROGUE_AI_RERANK_MODEL) through the endpoint's /rerank,
 * else (or when that fails) by asking the chat model. Any failure keeps the original order.
 */
async function rerank(q: string, ids: string[], byId: Map<string, { snippet: string; page: number; section?: string | null }>, stats?: SearchStats): Promise<string[]> {
  const key = q + '|' + ids.join(',');
  const hit = rerankCache.get(key); if (hit) return hit;
  const rr = getReranker();
  if (rr) {
    try {
      const order = await rr.ai.rerank(q, ids.map((id) => byId.get(id)!.snippet.replace(/\s+/g, ' ')), rr.model);
      const out = applyRanking(ids, order.map((i) => i + 1));
      if (rerankCache.size > 300) rerankCache.clear();
      rerankCache.set(key, out);
      return out;
    } catch (e) { console.warn(`[rules-search] rerank model failed, using the chat model: ${(e as Error).message}`); }
  }
  const ai = getAi(); if (!ai) return ids;
  const list = ids.map((id, i) => `[${i + 1}] (${byId.get(id)!.section ? `s.${byId.get(id)!.page}` : `p.${byId.get(id)!.page}`}) ${byId.get(id)!.snippet.replace(/\s+/g, ' ').slice(0, 320)}`).join('\n');
  try {
    const r = await ai.chat({
      temperature: 0,
      // A JSON array needs no thinking: 'none' cut this call from 2-8 s to ~0.3 s on gemma4. The cap stays roomy in case an endpoint ignores it.
      reasoning: 'none',
      maxTokens: 1500,
      messages: [
        { role: 'system', content: 'You rank excerpts of a board game rulebook by how directly they answer the question. Excerpts that state the rule outrank examples, glossaries or flavour. Reply with ONLY a JSON array of the excerpt numbers, best first, at most 5 numbers. Example: [3,1,4]' },
        { role: 'user', content: `Question: ${q}\n\nExcerpts:\n${list}` },
      ],
    });
    if (stats) { stats.promptTokens += r.promptTokens; stats.completionTokens += r.completionTokens; }
    const out = applyRanking(ids, parseRanking(r.text, ids.length));
    if (rerankCache.size > 300) rerankCache.clear();
    rerankCache.set(key, out);
    return out;
  } catch (e) {
    console.warn(`[rules-search] rerank failed, keeping fused order: ${(e as Error).message}`);
    return ids;
  }
}

/** Excerpts for the chat model: each hit plus its neighbouring chunks and the chunks on nearby pages (a list often runs
 *  across a chunk boundary or onto the facing page). The plan caps how many; hits are kept first. Sent to the model only;
 *  the answer shows short capped quotes, never this text. */
export async function expandWithNeighbors(chunkIds: string[], plan: RetrievalPlan): Promise<{ page: number; text: string; section: string | null; printed: number | null }[]> {
  const pool = getPool(); if (!pool || !chunkIds.length) return [];
  const rows = (await pool.query(
    `SELECT n.source_id, n.ord, n.page, n.locator, n.printed_page, n.text,
            MIN(ABS(n.ord - c.ord)) AS chunk_dist, MIN(ABS(n.page - c.page)) AS page_dist
     FROM chunks c JOIN chunks n ON n.source_id=c.source_id
       AND (n.ord BETWEEN c.ord-$2 AND c.ord+$2 OR n.page BETWEEN c.page-$3 AND c.page+$3)
     WHERE c.id = ANY($1::bigint[])
     GROUP BY n.id, n.source_id, n.ord, n.page, n.locator, n.printed_page, n.text`, [chunkIds, plan.neighbourChunks, plan.neighbourPages])).rows;
  return pickNeighbours(rows.map((r) => ({
    sourceId: Number(r.source_id), ord: Number(r.ord), chunkDistance: Number(r.chunk_dist), pageDistance: Number(r.page_dist),
    item: { page: Number(r.page), text: String(r.text), section: (r.locator as string | null) ?? null, printed: r.printed_page == null ? null : Number(r.printed_page) },
  })), plan);
}
