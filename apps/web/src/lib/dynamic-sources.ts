import { runtimeSeed } from '@rogue/core';
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
  // Accepted text versions of rulebooks (found by the Scout agent): same game and edition as the PDF they mirror.
  const variants = (await pool.query(
    `SELECT g.slug, tv.url, s.publisher, s.language, e.label FROM text_variants tv JOIN sources s ON s.id=tv.source_id
     JOIN documents d ON d.source_id=s.id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id WHERE tv.status='accepted'`)).rows;
  const vseeds: SourceSeed[] = variants.map((v) => ({
    gameSlug: v.slug, url: v.url, title: `${v.slug} rules (text version)`, publisher: v.publisher ?? '', language: v.language ?? 'en', kind: 'rulebook' as const, editionLabel: v.label, foundOn: v.url,
  }));
  // Rules links an admin added to an existing game on /admin/sources (after the same rights gates, migration 0038).
  const runtime: SourceSeed[] = (await pool.query('SELECT game_slug, url, title, publisher, language, kind, edition_label, found_on FROM runtime_sources ORDER BY id')).rows.map(runtimeSeed);
  const all = [...SEEDS, ...dynamic, ...runtime, ...vseeds];
  return all.filter((x, i) => all.findIndex((y) => y.url === x.url) === i);
}
