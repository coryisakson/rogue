import { VERIFY_SYSTEM, curatorDecision, parseVerdict, quoteOnPage, splitPages, OpenAiCompatibleProvider } from '@rogue/core';
import { ensureMigrated, getAi, getPool, ipv4Fetch, storage } from './services';
import { ingestSeed } from './ingest';
import { SEEDS } from './source-seeds';

/**
 * Optional independent judge (a frontier model through the Claude/OpenAI-compatible endpoint). Not configured by default:
 * without it the Curator can restore claims but never rejects them, so unsure claims wait in the human exception queue.
 */
function getJudge(): { ai: OpenAiCompatibleProvider; model: string } | null {
  const base = process.env['ROGUE_JUDGE_BASE_URL']; if (!base) return null;
  const model = process.env['ROGUE_JUDGE_MODEL'] ?? 'default-chat';
  const key = process.env['ROGUE_JUDGE_API_KEY'];
  return { model, ai: new OpenAiCompatibleProvider({ baseUrl: base, ...(key ? { apiKey: key } : {}), defaultChatModel: model, defaultEmbedModel: 'none', fetchImpl: ipv4Fetch }) };
}

export interface CuratorLine { claimId: number; verdict: string; detail: string }
export interface CuratorResult { dry: boolean; checked: number; restored: number; rejected: number; kept: number; judge: boolean; lines: CuratorLine[] }

/** Re-read the current source text and settle each needs_review claim by rule. Never touches humans' decisions (verified claims are re-checked too, but only restored or kept). */
export async function resolveNeedsReview(dry = false): Promise<CuratorResult> {
  const pool = getPool(); const ai = getAi();
  const out: CuratorResult = { dry, checked: 0, restored: 0, rejected: 0, kept: 0, judge: false, lines: [] };
  if (!pool || !ai) return out;
  await ensureMigrated();
  const judge = getJudge(); out.judge = !!judge;

  // 1. Sources whose file changed: fetch the new version (rights gate applies) so we compare against current text.
  const changed = (await pool.query("SELECT DISTINCT s.id, s.url FROM sources s JOIN documents d ON d.source_id=s.id JOIN citations ci ON ci.document_id=d.id JOIN claims c ON c.id=ci.claim_id WHERE c.status='needs_review' AND s.availability='changed'")).rows;
  if (!dry) for (const s of changed) { const seed = SEEDS.find((x) => x.url === s.url); if (seed) await ingestSeed(seed, true).catch(() => {}); }

  const claims = (await pool.query(
    `SELECT c.id, c.body, ci.id cit_id, ci.locator, ci.quote, s.id source_id, s.text_path
     FROM claims c JOIN citations ci ON ci.claim_id=c.id JOIN documents d ON d.id=ci.document_id JOIN sources s ON s.id=d.source_id
     WHERE c.status='needs_review' ORDER BY c.id LIMIT 200`)).rows;
  const pagesCache = new Map<number, Map<number, string> | null>();
  const pagesOf = async (sid: number, path: string | null) => {
    if (!pagesCache.has(sid)) { const raw = path ? await storage.get(path) : null; pagesCache.set(sid, raw ? splitPages(new TextDecoder().decode(raw)) : null); }
    return pagesCache.get(sid)!;
  };
  const touchedSources = new Set<number>();

  for (const c of claims) {
    out.checked++; touchedSources.add(c.source_id);
    // Refresh the path: ingest may have written a new text file.
    const path = (await pool.query('SELECT text_path FROM sources WHERE id=$1', [c.source_id])).rows[0]?.text_path ?? c.text_path;
    const pages = await pagesOf(c.source_id, dry ? c.text_path : path);
    if (!pages || !c.quote) { out.kept++; out.lines.push({ claimId: c.id, verdict: 'keep', detail: 'no stored text or quote to compare' }); continue; }
    const hitPage = [...pages].find(([, t]) => quoteOnPage(c.quote, t))?.[0] ?? null;
    let supported: boolean | null = null;
    if (hitPage !== null) {
      try { supported = parseVerdict((await ai.chat({ temperature: 0, maxTokens: 1500, messages: [{ role: 'system', content: VERIFY_SYSTEM }, { role: 'user', content: `Claim: ${c.body}\n\nQuote: ${c.quote}` }] })).text); } catch { supported = null; }
    }
    let judgeWrong: boolean | null = null;
    if (judge && (hitPage === null || supported === false)) {
      try {
        const ctx = hitPage !== null ? pages.get(hitPage)!.slice(0, 4000) : [...pages.values()].join('\n').slice(0, 12000);
        const r = await judge.ai.chat({ temperature: 0, maxTokens: 800, model: judge.model, messages: [
          { role: 'system', content: 'You audit a board-game rules claim against rulebook text. Reply with exactly one word: SUPPORTED if the text supports the claim, otherwise NOT_SUPPORTED.' },
          { role: 'user', content: `Claim: ${c.body}\n\nRulebook text:\n${ctx}` }] });
        judgeWrong = !parseVerdict(r.text);
      } catch { judgeWrong = null; }
    }
    const verdict = curatorDecision({ quoteFound: hitPage !== null, supported, judgeConfirmsWrong: judgeWrong });
    const evidence = { quoteFound: hitPage !== null, page: hitPage, supported, judge: judge ? { model: judge.model, confirmsWrong: judgeWrong } : null };
    out.lines.push({ claimId: c.id, verdict, detail: JSON.stringify(evidence) });
    if (verdict === 'keep') { out.kept++; continue; }
    if (dry) { verdict === 'restore' ? out.restored++ : out.rejected++; continue; }
    if (verdict === 'restore') {
      // The quote may have moved to another page in the new edition: keep the locator honest.
      await pool.query('UPDATE citations SET locator=$2 WHERE id=$1', [c.cit_id, `p.${hitPage}`]);
      await pool.query("UPDATE claims SET status='published', verified_at=now() WHERE id=$1", [c.id]);
      out.restored++;
    } else {
      await pool.query("UPDATE claims SET status='rejected', rejected_reason=$2, rejected_by='curator' WHERE id=$1", [c.id, `source check: ${JSON.stringify(evidence)}`]);
      out.rejected++;
    }
    await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['curator', `needs_review_${verdict}`, { claimId: c.id, ...evidence }]);
  }
  // A changed source with nothing left waiting is available again.
  if (!dry) await pool.query(
    `UPDATE sources s SET availability='available' WHERE s.id = ANY($1::bigint[]) AND s.availability='changed'
     AND NOT EXISTS (SELECT 1 FROM citations ci JOIN documents d ON d.id=ci.document_id JOIN claims c ON c.id=ci.claim_id WHERE d.source_id=s.id AND c.status='needs_review')`, [[...touchedSources]]);
  return out;
}
