import { describe, expect, it } from 'vitest';
import { BGG_TOP10, planTopGames } from './bgg-top10.js';

const none = { gameBggIds: [], gameSlugs: [], requestBggIds: [], requestSlugs: [] };

describe('BGG top 10', () => {
  it('holds ten ranked games with unique ids and slugs', () => {
    expect(BGG_TOP10.map((g) => g.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(BGG_TOP10.map((g) => g.bggId)).size).toBe(10);
    const { queue } = planTopGames(BGG_TOP10, none);
    expect(new Set(queue.map((g) => g.slug)).size).toBe(10);
    expect(queue[0]).toMatchObject({ bggId: 224517, title: 'Brass: Birmingham', slug: 'brass-birmingham', year: 2018 });
    expect(queue[4]!.slug).toBe('dune-imperium-uprising');
  });

  it('skips games in the library or already requested, by BGG id or slug, keeping list order', () => {
    const { queue, skipped } = planTopGames(BGG_TOP10, {
      gameBggIds: [224517], gameSlugs: ['ark-nova'], requestBggIds: [174430], requestSlugs: ['terraforming-mars'],
    });
    expect(skipped).toEqual([
      { title: 'Brass: Birmingham', reason: 'in library' },
      { title: 'Ark Nova', reason: 'in library' },
      { title: 'Gloomhaven', reason: 'already requested' },
      { title: 'Terraforming Mars', reason: 'already requested' },
    ]);
    expect(queue.map((g) => g.rank)).toEqual([3, 5, 6, 7, 8, 10]);
  });

  it('is idempotent: a second run after queueing plans nothing', () => {
    const first = planTopGames(BGG_TOP10, none).queue;
    const second = planTopGames(BGG_TOP10, { ...none, requestBggIds: first.map((g) => g.bggId), requestSlugs: first.map((g) => g.slug) });
    expect(second.queue).toEqual([]);
    expect(second.skipped).toHaveLength(10);
  });

  it('plans a duplicate inside the list once', () => {
    const g = BGG_TOP10[0]!;
    expect(planTopGames([g, { ...g, rank: 2 }], none).queue).toHaveLength(1);
  });
});
