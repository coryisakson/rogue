import { describe, expect, it } from 'vitest';
import {
  extractNote, gameMatches, isLowPage, lastActivity, mergeTimeline, normalizeGameQuery, pageSourceCounts, recentGames, searchGames, summarizeQuality, type IngestedGame,
} from './admin-games.js';

const d = (s: string) => new Date(s);
const game = (slug: string, name: string, createdAt: string | null, lastFetchedAt: string | null = null, lastDecidedAt: string | null = null): IngestedGame => ({
  slug, name, createdAt: createdAt ? d(createdAt) : null, lastFetchedAt: lastFetchedAt ? d(lastFetchedAt) : null, lastDecidedAt: lastDecidedAt ? d(lastDecidedAt) : null,
});

describe('admin games: search', () => {
  const games = [game('pandemic', 'Pandemic', null), game('slay-the-spire', 'Slay the Spire', null), game('azul', 'Azul', null), game('pandemic-legacy', 'Legacy: Pandemic', null)];
  it('normalizes the query', () => {
    expect(normalizeGameQuery('  slay   the\tspire ')).toBe('slay the spire');
    expect(normalizeGameQuery(null)).toBe('');
    expect(normalizeGameQuery('x'.repeat(200))).toHaveLength(80);
  });
  it('matches name or slug case-insensitively', () => {
    expect(gameMatches(games[0]!, 'PANDEM')).toBe(true);
    expect(gameMatches(games[1]!, 'slay-the')).toBe(true);
    expect(gameMatches(games[1]!, 'SLAY THE')).toBe(true);
    expect(gameMatches(games[2]!, 'pandemic')).toBe(false);
    expect(gameMatches(games[2]!, '   ')).toBe(false);
  });
  it('puts names starting with the query first and respects the limit', () => {
    expect(searchGames(games, 'pandemic').map((g) => g.slug)).toEqual(['pandemic', 'pandemic-legacy']);
    expect(searchGames(games, 'a', 2)).toHaveLength(2);
    expect(searchGames(games, '')).toEqual([]);
  });
});

describe('admin games: recency', () => {
  it('takes the latest of created, fetched and decided', () => {
    expect(lastActivity(game('a', 'A', '2026-01-01', '2026-03-01', '2026-02-01'))).toEqual(d('2026-03-01'));
    expect(lastActivity(game('a', 'A', null))).toBeNull();
  });
  it('orders newest first, undated last, ties by name, capped', () => {
    const list = [
      game('old', 'Old', '2025-01-01'),
      game('none', 'None', null),
      game('fetched', 'Fetched', '2025-01-01', '2026-10-10'),
      game('b', 'B', '2026-05-01'),
      game('a', 'A', '2026-05-01'),
      game('decided', 'Decided', '2025-01-01', null, '2026-10-17'),
    ];
    expect(recentGames(list).map((g) => g.slug)).toEqual(['decided', 'fetched', 'a', 'b', 'old', 'none']);
    expect(recentGames(list, 2).map((g) => g.slug)).toEqual(['decided', 'fetched']);
  });
});

describe('admin games: timeline', () => {
  it('merges newest first, undated last, drops duplicate keys', () => {
    const t = mergeTimeline(
      [{ at: d('2026-10-01'), kind: 'request', text: 'asked', key: 'r1' }, { at: null, kind: 'source', text: 'never fetched', key: 's2' }],
      [{ at: d('2026-10-05'), kind: 'audit', text: 'fetched', key: 'a9' }, { at: d('2026-10-01'), kind: 'request', text: 'asked again', key: 'r1' }],
    );
    expect(t.map((e) => e.key)).toEqual(['a9', 'r1', 's2']);
    expect(t.find((e) => e.key === 'r1')?.text).toBe('asked');
  });
  it('keeps a stable order on equal times', () => {
    const at = d('2026-10-01');
    expect(mergeTimeline([{ at, kind: 'x', text: '', key: 'a1' }, { at, kind: 'x', text: '', key: 'a2' }]).map((e) => e.key)).toEqual(['a2', 'a1']);
  });
});

describe('admin games: extract note', () => {
  it('reads OCR pages and errors from the fetched audit detail', () => {
    expect(extractNote({ ocrPages: [1, 2, 3] })).toBe('OCR, 3 pages');
    expect(extractNote({ ocrPages: [], ocrErrors: ['x'] })).toBe('text layer (OCR errors)');
    expect(extractNote({})).toBe('text layer');
    expect(extractNote(null)).toBe('unknown');
  });
});

describe('admin games: text quality summary', () => {
  const p = (page: number, score: number, verdict = 'ok') => ({ page, score, verdict });
  it('averages, counts low pages and lists the worst ones', () => {
    const q = summarizeQuality([p(1, 0.9), p(2, 0.2, 'garbled'), p(3, 0.5, 'suspect'), p(4, 0, 'empty'), p(5, 0.5, 'suspect')], 3);
    expect(q.pages).toBe(5);
    expect(q.avg).toBe(0.42);
    expect(q.low).toBe(4);
    expect(q.worst.map((x) => x.page)).toEqual([4, 2, 3]);
  });
  it('says nothing is known when no page was scored', () => {
    expect(summarizeQuality([])).toEqual({ pages: 0, avg: null, low: 0, worst: [] });
  });
  it('never lists an ok page as worst', () => {
    expect(summarizeQuality([p(1, 0.6), p(2, 0.7)]).worst).toEqual([]);
    expect(isLowPage({ verdict: 'ok' })).toBe(false);
  });
});

describe('admin games: text layer vs OCR pages', () => {
  it('prefers the per-page list', () => {
    expect(pageSourceCounts({ pageSource: ['text', 'ocr', 'ocr'], ocrPages: [9] })).toEqual({ textLayer: 1, ocr: 2 });
  });
  it('falls back to the page number lists', () => {
    expect(pageSourceCounts({ ocrPages: [1, 2] })).toEqual({ textLayer: 0, ocr: 2 });
    expect(pageSourceCounts({ textLayerPages: [1], ocrPages: [] })).toEqual({ textLayer: 1, ocr: 0 });
  });
  it('is unknown without an entry or without page data', () => {
    expect(pageSourceCounts(null)).toBeNull();
    expect(pageSourceCounts({ pages: 4 })).toBeNull();
  });
});
