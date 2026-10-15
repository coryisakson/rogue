# Backlog (ordered by Cory's priorities; newest requests at the bottom of each section)

## Next up
- Reranker for rules search (chat model on top-10) + per-game regression question set. Ranking is only fair today.
- Auto re-index when a recheck reports a changed hash.

## Requested by Cory
- **My collection (BGG)** (2026-10-15). As a user who has given a BGG username:
  - List and sort my collection by player count, for games that are known/indexed in Rogue.
  - "What shall we play?" narrowing wizard/filter: e.g. 4 players, pirate theme, co-op, deckbuilder. Filters: player count (supported + best), theme, mechanics, co-op/competitive, play time, weight, language.
  - Design notes: BGG XML API2 collection endpoint needs a registered application token now (2025 policy), check before building; cache per user; queue-and-retry since BGG returns 202 while preparing. Match to our games by BGG id (store `bgg_id` on games). Games we do not index show as "not in Rogue yet" with an Add request. Theme/mechanic tags come from BGG metadata for matching only (facts, not copied descriptions). Needs OAuth login to store the username; anonymous users can still type a username for a one-off view if Cory allows (log as question).
  - Also expose as MCP tools: `get_collection`, `what_should_we_play`.
- Open Rogue to the public (done 2026-10-15, see PROGRESS).

## Later
- Auth (OAuth providers, Better Auth), interactive chat, ratings, Discord bot, fit solver, Librarian agent, Scout agent, more games, i18n UI.
