import { RightsGatedFetcher, FetchDenied, htmlAdapter, textAdapter, selectAdapter, qrClaimBody, hasExtractedText, type SourceAdapter } from '@rogue/core';
import { pdfAdapter } from './pdf-adapter';
import { ensureMigrated, getPool, storage } from './services';
import { allSeeds, syncApprovedHosts } from './dynamic-sources';
import { ALLOWED_HOSTS, type SourceSeed } from './source-seeds';

export interface IngestResult {
  url: string;
  ok: boolean;
  detail: string;
  sourceId?: number;
  pages?: number;
  chars?: number;
  sha256?: string;
}

// Adapters are chosen by the response content-type; add new formats here.
const ADAPTERS: SourceAdapter[] = [pdfAdapter, htmlAdapter, textAdapter];

const inflight = new Set<string>();
const fetcher = new RightsGatedFetcher({ allowedHosts: ALLOWED_HOSTS, minDelayMs: 2000 });

/**
 * Fetch one seed through the rights gate, keep a PRIVATE copy (never served), extract text for the Librarian,
 * record the source (rights_status stays link_only until a grant exists) and audit the decision.
 */
export async function ingestSeed(seed: SourceSeed, force = false): Promise<IngestResult> {
  try {
    return await ingestSeedInner(seed, force);
  } finally {
    inflight.delete(seed.url);
  }
}

async function ingestSeedInner(seed: SourceSeed, force: boolean): Promise<IngestResult> {
  const pool = getPool();
  if (!pool) return { url: seed.url, ok: false, detail: 'database not configured' };
  if (inflight.has(seed.url)) return { url: seed.url, ok: false, detail: 'already being fetched' };
  await ensureMigrated();
  await syncApprovedHosts(); // hosts a human approved through the add-game flow

  const tomb = await pool.query('SELECT 1 FROM tombstones WHERE url = $1', [seed.url]);
  if (tomb.rowCount) return { url: seed.url, ok: false, detail: 'tombstoned (takedown); not fetching' };

  // Politeness: never re-download a publisher file within 24h (guards against retries / double clicks) unless forced.
  if (!force) {
    const recent = await pool.query("SELECT id, content_hash FROM sources WHERE url = $1 AND fetched_at > now() - interval '24 hours'", [seed.url]);
    if (recent.rowCount) return { url: seed.url, ok: true, detail: 'fetched within the last 24h; skipped', sourceId: recent.rows[0].id, sha256: recent.rows[0].content_hash };
  }
  inflight.add(seed.url);

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

  // Extract first: an unsupported or unreadable body is refused before anything is stored.
  const adapter = selectAdapter(ADAPTERS, doc.contentType);
  let extracted;
  try {
    if (!adapter) throw new Error(`unsupported content-type ${doc.contentType}`);
    extracted = await adapter.extract(doc.bytes, doc.contentType);
  } catch (e) {
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [
      'ingest', 'extract_failed', { url: seed.url, contentType: doc.contentType, error: (e as Error).message },
    ]);
    return { url: seed.url, ok: false, detail: (e as Error).message };
  }

  // Nothing readable came out (no text layer and no OCR result): do not persist the file, text or any rows.
  if (!hasExtractedText(extracted.text)) {
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [
      'ingest', 'extract_empty', { url: seed.url, contentType: doc.contentType, pages: extracted.pageCount, ...(extracted.notes ?? {}) },
    ]);
    return { url: seed.url, ok: false, detail: 'no text extracted (no text layer, OCR gave nothing); nothing stored' };
  }

  const privatePath = `private/sources/${doc.sha256}.${adapter!.extension}`;
  const textPath = `private/sources/${doc.sha256}.txt`;
  await storage.put(privatePath, doc.bytes);
  const pages = extracted.pageCount;
  const text = extracted.text;
  const ocrDetail = extracted.notes ?? {};
  await storage.put(textPath, new TextEncoder().encode(text));

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
  const qrCount = await saveQrFacts(sourceId, ed.rows[0].id, extracted.qrFindings ?? []);
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', [
    'ingest', 'fetched',
    { url: seed.url, foundOn: seed.foundOn, sha256: doc.sha256, bytes: doc.bytes.byteLength, pages, policyVersion: doc.decision.policyVersion, etag: doc.etag, lastModified: doc.lastModified, qrFacts: qrCount, ...ocrDetail },
  ]);
  return { url: seed.url, ok: true, detail: 'fetched, stored privately', sourceId, pages, chars: text.length, sha256: doc.sha256 };
}

export async function ingestGame(slug: string, force = false): Promise<IngestResult[]> {
  const seeds = (await allSeeds()).filter((s) => s.gameSlug === slug);
  if (!seeds.length) return [{ url: '', ok: false, detail: `no seed sources for ${slug}` }];
  const out: IngestResult[] = [];
  for (const s of seeds) out.push(await ingestSeed(s, force));
  return out;
}

/**
 * Turn QR codes found in a document into published 'companion' facts, cited to the page they were printed on.
 * Link only: the target is never fetched. Safe to re-run (same edition + body is unique, so no duplicates).
 */
async function saveQrFacts(sourceId: number, editionId: number, findings: { url: string; page: number }[]): Promise<number> {
  const pool = getPool();
  if (!pool || !findings.length) return 0;
  const doc = await pool.query('SELECT id FROM documents WHERE source_id=$1 AND edition_id=$2', [sourceId, editionId]);
  if (!doc.rowCount) return 0;
  let saved = 0;
  for (const f of findings) {
    const claim = await pool.query(
      `INSERT INTO claims (edition_id, topic, body, status, created_by) VALUES ($1,'companion',$2,'draft','qr-scanner')
       ON CONFLICT DO NOTHING RETURNING id`,
      [editionId, qrClaimBody(f)],
    );
    if (!claim.rowCount) continue;
    await pool.query('INSERT INTO citations (claim_id, document_id, locator) VALUES ($1,$2,$3)', [claim.rows[0].id, doc.rows[0].id, `page ${f.page} (QR code)`]);
    await pool.query("UPDATE claims SET status='published' WHERE id=$1", [claim.rows[0].id]);
    saved++;
  }
  return saved;
}
