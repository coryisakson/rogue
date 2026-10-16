import { describe, it, expect } from 'vitest';
import { aidBudget, buildAid, CARD_SIZES, nUp, resolveCardSize } from './aid';
import type { SheetClaim } from '../sheet/sheet';

const mk = (id: number, topic: string, body: string, extra: Partial<SheetClaim> = {}): SheetClaim => ({ id: String(id), topic, body, locator: `p.${id}`, ...extra });
const many = (topic: string, n: number, len: number) => Array.from({ length: n }, (_, i) => mk(i + 1, topic, `${topic} ${i} ` +'x'.repeat(len)));

describe('buildAid', () => {
  it('stays inside the size budget and counts what it left out', () => {
    for (const key of Object.keys(CARD_SIZES)) {
      const aid = buildAid([...many('turn', 60, 60), ...many('actions', 60, 60)], key);
      expect(aid.usedLines).toBeLessThanOrEqual(aid.budget + 1);
      const shown = aid.sections.reduce((n, s) => n + s.lines.length, 0);
      expect(shown + aid.omitted).toBe(120);
      expect(aid.omitted).toBe(aid.sections.reduce((n, s) => n + s.omitted, 0));
      expect(aid.omitted).toBeGreaterThan(0);
    }
  });
  it('gives a tiny size fewer and shorter lines', () => {
    const claims = [...many('turn', 30, 40), ...many('turn', 30, 150).map((c, i) => ({ ...c, id: String(100 + i) }))];
    const mini = buildAid(claims, 'mini'), letter = buildAid(claims, 'letter');
    const count = (a: typeof mini) => a.sections.reduce((n, s) => n + s.lines.length, 0);
    const longest = (a: typeof mini) => Math.max(...a.sections.flatMap((s) => s.lines.map((l) => l.text.length)));
    expect(count(mini)).toBeLessThan(count(letter));
    expect(longest(mini)).toBeLessThanOrEqual(aidBudget(CARD_SIZES['mini']!).maxCharsPerItem);
    expect(longest(mini)).toBeLessThan(longest(letter));
  });
  it('keeps every page cite and uses only turn and reminder topics', () => {
    const aid = buildAid([mk(4, 'turn', 'Take 4 actions.'), mk(2, 'setup', 'Shuffle the deck.'), mk(7, 'lose', 'You lose after 8 outbreaks.'), mk(9, 'special_rule', 'Hand limit is 7.')], 'poker');
    const lines = aid.sections.flatMap((s) => s.lines);
    expect(lines.map((l) => [l.id, l.page])).toEqual([['4', 'p.4'], ['7', 'p.7'], ['9', 'p.9']]);
  });
  it('drops duplicate lines', () => {
    const aid = buildAid([mk(1, 'turn', 'Draw two cards.'), mk(2, 'turn', 'draw two cards.')], 'poker');
    expect(aid.sections[0]!.lines).toHaveLength(1);
  });
  it('falls back to poker for an unknown size', () => {
    expect(buildAid([], 'banana').size.key).toBe('poker');
    expect(buildAid([], null).size.key).toBe('poker');
    expect(resolveCardSize('nope', 'tarot').key).toBe('tarot');
    expect(resolveCardSize('mini', 'tarot').key).toBe('mini');
    expect(resolveCardSize(undefined, 'bad').key).toBe('poker');
  });
});

describe('nUp', () => {
  it('tiles cards on a letter sheet', () => {
    expect(nUp(CARD_SIZES['poker']!)).toEqual({ cols: 3, rows: 3, count: 9 });
    expect(nUp(CARD_SIZES['mini']!).count).toBeGreaterThan(9);
    expect(nUp(CARD_SIZES['tarot']!).count).toBe(4);
  });
});
