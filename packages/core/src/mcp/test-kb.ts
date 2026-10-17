/** In-memory PublicKb for tests (public-tools.test.ts, sdk.e2e.test.ts). Not used by the app. */
import type { KbFact, KbSource, PublicKb } from './public-tools.js';

const RULES = 'https://publisher.example/pandemic-rules.pdf';
const fact = (id: string, topic: string, body: string, page: string): KbFact =>
  ({ id, topic, player_count: null, body, verified_at: id === '1' ? '2026-10-01' : null, locator: page, quote: `${body} (quoted)`, source_title: 'Pandemic Rulebook', source_url: RULES, publisher: 'Z-Man' });

export function fakeKb(): PublicKb {
  const facts: KbFact[] = [
    fact('1', 'goal', 'Discover cures for all 4 diseases to win.', 'p.2'),
    fact('2', 'lose', 'You lose after the 8th outbreak.', 'p.8'),
    fact('3', 'setup', 'Place 3 cubes on each of the first 3 infected cities.', 'p.4'),
    fact('4', 'turn', 'Take 4 actions, draw 2 cards, then infect cities.', 'p.5'),
    fact('5', 'actions', 'Drive or ferry to an adjacent city.', 'p.6'),
  ];
  const sources: KbSource[] = [
    { slug: 'pandemic', title: 'Pandemic Rulebook', url: RULES, publisher: 'Z-Man', kind: 'rulebook', language: 'en', page_count: 8, availability: 'available' },
    { slug: 'azul', title: null, url: 'https://publisher.example/azul.pdf', publisher: null, kind: 'rulebook', language: 'de', page_count: null, availability: 'available' },
  ];
  return {
    baseUrl: 'https://rogue.test',
    listGames: async () => [
      { slug: 'pandemic', name: 'Pandemic', publisher: 'Z-Man', year: 2008, min_players: 2, max_players: 4, card_size: null, claim_count: facts.length },
      { slug: 'empty', name: 'Empty Game', publisher: null, year: null, min_players: null, max_players: null, card_size: null, claim_count: 0 },
    ],
    getFacts: async (slug, o = {}) => (slug === 'pandemic' ? facts : []).filter((f) => (!o.topic || f.topic === o.topic) && (!o.q || f.body.toLowerCase().includes(o.q.toLowerCase()))),
    searchFacts: async (q) => facts.filter((f) => f.body.toLowerCase().includes(q.toLowerCase())).map((f) => ({ slug: 'pandemic', game: 'Pandemic', ...f })),
    listSources: async (slug) => sources.filter((s) => !slug || s.slug === slug),
    askRules: async () => ({ answer: 'Cure all 4 diseases (p.2).', sources: [{ page: 2, printed: null, section: 'Goal', title: 'Pandemic Rulebook', url: RULES, publisher: 'Z-Man', quote: 'Discover cures...' }] }),
    searchRules: async (q) => (q === 'nothing' ? [] : [{ slug: 'pandemic', game: 'Pandemic', page: 8, printed: 7, section: 'Outbreaks', snippet: 'When a city would get a 4th cube, an outbreak occurs.', source_title: 'Pandemic Rulebook', source_url: RULES, publisher: 'Z-Man' }]),
  };
}
