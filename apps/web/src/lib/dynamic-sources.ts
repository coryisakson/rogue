import { ensureMigrated, getPool } from './services';
import { ALLOWED_HOSTS, SEEDS, type SourceSeed } from './source-seeds';

/**
 * Hosts and sources a human approved through the add-game flow. The static lists in source-seeds.ts stay the
 * built-in baseline; these rows extend them at runtime so the fetcher, recheck and curator all see them.
 */
export async function syncApprovedHosts(): Promise<void> {
  const pool = getPool(); if (!pool) return;
  await ensureMigrated();
  for (const r of (await pool.query('SELECT host FROM approved_hosts')).rows) if (!ALLOWED_HOSTS.includes(r.host)) ALLOWED_HOSTS.push(r.host);
}

export async function allSeeds(): Promise<SourceSeed[]> {
  const pool = getPool(); if (!pool) return SEEDS;
  await syncApprovedHosts();
  const rows = (await pool.query("SELECT slug, name, publisher, language, rulebook_url, found_on, to_char(decided_at,'YYYY-MM-DD') AS day FROM game_requests WHERE status='approved'")).rows;
  const dynamic: SourceSeed[] = rows.map((r) => ({
    gameSlug: r.slug, url: r.rulebook_url, title: `${r.name} Rulebook`, publisher: r.publisher, language: r.language, kind: 'rulebook',
    editionLabel: `${r.publisher} rulebook (user-submitted, admin-approved ${r.day})`, foundOn: r.found_on ?? r.rulebook_url,
  }));
  return [...SEEDS, ...dynamic.filter((d) => !SEEDS.some((s) => s.url === d.url))];
}
