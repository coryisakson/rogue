import { extractText, getDocumentProxy } from 'unpdf';
import { RightsGatedFetcher, FetchDenied } from '@rogue/core';
import { ensureMigrated, getPool, storage } from './services';
import { ALLOWED_HOSTS, SEEDS, type SourceSeed } from './source-seeds';

export interface IngestResult {
  url: string;
  ok: boolean;
  detail: string;
  sourceId?: number;
  pages?: number;
  chars?: number;
  sha256?: string;
}

const fetcher = new RightsGatedFetcher({ allowedHosts: ALLOWED_HOSTS, minDelayMs: 2000 });

/**
 * Fetch one seed through the rights gate, keep a PRIVATE copy (never served), extract text for the Librarian,
 * record the source (rights_status stays link_only until a grant exists) and audit the decision.
 */
export async function ingestSeed(seed: SourceSeed): Promise<IngestResult> {
  const pool = getPool();
  if (!pool) return { url: seed.url, ok: false, detail: 'database not configured' };
  await ensureMigrated();

  const tomb = await pool.query('SELECT 1 FROM tombstones WHERE url = $1', [seed.url]);
  if (tomb.rowCount) return { url: seed.url, ok: false, detail: 'tombstoned (takedown); not fetching' };

  let doc;
  try {
    doc = await fetcher.fetch(seed.url);
  } catch (e) {
    const denied = e instanceof FetchDenied;
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [
      'ingest', denied ? 'fetch_denied' : 'fetch_failed', { url: seed.url, error: (e as Error).message },
    ]);
    return { url: seed.url, ok: false, detail: (e as Error).message };
  }

  const privatePath = `private/sources/${doc.sha256}.pdf`;
  const textPath = `private/sources/${doc.sha256}.txt`;
  await storage.put(privatePath, doc.bytes);

  let pages = 0;
  let text = '';
  if (doc.contentType.includes('pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(doc.bytes));
    const out = await extractText(pdf, { mergePages: false });
    pages = out.totalPages;
    text = out.text.map((t, i) => `\n\n=== page ${i + 1} ===\n${t}`).join('');
    await storage.put(textPath, new TextEncoder().encode(text));
  }

  const game = await pool.query('SELECT id FROM games WHERE slug = $1', [seed.gameSlug]);
  if (!game.rowCount) return { url: seed.url, ok: false, detail: `unknown game ${seed.gameSlug}` };

  const src = await pool.query(
    `INSERT INTO sources (url, title, publisher, language, authority, rights_status, content_hash, fetched_at, policy_version, private_path, text_path, page_count, content_type)
     VALUES ($1,$2,$3,$4,'publisher','link_only',$5,now(),$6,$7,$8,$9,$10)
     ON CONFLICT (url) DO UPDATE SET content_hash=EXCLUDED.content_hash, fetched_at=now(), policy_version=EXCLUDED.policy_version,
       private_path=EXCLUDED.private_path, text_path=EXCLUDED.text_path, page_count=EXCLUDED.page_count, content_type=EXCLUDED.content_type
     RETURNING id`,
    [seed.url, seed.title, seed.publisher, seed.language, doc.sha256, doc.decision.policyVersion, privatePath, text ? textPath : null, pages || null, doc.contentType],
  );
  const sourceId = src.rows[0].id as number;

  const ed = await pool.query(
    `INSERT INTO editions (game_id, label, language) VALUES ($1,$2,$3)
     ON CONFLICT (game_id, label, language) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
    [game.rows[0].id, seed.editionLabel, seed.language],
  );
  await pool.query(
    `INSERT INTO documents (source_id, edition_id, kind) VALUES ($1,$2,$3) ON CONFLICT (source_id, edition_id) DO NOTHING`,
    [sourceId, ed.rows[0].id, seed.kind],
  );
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [
    'ingest', 'fetched',
    { url: seed.url, foundOn: seed.foundOn, sha256: doc.sha256, bytes: doc.bytes.byteLength, pages, policyVersion: doc.decision.policyVersion, etag: doc.etag, lastModified: doc.lastModified },
  ]);
  return { url: seed.url, ok: true, detail: 'fetched, stored privately', sourceId, pages, chars: text.length, sha256: doc.sha256 };
}

export async function ingestGame(slug: string): Promise<IngestResult[]> {
  const seeds = SEEDS.filter((s) => s.gameSlug === slug);
  if (!seeds.length) return [{ url: '', ok: false, detail: `no seed sources for ${slug}` }];
  const out: IngestResult[] = [];
  for (const s of seeds) out.push(await ingestSeed(s));
  return out;
}
