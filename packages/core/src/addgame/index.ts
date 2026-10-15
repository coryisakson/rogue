/**
 * Add-game flow, pure parts: validating a request, and turning raw probe results into a rights verdict.
 * The network calls live in apps/web/src/lib/add-game.ts; this file has no I/O so it is easy to test.
 * Principle (AGENTS.md rule 2): the agent proposes, deterministic code decides, a human approves.
 */

export interface GameRequestInput { name: string; publisher: string; year: number | null; language: string; rulebookUrl: string; foundOn: string | null }
export type ParsedRequest = { ok: true; value: GameRequestInput } | { ok: false; error: string };

/** URL-safe game id from a title: "Slay the Spire: The Board Game" -> "slay-the-spire-the-board-game". */
export function slugify(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

/** IPv4/IPv6 literals that must never be fetched (loopback, private, link-local, metadata endpoints). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v.includes(':')) return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v);
  return false;
}

/** Hostnames we refuse before any DNS lookup: IP literals, single-label and internal names, odd ports. */
export function hostProblem(u: URL): string | null {
  if (u.protocol !== 'https:') return 'Only https links are accepted.';
  if (u.username || u.password) return 'Links with a user name or password are not accepted.';
  if (u.port && u.port !== '443') return 'Only the standard https port is accepted.';
  const h = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return 'Use a website name, not an IP address.';
  if (!h.includes('.') || /\.(local|internal|lan|localhost|home|corp|intranet)$/.test(h)) return 'That host name looks internal.';
  return null;
}

const text = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function parseGameRequest(f: Record<string, unknown>): ParsedRequest {
  const name = text(f['name'], 80);
  if (name.length < 2) return { ok: false, error: 'Give the game title (at least 2 characters).' };
  if (!slugify(name)) return { ok: false, error: 'The title needs letters or digits.' };
  const publisher = text(f['publisher'], 80);
  if (publisher.length < 2) return { ok: false, error: 'Give the publisher. We only use rulebooks from the publisher or rights holder.' };
  const yearRaw = text(f['year'], 4);
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return { ok: false, error: 'Year must be four digits, or empty.' };
  const language = text(f['language'] || 'en', 8).toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(language)) return { ok: false, error: 'Language must be a code like en or de.' };
  const links: string[] = [];
  for (const key of ['rulebookUrl', 'foundOn']) {
    const raw = text(f[key], 400);
    if (!raw) { links.push(''); continue; }
    let u: URL;
    try { u = new URL(raw); } catch { return { ok: false, error: `${key === 'rulebookUrl' ? 'Rulebook link' : 'Page link'} is not a valid web address.` }; }
    const problem = hostProblem(u);
    if (problem) return { ok: false, error: problem };
    u.hash = '';
    links.push(u.toString());
  }
  if (!links[0]) return { ok: false, error: 'Paste the link to the publisher\'s rulebook (PDF or web page).' };
  return { ok: true, value: { name, publisher, year, language, rulebookUrl: links[0], foundOn: links[1] || null } };
}

/** tdmrep.json (W3C TDM Reservation Protocol): is the given path reserved for text and data mining? */
export function tdmReserved(json: unknown, path: string): boolean {
  if (!Array.isArray(json)) return false;
  return json.some((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const rec = r as Record<string, unknown>;
    if (Number(rec['tdm-reservation']) !== 1 || typeof rec['location'] !== 'string') return false;
    const loc = rec['location'];
    if (loc === '/*' || loc === '/') return true;
    const prefix = loc.replace(/\*$/, '');
    return path.startsWith(prefix);
  });
}

export interface ProbeFacts {
  robots: 'allowed' | 'blocked';
  tdmReserved: boolean;
  optOut: string | null;
  /** null = could not reach the file. */
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  /** Host the file redirects to, when it differs from the requested host. */
  redirectHost: string | null;
  resolvedPrivate: boolean;
}
export interface Finding { level: 'ok' | 'warn' | 'block'; text: string }
export interface RightsAssessment { verdict: 'pass' | 'blocked' | 'problem'; findings: Finding[] }

export const MAX_RULEBOOK_BYTES = 25_000_000;

/**
 * Rights Officer v0. 'pass' means the AUTOMATED checks found no obstacle; it is never an approval.
 * The terms-of-use check is always left to the human (a warn finding), as the Scout playbook requires.
 */
export function assessRights(f: ProbeFacts, host: string): RightsAssessment {
  const out: Finding[] = [];
  if (f.resolvedPrivate) out.push({ level: 'block', text: 'The host resolves to a private network address. Not fetched.' });
  if (f.robots === 'blocked') out.push({ level: 'block', text: `robots.txt on ${host} disallows this path for RogueBot.` });
  else out.push({ level: 'ok', text: 'robots.txt allows this path.' });
  if (f.tdmReserved) out.push({ level: 'block', text: 'The site reserves text and data mining rights (tdmrep.json).' });
  if (f.optOut) out.push({ level: 'block', text: `Rights-holder opt-out signal: ${f.optOut}.` });
  if (!f.resolvedPrivate && f.robots === 'allowed' && !f.tdmReserved && !f.optOut) out.push({ level: 'ok', text: 'No TDM reservation or noai signal found.' });
  let problem = false;
  if (f.status === null) { out.push({ level: 'warn', text: 'The file could not be reached.' }); problem = true; }
  else if (f.status >= 400) { out.push({ level: 'warn', text: `The file answers HTTP ${f.status}.` }); problem = true; }
  else out.push({ level: 'ok', text: `The file answers HTTP ${f.status}.` });
  if (f.status !== null && f.status < 400) {
    const ct = (f.contentType ?? '').toLowerCase();
    if (ct && !/pdf|html/.test(ct)) { out.push({ level: 'warn', text: `Content type ${ct} is not a PDF or web page.` }); problem = true; }
    else if (!ct) out.push({ level: 'warn', text: 'No content type reported; it is checked again when fetched.' });
    else out.push({ level: 'ok', text: `Content type ${ct}.` });
    if (f.contentLength !== null && f.contentLength > MAX_RULEBOOK_BYTES) { out.push({ level: 'warn', text: 'The file is larger than the 25 MB cap.' }); problem = true; }
  }
  if (f.redirectHost) { out.push({ level: 'warn', text: `The link redirects to ${f.redirectHost}. Submit the final link instead.` }); problem = true; }
  const blocked = out.some((x) => x.level === 'block');
  return { verdict: blocked ? 'blocked' : problem ? 'problem' : 'pass', findings: out };
}
