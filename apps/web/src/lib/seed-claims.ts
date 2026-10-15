import { ensureMigrated, getPool, storage } from './services';

/**
 * Hand-checked starter claims (own words, short quotes) so the MVP has real content before the Librarian agent exists.
 * Every quote is verified against the extracted rulebook text before insert; a claim whose quote is not found is skipped.
 * created_by='hermes-seed' marks them as unreviewed AI drafts; pages show that.
 */
interface SeedClaim { topic: string; playerCount?: number; body: string; page: number; quote: string; sort: number }

export const PANDEMIC_CLAIMS: SeedClaim[] = [
  { sort: 1, topic: 'goal', body: 'Cooperative game: everyone wins or loses together. Win by discovering cures for all 4 diseases (blue, yellow, black, red).', page: 1, quote: 'Pandemic is a cooperative game. The players all win or lose together.' },
  { sort: 2, topic: 'lose', body: 'You lose if 8 outbreaks occur, if the cubes of a colour run out when you need one, or if the player deck runs out when you must draw.', page: 1, quote: '8 outbreaks occur' },
  { sort: 3, topic: 'setup', body: 'Put the board within reach. Keep the 6 research stations and the disease cubes (sorted into 4 colour piles) nearby. Place 1 research station in Atlanta.', page: 2, quote: 'Place 1 research station in Atlanta.' },
  { sort: 4, topic: 'setup', body: 'Put the outbreak marker on the 0 space of the Outbreaks Track, and the 4 cure markers vial side up near the Discovered Cure Indicators.', page: 2, quote: 'Place the outbreaks marker on the “0” space of the' },
  { sort: 5, topic: 'setup', body: 'Each player gets a reference card. Shuffle the role cards and deal one face up to each player. Put the matching pawns in Atlanta and remove the unused roles and pawns from the game.', page: 2, quote: 'Place the matching' },
  { sort: 6, topic: 'player_count_variant', playerCount: 2, body: 'In a 2-player game each player starts with 4 cards.', page: 2, quote: '2-player game 4' },
  { sort: 7, topic: 'player_count_variant', playerCount: 3, body: 'In a 3-player game each player starts with 3 cards.', page: 2, quote: '3-player game 3' },
  { sort: 8, topic: 'player_count_variant', playerCount: 4, body: 'In a 4-player game each player starts with 2 cards.', page: 2, quote: '4-player game 2' },
  { sort: 9, topic: 'setup', body: 'Take the epidemic cards out of the player deck. Shuffle the remaining city and event cards and deal starting hands according to player count.', page: 2, quote: 'Take the Epidemic cards out' },
  { sort: 10, topic: 'setup', body: 'Infection rate marker goes on the left-most "2" space. Shuffle the infection deck and flip 3 cards, putting 3 cubes of the matching colour on each of those cities. Flip 3 more with 2 cubes each, then 3 more with 1 cube each: 9 cities and 18 cubes in total. Those 9 cards go face up in the infection discard pile.', page: 3, quote: 'Place the infection rate marker on the left-most' },
  { sort: 11, topic: 'setup', body: 'Choose difficulty by the number of epidemic cards: 4 (Introductory), 5 (Standard) or 6 (Heroic). The rulebook suggests 4 for a first game.', page: 3, quote: 'Use 4 Epidemic cards' },
  { sort: 12, topic: 'setup', body: 'Build the player deck: split the remaining player cards into as many equal-as-possible face-down piles as you have epidemic cards, shuffle one epidemic card into each pile, then stack the piles with the smaller ones on the bottom.', page: 3, quote: 'Shuffle 1 Epidemic card into each pile' },
  { sort: 13, topic: 'setup', body: 'First player is the one holding the city card with the highest population.', page: 3, quote: 'The player with the highest City population goes first.' },
  { sort: 14, topic: 'turn', body: 'A turn has three parts: do 4 actions, draw 2 player cards (resolving epidemics and discarding down to 7 cards), then infect cities. Play passes to the left.', page: 3, quote: 'Do 4 actions.' },
];

export async function seedPandemicClaims(): Promise<{ inserted: number; skipped: string[] }> {
  const pool = getPool();
  if (!pool) throw new Error('database not configured');
  await ensureMigrated();
  const doc = (await pool.query(
    `SELECT d.id doc_id, d.edition_id, s.text_path FROM documents d JOIN sources s ON s.id=d.source_id JOIN editions e ON e.id=d.edition_id JOIN games g ON g.id=e.game_id
     WHERE g.slug='pandemic' AND d.kind='rulebook' AND s.text_path IS NOT NULL ORDER BY d.id LIMIT 1`,
  )).rows[0];
  if (!doc) throw new Error('pandemic rulebook text not ingested yet (POST /api/admin/ingest?game=pandemic)');
  const raw = await storage.get(doc.text_path);
  if (!raw) throw new Error('text file missing');
  const pages = new TextDecoder().decode(raw).split(/\n\n=== page (\d+) ===\n/);
  const pageText = new Map<number, string>();
  for (let i = 1; i < pages.length; i += 2) pageText.set(Number(pages[i]), norm(pages[i + 1] ?? ''));

  let inserted = 0;
  const skipped: string[] = [];
  for (const c of PANDEMIC_CLAIMS) {
    if (!(pageText.get(c.page) ?? '').includes(norm(c.quote))) { skipped.push(`#${c.sort}: quote not found on p.${c.page}`); continue; }
    const exists = await pool.query("SELECT 1 FROM claims WHERE edition_id=$1 AND body=$2", [doc.edition_id, c.body]);
    if (exists.rowCount) continue;
    const cl = await pool.query(
      "INSERT INTO claims(edition_id, topic, player_count, body, status, created_by) VALUES ($1,$2,$3,$4,'draft','hermes-seed') RETURNING id",
      [doc.edition_id, c.topic, c.playerCount ?? null, c.body],
    );
    await pool.query('INSERT INTO citations(claim_id, document_id, locator, quote) VALUES ($1,$2,$3,$4)', [cl.rows[0].id, doc.doc_id, `p.${c.page}`, c.quote]);
    await pool.query("UPDATE claims SET status='published' WHERE id=$1", [cl.rows[0].id]);
    inserted++;
  }
  await pool.query('INSERT INTO audit_log(actor, action, detail) VALUES ($1,$2,$3)', ['seed', 'seed_claims', { game: 'pandemic', inserted, skipped }]);
  return { inserted, skipped };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
