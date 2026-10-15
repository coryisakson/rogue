/** Curated, publisher-linked starting sources per game. The Scout agent will propose more; this list is the human-approved seed. */
export interface SourceSeed {
  gameSlug: string;
  url: string;
  title: string;
  publisher: string;
  language: string;
  kind: 'rulebook' | 'faq' | 'errata' | 'quickstart' | 'other';
  editionLabel: string;
  /** Page on the publisher site where the document was found (provenance). */
  foundOn: string;
}

export const ALLOWED_HOSTS = ['cdn.svc.asmodee.net', 'www.zmangames.com', 'contentiongames.com'];

export const SEEDS: SourceSeed[] = [
  {
    gameSlug: 'pandemic',
    url: 'https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/Pandemic_Rulebook.pdf',
    title: 'Pandemic Rulebook',
    publisher: 'Z-Man Games',
    language: 'en',
    kind: 'rulebook',
    editionLabel: 'Z-Man rulebook (publisher site, 2024-09 upload)',
    foundOn: 'https://www.zmangames.com/game/pandemic/',
  },
  {
    // First HTML source: the publisher's own product page (box contents, player count, age, play time). Ranked below the rulebook.
    gameSlug: 'pandemic',
    url: 'https://www.zmangames.com/game/pandemic/',
    title: 'Pandemic product page (Z-Man Games)',
    publisher: 'Z-Man Games',
    language: 'en',
    kind: 'other',
    editionLabel: 'Z-Man product page (publisher site)',
    foundOn: 'https://www.zmangames.com/game/pandemic/',
  },
  {
    gameSlug: 'slay-the-spire',
    url: 'https://contentiongames.com/_images/STS_KS_Rulebook.pdf',
    title: 'Slay the Spire: The Board Game Rulebook',
    publisher: 'Contention Games',
    language: 'en',
    kind: 'rulebook',
    editionLabel: 'Contention Games rulebook (publisher site, file dated 2024-03-23)',
    foundOn: 'https://contentiongames.com/games/slay/',
  },
];
