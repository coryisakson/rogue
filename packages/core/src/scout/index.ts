/**
 * Scout, pure parts (docs/SCOUT_PLAYBOOK.md steps 2, 3 and 4).
 * No I/O: the web app fetches pages through the rights gate and hands the text here.
 * The Scout only PROPOSES candidates and flags; rights checks and approval stay with code and a human.
 */

export type DocRole = 'rulebook' | 'faq' | 'errata' | 'quickstart' | 'variant' | 'scenario' | 'other';

export interface PageLink { url: string; text: string }
export interface DocCandidate extends PageLink { role: DocRole; score: number; why: string; isPdf: boolean }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Every http(s) link on a page, resolved against the page address, de-duplicated, fragments dropped. */
export function extractLinks(html: string, baseUrl: string): PageLink[] {
  const seen = new Set<string>();
  const out: PageLink[] = [];
  const re = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(' ' + (m[1] ?? ''));
    const raw = decode((href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim());
    if (!raw || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
    let u: URL;
    try { u = new URL(raw, baseUrl); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    u.hash = '';
    const url = u.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const label = decode((m[2] ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    // An image-only link still has a hint in the file name.
    out.push({ url, text: label.slice(0, 160) });
  }
  return out;
}

const fileName = (url: string): string => {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/[_+-]+/g, ' ').toLowerCase(); } catch { return ''; }
};

// Word lists per role. Multi-language where it is cheap (de/fr/es); the Scout playbook says rulebook first.
const ROLE_WORDS: [DocRole, RegExp, number][] = [
  ['errata', /\b(errata|erratum|corrections?|korrektur)\b/, 70],
  ['faq', /\b(faq|f\.a\.q|frequently asked|questions|fragen)\b/, 75],
  ['quickstart', /\b(quick ?start|quick ?play|quick ?reference|learn to play|how to play|schnellstart|kurzanleitung|aide de jeu)\b/, 60],
  ['scenario', /\b(scenarios?|szenarios?|puzzles?|campaign|mission)\b/, 15],
  ['variant', /\b(solo|variant|variante|expansion|erweiterung|co-?op|team play|2 player|two player)\b/, 30],
  ['rulebook', /\b(rule ?books?|rules?|manual|spielregel\w*|spielanleitung|anleitung|regelheft|r[eè]gles?|reglas?|reglamento|instructions?)\b/, 100],
];
const NOISE = /\b(privacy|cookie|terms|imprint|impressum|contact|newsletter|login|cart|shop|buy|store|facebook|twitter|instagram|youtube|discord|press|careers)\b/;

/** Rate one link as a possible game document. Returns null for links that are plainly not documents. */
export function classifyLink(link: PageLink): DocCandidate | null {
  let path = '';
  try { path = new URL(link.url).pathname.toLowerCase(); } catch { return null; }
  const isPdf = /\.pdf$/.test(path);
  const label = `${link.text} ${fileName(link.url)}`.toLowerCase();
  if (!isPdf && NOISE.test(label)) return null;
  let role: DocRole = 'other';
  let score = 0;
  const reasons: string[] = [];
  // The strongest role word in the label wins; the rulebook word is only the default for PDFs.
  for (const [r, re, base] of ROLE_WORDS) {
    if (re.test(label)) {
      if (r === 'rulebook' && role !== 'other') continue; // a more specific role already matched ("quick start rules")
      role = r; score = base; reasons.push(`label mentions ${r}`);
      if (r !== 'rulebook') break;
    }
  }
  if (isPdf) { score += 20; reasons.push('is a PDF'); if (role === 'other') { score = 10; } }
  else if (role === 'other') return null; // a normal web link with no role word: not a candidate
  else { score -= 25; reasons.push('web page, not a file'); }
  if (/\b(lang|language)\b|\b(fr|de|es|it|pl|nl|pt|ru|ja|zh|ko)\b[ _.-]*(rules|rulebook)?\.pdf$/.test(path) && !/\ben\b/.test(label)) { score -= 5; reasons.push('may not be English'); }
  return { ...link, role, score, why: reasons.join(', '), isPdf };
}

/** Candidates best-first. The rulebook leads (playbook step 3); scenarios and puzzles sink to the bottom. */
export function rankCandidates(links: PageLink[], gameName = ''): DocCandidate[] {
  const words = gameName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const rolePriority: Record<DocRole, number> = { rulebook: 5, errata: 4, faq: 4, quickstart: 3, variant: 2, other: 1, scenario: 0 };
  return links
    .map(classifyLink)
    .filter((c): c is DocCandidate => c !== null)
    .map((c) => {
      const hay = `${c.text} ${fileName(c.url)}`.toLowerCase();
      const hit = words.some((w) => hay.includes(w));
      return hit ? { ...c, score: c.score + 10, why: `${c.why}, names the game` } : c;
    })
    .sort((a, b) => rolePriority[b.role] - rolePriority[a.role] || b.score - a.score || a.url.localeCompare(b.url));
}

/** Link to a terms-of-use / legal page, if the publisher page has one (playbook step 4). */
export function findTermsLink(links: PageLink[]): PageLink | null {
  const re = /\b(terms( of (use|service|sale))?|conditions|legal( notice)?|nutzungsbedingungen|agb|cgu|conditions d.utilisation)\b/i;
  return links.find((l) => re.test(l.text) || /\/(terms|tos|legal|conditions)[^/]*\/?$/i.test(new URL(l.url).pathname)) ?? null;
}

export interface TermsFlag { kind: 'bot' | 'ai' | 'copy' | 'permission'; excerpt: string }

const TERMS_PATTERNS: [TermsFlag['kind'], RegExp][] = [
  ['bot', /\b(robots?|spiders?|crawl\w*|scrap\w*|bots?|data mining|automated (means|access|tools?|queries))\b/i],
  ['ai', /\b(artificial intelligence|machine learning|\bAI\b|train\w* (an? )?(model|system)|large language model|LLMs?|text and data mining|TDM)\b/i],
  ['copy', /\b(reproduc\w+|redistribut\w+|republish\w*|copy|copies|copying|download\w*)\b[^.]{0,80}\b(without|prohibit\w*|not (be )?permitted|forbidden|written (consent|permission))/i],
  ['permission', /\b(written (consent|permission)|prior (written )?(consent|permission)|express(ly)? permission)\b/i],
];

/**
 * Flag terms-of-use sentences a human must read. This never approves anything: no flags is
 * NOT a green light (the checkbox on approve stays), flags just say where to look first.
 */
export function flagTerms(text: string, limit = 12): TermsFlag[] {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.;:!?])\s+(?=[A-Z0-9(“"])/);
  const out: TermsFlag[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    if (s.length < 25 || s.length > 600) continue;
    for (const [kind, re] of TERMS_PATTERNS) {
      if (!re.test(s)) continue;
      const key = `${kind}:${s.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, excerpt: s.length > 300 ? s.slice(0, 297) + '...' : s });
      if (out.length >= limit) return out;
      break; // one flag per sentence is enough
    }
  }
  return out;
}
