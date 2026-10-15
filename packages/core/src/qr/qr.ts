/**
 * QR codes printed in a rulebook (companion app, how-to-play videos) become cited facts.
 * Pure helpers only: decoding pixels lives in apps/web (needs the PDF library). We RECORD the link and never fetch it,
 * so the rights gate is not involved; users follow the link themselves.
 */

/** A decoded QR code and where it was found. */
export interface QrFinding { url: string; page: number }

/** Only plain web links are kept. Anything else (javascript:, data:, wifi:, tel:, mailto:) is dropped as unsafe to show. */
export function acceptQrUrl(raw: string): string | null {
  const text = raw.trim();
  if (text.length > 500 || /\s/.test(text)) return null;
  let u: URL;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null; // credentials in a link are never legitimate here
  return u.toString();
}

/** QR codes are square; skip logos and banners before spending time decoding. Tiny images cannot hold a readable code. */
export function isQrCandidate(width: number, height: number): boolean {
  if (width < 60 || height < 60 || width > 4000 || height > 4000) return false;
  const ratio = width / height;
  return ratio > 0.8 && ratio < 1.25;
}

/** One finding per URL (first page wins); invalid links removed. Order is by page. */
export function dedupeFindings(found: QrFinding[]): QrFinding[] {
  const seen = new Map<string, QrFinding>();
  for (const f of [...found].sort((a, b) => a.page - b.page)) {
    const url = acceptQrUrl(f.url);
    if (url && !seen.has(url)) seen.set(url, { url, page: f.page });
  }
  return [...seen.values()];
}

/** Claim text in our own words; the URL is the fact. */
export function qrClaimBody(f: QrFinding): string {
  const host = new URL(f.url).host;
  return `A QR code in the rulebook links to ${f.url} (${host}).`;
}
