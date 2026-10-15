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

export const ALLOWED_HOSTS = ['cdn.svc.asmodee.net', 'www.zmangames.com'];

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
];
