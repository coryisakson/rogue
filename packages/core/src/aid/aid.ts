/**
 * Player aid v0: a card-sized reminder of a turn, built from the same cited claims as the setup one-pager.
 *
 * Why: a setup sheet is read once; a player aid sits in front of each player all game. It only holds short
 * turn and reminder lines. Like the sheet fit solver (sheet.ts), we estimate each claim's line count from its
 * text length and fill sections until the size's line budget is used. Every chosen line keeps its page cite;
 * what does not fit is counted, never cut mid-sentence (a shortened claim could change the rule).
 */
import { estimateLines, type SheetClaim } from '../sheet/sheet.js';

export interface CardSize {
  key: string;
  label: string;
  /** CSS lengths for @page and the card box, e.g. '63mm'. */
  width: string; height: string;
  /** Same size in inches, for the budget estimate and the N-up layout. */
  widthIn: number; heightIn: number;
  /** Starting font size; the page's fit script may shrink it a little. */
  fontPt: number;
  /** True for card stock sizes that can be tiled on a letter sheet. */
  card: boolean;
}

const MM = 1 / 25.4;
const mm = (key: string, label: string, w: number, h: number, fontPt: number): CardSize =>
  ({ key, label, width: `${w}mm`, height: `${h}mm`, widthIn: w * MM, heightIn: h * MM, fontPt, card: true });
const inch = (key: string, label: string, w: number, h: number, fontPt: number): CardSize =>
  ({ key, label, width: `${w}in`, height: `${h}in`, widthIn: w, heightIn: h, fontPt, card: false });

export const CARD_SIZES: Record<string, CardSize> = {
  poker: mm('poker', 'Poker card (63×88 mm)', 63, 88, 7),
  mini: mm('mini', 'Mini card (44×68 mm)', 44, 68, 6.5),
  tarot: mm('tarot', 'Tarot card (70×120 mm)', 70, 120, 7.5),
  page: inch('page', 'Half-letter (5.5×8.5 in)', 5.5, 8.5, 8.6),
  letter: inch('letter', 'Letter (8.5×11 in)', 8.5, 11, 10),
};
export const DEFAULT_CARD_SIZE = 'poker';

/** A valid preset key from user input, else the game's own size, else poker. */
export function resolveCardSize(raw: string | null | undefined, gameDefault?: string | null): CardSize {
  return CARD_SIZES[raw ?? ''] ?? CARD_SIZES[gameDefault ?? ''] ?? CARD_SIZES[DEFAULT_CARD_SIZE]!;
}

/** Turn first, then the things players forget. Shares of the line budget; empty sections hand theirs on. */
export const AID_SECTIONS = [
  { key: 'turn', title: 'On your turn', topics: ['turn'], share: 0.4 },
  { key: 'actions', title: 'Actions', topics: ['actions'], share: 0.3 },
  { key: 'end', title: 'Win / lose', topics: ['goal', 'win', 'lose'], share: 0.15 },
  { key: 'remember', title: 'Remember', topics: ['special_rule'], share: 0.15 },
] as const;

export interface AidLine { id: string; text: string; page: string | null }
export interface AidSection { key: string; title: string; lines: AidLine[]; omitted: number }
export interface Aid { title: string; sections: AidSection[]; size: CardSize; budget: number; usedLines: number; omitted: number }

/**
 * Text capacity of a size. Assumes ~0.5em average glyph width and 1.25 line height, a 0.12in padding,
 * and room for the title and the source footer. Rough on purpose; the page's fit script handles the rest.
 */
export function aidBudget(size: CardSize): { charsPerLine: number; lines: number; maxCharsPerItem: number } {
  const ptPerIn = 72, pad = 0.12 * 2, chrome = 0.55 * (size.fontPt / 7);
  const charsPerLine = Math.max(10, Math.floor(((size.widthIn - pad) * ptPerIn) / (size.fontPt * 0.5)));
  const lines = Math.max(4, Math.floor(((size.heightIn - pad - chrome) * ptPerIn) / (size.fontPt * 1.25)));
  // Small cards take only short lines: a 3-line item on a mini card would crowd out everything else.
  const linesPerItem = Math.min(5, Math.max(2, Math.round(lines / 7)));
  return { charsPerLine, lines, maxCharsPerItem: charsPerLine * linesPerItem };
}

const pageNum = (c: SheetClaim) => Number(c.locator?.match(/\d+/)?.[0] ?? 999);
function priority(c: SheetClaim): number {
  const trusted = c.created_by && !c.created_by.startsWith('librarian') ? 1 : 0;
  return trusted * 10 + (c.avg_stars ?? 3);
}

export function buildAid(claims: SheetClaim[], sizeKey: string | null | undefined, title = 'Player aid'): Aid {
  const size = resolveCardSize(sizeKey);
  const { charsPerLine, lines: budget, maxCharsPerItem } = aidBudget(size);
  const seen = new Set<string>();
  const pools = AID_SECTIONS.map((s) => claims
    .filter((c) => (s.topics as readonly string[]).includes(c.topic))
    .filter((c) => (seen.has(c.body.toLowerCase()) ? false : (seen.add(c.body.toLowerCase()), true)))
    // Shortest wins among equals: an aid wants many small reminders, not one long paragraph.
    .sort((a, b) => priority(b) - priority(a) || a.body.length - b.body.length || pageNum(a) - pageNum(b)));
  const shareTotal = AID_SECTIONS.reduce((n, s, i) => n + (pools[i]!.length ? s.share : 0), 0) || 1;
  let used = 0, omitted = 0;
  const sections = AID_SECTIONS.map((s, i) => {
    const pool = pools[i]!;
    const room = (budget * s.share) / shareTotal + 0.5; // header line of the section counts too
    const chosen: SheetClaim[] = []; let spent = 1;
    for (const c of pool) {
      if (c.body.length > maxCharsPerItem) continue;
      const n = estimateLines(c.body, charsPerLine);
      if (spent + n > room) continue;
      chosen.push(c); spent += n;
    }
    if (chosen.length) used += spent;
    omitted += pool.length - chosen.length;
    chosen.sort((a, b) => pageNum(a) - pageNum(b) || Number(a.id) - Number(b.id));
    return { key: s.key, title: s.title, lines: chosen.map((c) => ({ id: c.id, text: c.body, page: c.locator })), omitted: pool.length - chosen.length };
  });
  return { title, sections, size, budget, usedLines: Math.round(used * 10) / 10, omitted };
}

/** How many copies of a card fit on a letter sheet (0.25in margin), for the cut-out sheet. */
export function nUp(size: CardSize): { cols: number; rows: number; count: number } {
  const cols = Math.max(1, Math.floor((8.5 - 0.5) / size.widthIn));
  const rows = Math.max(1, Math.floor((11 - 0.5) / size.heightIn));
  return { cols, rows, count: cols * rows };
}
