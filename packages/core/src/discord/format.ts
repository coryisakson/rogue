/** Formatting replies for Discord. Hard limit is 2000 characters per message; citations are never cut. */
import { formatPageCite } from '../pagelabels.js';

export const DISCORD_LIMIT = 2000;

/** `printed` maps a physical page to the number printed in the book, when known (display only). */
export interface CitedSource { title: string; publisher?: string | null; url?: string | null; pages?: number[]; printed?: Record<number, number | null> }
export interface SetupSectionView { title: string; lines: { text: string; page: string | null }[] }

/** Cut `text` to at most `max` characters, ending with an ellipsis, preferring a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…'.slice(0, max);
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** Source footer: "Sources: Title (Publisher) p.3, 5 (printed 3)". Always shown, so claims never go out uncited. */
export function formatSources(sources: CitedSource[]): string {
  if (!sources.length) return '_No source found._';
  const merged = new Map<string, CitedSource & { pages: number[]; printed: Record<number, number | null> }>();
  for (const s of sources) {
    const key = `${s.title}|${s.publisher ?? ''}`;
    const m = merged.get(key) ?? { ...s, pages: [], printed: {} };
    for (const p of s.pages ?? []) if (!m.pages.includes(p)) m.pages.push(p);
    Object.assign(m.printed, s.printed);
    merged.set(key, m);
  }
  const parts = [...merged.values()].map((s) => {
    // "p." once, then bare numbers: "p.3, 5 (printed 3)".
    const cites = [...s.pages].sort((a, b) => a - b).map((p) => formatPageCite(p, s.printed[p]).replace(/^p\./, ''));
    const pages = cites.length ? ` p.${cites.join(', ')}` : '';
    return `${s.title}${s.publisher ? ` (${s.publisher})` : ''}${pages}`;
  });
  return `**Sources:** ${parts.join('; ')}`;
}

/** Body + footer within the limit: the body shrinks, the footer (citations and disclaimer) stays whole. */
export function withFooter(body: string, footer: string, limit = DISCORD_LIMIT): string {
  const room = limit - footer.length - 2;
  if (room < 20) return truncate(footer, limit);
  return `${truncate(body, room)}\n\n${footer}`;
}

const DISCLAIMER = '_AI-written from the publisher\'s rulebook; the rulebook is authoritative._';

/** Strip mass-mention triggers so a model answer can never ping @everyone. */
export function defang(text: string): string {
  return text.replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@[&!]?\d+>/g, '[mention]');
}

export function formatSetup(gameName: string, players: number | null, sections: SetupSectionView[], sources: CitedSource[]): string {
  const lines: string[] = [`**${gameName} · Setup${players ? ` (${players} players)` : ''}**`];
  for (const s of sections) {
    if (!s.lines.length) continue;
    lines.push(`\n__${s.title}__`);
    s.lines.forEach((l, i) => lines.push(`${i + 1}. ${l.text}${l.page ? ` [p.${String(l.page).replace(/^p\.?\s*/i, '')}]` : ''}`));
  }
  return withFooter(defang(lines.join('\n')), `${formatSources(sources)}\n${DISCLAIMER}`);
}

export function formatAnswer(question: string, answer: string, sources: CitedSource[], warning?: string): string {
  const head = `**Q:** ${truncate(question, 200)}\n\n${defang(answer)}`;
  const footer = [warning ? `⚠️ ${warning}` : '', formatSources(sources), DISCLAIMER].filter(Boolean).join('\n');
  return withFooter(head, footer);
}

/** Plain, short error text for users (never leaks internals). */
export function formatError(message: string): string {
  return truncate(`⚠️ ${defang(message)}`, DISCORD_LIMIT);
}
