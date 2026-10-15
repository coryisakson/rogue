import { describe, it, expect } from 'vitest';
import { buildSheet, estimateLines, type SheetClaim } from './sheet';

const mk = (id: number, topic: string, body: string, extra: Partial<SheetClaim> = {}): SheetClaim => ({ id: String(id), topic, body, locator: `p.${id}`, ...extra });

describe('buildSheet', () => {
  it('stays inside the line budget', () => {
    const claims = Array.from({ length: 100 }, (_, i) => mk(i, 'setup', `step ${i} ` + 'x'.repeat(120)));
    const s = buildSheet(claims, 44);
    expect(s.usedLines).toBeLessThanOrEqual(44);
    expect(s.sections.find((x) => x.key === 'setup')!.omitted).toBeGreaterThan(0);
  });
  it('prefers hand-checked claims over unrated librarian claims', () => {
    const s = buildSheet([
      mk(1, 'goal', 'a'.repeat(200), { created_by: 'librarian:m' }),
      mk(2, 'goal', 'b'.repeat(200), { created_by: 'hermes-seed' }),
    ], 40);
    expect(s.sections[0]!.lines.map((l) => l.id)).toEqual(['2']);
  });
  it('drops duplicates, keeps page locators, orders by page', () => {
    const s = buildSheet([mk(9, 'turn', 'Draw two cards.'), mk(3, 'turn', 'Do four actions.'), mk(5, 'turn', 'draw two cards.')]);
    const turn = s.sections.find((x) => x.key === 'turn')!;
    expect(turn.lines.map((l) => l.page)).toEqual(['p.3', 'p.9']);
  });
  it('estimates at least one line', () => { expect(estimateLines('')).toBeGreaterThan(1); });
});
