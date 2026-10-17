# BGG top 10 (admin-approved intake list)

- Date: 2026-10-17
- Source: https://boardgamegeek.com/browse/boardgame (read by hand; Rogue never scrapes BGG pages)
- Approval: Cory, "Admin approved!", 2026-10-17
- Code copy: `BGG_TOP10` in `packages/core/src/intake/bgg-top10.ts` (keep both in sync)

| Rank | BGG id | Title | Year |
|---|---|---|---|
| 1 | 224517 | Brass: Birmingham | 2018 |
| 2 | 342942 | Ark Nova | 2021 |
| 3 | 161936 | Pandemic Legacy: Season 1 | 2015 |
| 4 | 174430 | Gloomhaven | 2017 |
| 5 | 397598 | Dune: Imperium - Uprising | 2023 |
| 6 | 316554 | Dune: Imperium | 2020 |
| 7 | 233078 | Twilight Imperium: Fourth Edition | 2017 |
| 8 | 115746 | War of the Ring: Second Edition | 2011 |
| 9 | 167791 | Terraforming Mars | 2016 |
| 10 | 187645 | Star Wars: Rebellion | 2016 |

## How it is used
`/admin/requests` button "Queue BGG top 10" (or `POST /api/admin/queue-top10` with the admin token) creates one
approved 'pick' request per game not yet in Rogue or requested, then the normal flow runs per game:
Scout -> Rights Officer -> Terms Agent (admin decides unclear terms) -> ingest -> index -> Librarian.
Running it again adds nothing. Ranks drift over time: refresh this list (and the constant) by hand with a new
admin approval before reusing it.
