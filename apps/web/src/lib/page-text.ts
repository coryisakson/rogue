import { scorePage, splitPages, type PageQuality } from '@rogue/core';
import { ensureMigrated, getPool, storage } from './services';

/**
 * The text of a source as the index should see it: the extracted file, with accepted page repairs laid over it and
 * pages an agent judged unreadable left out. Repairs are keyed by the file hash, so a changed rulebook starts clean.
 */
export interface SourcePages {
  sourceId: number;
  contentHash: string | null;
  raw: Map<number, string>;
  /** Effective text per page (override applied). Unusable pages are not in this map. */
  pages: Map<number, string>;
  unusable: Set<number>;
}

export async function loadSourcePages(sourceId: number): Promise<SourcePages | null> {
  const pool = getPool(); if (!pool) return null;
  await ensureMigrated();
  const s = (await pool.query('SELECT text_path, content_hash FROM sources WHERE id=$1', [sourceId])).rows[0];
  if (!s?.text_path) return null;
  const buf = await storage.get(s.text_path); if (!buf) return null;
  const raw = splitPages(new TextDecoder().decode(buf));
  const pages = new Map(raw);
  for (const r of (await pool.query('SELECT page, text FROM page_overrides WHERE source_id=$1 AND content_hash=$2', [sourceId, s.content_hash])).rows) pages.set(Number(r.page), String(r.text));
  const unusable = new Set<number>((await pool.query("SELECT page FROM page_quality WHERE source_id=$1 AND state='unusable' AND content_hash=$2", [sourceId, s.content_hash])).rows.map((r) => Number(r.page)));
  for (const p of unusable) pages.delete(p);
  return { sourceId, contentHash: s.content_hash ?? null, raw, pages, unusable };
}

/** Text with "=== page N ===" markers, ready for the chunker. */
export const pagesToText = (pages: Map<number, string>): string => [...pages].sort((a, b) => a[0] - b[0]).map(([n, t]) => `\n\n=== page ${n} ===\n${t}`).join('');

export interface QualitySummary { pages: number; ok: number; suspect: number; garbled: number; empty: number; open: number }

/**
 * Score every page of a source (pure code, no model) and store the result. Page state survives re-scoring only for the same
 * file hash. Also stamps chunks.quality so retrieval can down-weight garbled text. Returns what is still open for an agent.
 */
export async function scoreSource(sourceId: number): Promise<QualitySummary | null> {
  const pool = getPool(); if (!pool) return null;
  const sp = await loadSourcePages(sourceId); if (!sp) return null;
  const hash = sp.contentHash;
  const old = new Map((await pool.query('SELECT page, state, content_hash FROM page_quality WHERE source_id=$1', [sourceId])).rows.map((r) => [Number(r.page), r]));
  const overridden = new Set<number>((await pool.query('SELECT page FROM page_overrides WHERE source_id=$1 AND content_hash=$2', [sourceId, hash])).rows.map((r) => Number(r.page)));
  const rows: { page: number; q: PageQuality; state: string }[] = [];
  for (const [page, text] of sp.raw) {
    const o = old.get(page);
    const sameFile = o && o.content_hash === hash;
    const state = sp.unusable.has(page) ? 'unusable' : overridden.has(page) ? 'repaired' : sameFile && o!.state === 'reviewed' ? 'reviewed' : 'auto';
    rows.push({ page, q: scorePage(sp.pages.get(page) ?? text), state });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM page_quality WHERE source_id=$1', [sourceId]);
    for (const r of rows) await client.query('INSERT INTO page_quality(source_id,page,score,verdict,issues,content_hash,state) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sourceId, r.page, r.q.score, r.q.verdict, JSON.stringify(r.q.issues), hash, r.state]);
    // Retrieval weight only for PDF text (OCR damage lives there). Web/plain-text sections are short by nature and are never penalised;
    // 'empty' pages (art, short captions) carry no signal either.
    const isPdf = /pdf/i.test(String((await client.query('SELECT content_type FROM sources WHERE id=$1', [sourceId])).rows[0]?.content_type ?? ''));
    await client.query('UPDATE chunks SET quality=NULL WHERE source_id=$1', [sourceId]);
    if (isPdf) await client.query("UPDATE chunks c SET quality=pq.score FROM page_quality pq WHERE c.source_id=$1 AND pq.source_id=c.source_id AND pq.page=c.page AND pq.verdict <> 'empty'", [sourceId]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const count = (v: string) => rows.filter((r) => r.q.verdict === v).length;
  return {
    pages: rows.length, ok: count('ok'), suspect: count('suspect'), garbled: count('garbled'), empty: count('empty'),
    open: rows.filter((r) => (r.q.verdict === 'suspect' || r.q.verdict === 'garbled') && r.state === 'auto').length,
  };
}

/** Read-only quality summary for the extracts viewer: scores the effective text in memory, writes nothing (scoreSource stores). */
export function summarizePages(sp: SourcePages): Omit<QualitySummary, 'open'> & { leftOut: number } {
  const verdicts = [...sp.raw.keys()].filter((p) => !sp.unusable.has(p)).map((p) => scorePage(sp.pages.get(p) ?? '').verdict);
  const count = (v: string) => verdicts.filter((x) => x === v).length;
  return { pages: sp.raw.size, ok: count('ok'), suspect: count('suspect'), garbled: count('garbled'), empty: count('empty'), leftOut: sp.unusable.size };
}

/** Which pages of a source carry replacement text, and how it was made (agent repair, re-OCR or extract review). Same file hash only. */
export async function loadOverrideMethods(sourceId: number, contentHash: string | null): Promise<Map<number, 'ocr' | 'agent' | 'extract'>> {
  const pool = getPool(); if (!pool) return new Map();
  const rows = (await pool.query('SELECT page, method FROM page_overrides WHERE source_id=$1 AND content_hash=$2', [sourceId, contentHash])).rows;
  return new Map(rows.map((r) => [Number(r.page), r.method]));
}

/** The whole source as one markdown file, one '## Page N' section per page (for download and offline review). */
export const pagesToMarkdown = (title: string, pages: Map<number, string>): string =>
  `# ${title}\n` + [...pages].sort((a, b) => a[0] - b[0]).map(([n, t]) => `\n## Page ${n}\n\n${t.trim()}\n`).join('');

/** Store better text for a page (re-OCR, an accepted agent repair or extract choice). The caller has already run the safety gate. */
export async function saveOverride(sourceId: number, page: number, text: string, method: 'ocr' | 'agent' | 'extract', actor: string, before: number, after: number): Promise<void> {
  const pool = getPool(); if (!pool) return;
  const hash = (await pool.query('SELECT content_hash FROM sources WHERE id=$1', [sourceId])).rows[0]?.content_hash;
  await pool.query(
    `INSERT INTO page_overrides(source_id,page,content_hash,text,method,actor,score_before,score_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_id,page) DO UPDATE SET content_hash=EXCLUDED.content_hash,text=EXCLUDED.text,method=EXCLUDED.method,actor=EXCLUDED.actor,score_before=EXCLUDED.score_before,score_after=EXCLUDED.score_after,created_at=now()`,
    [sourceId, page, hash, text, method, actor, before, after]);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [actor, 'page_repaired', { sourceId, page, method, before, after }]);
}
