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
- **QR codes as facts** (2026-10-15). QR codes found for a game's app/companion (e.g. printed in the rulebook, or on the publisher's page) become facts and are listed on the game page. Design notes: decode during ingest (PDF page images / HTML img) in a pure core function with a test; store the decoded URL as a claim (topic `companion`, cited to page/locator like any claim), run it through the rights gate before any fetch (only record the link, do not crawl it); show a 'Companion app and links' list on /games/<slug> with page citation; never render publisher art, only our own plain link. Open question: scope is rulebook QR codes plus publisher page QR codes; confirm with Cory if he meant something else by 'for the app'.
- **Slay the Spire one-pager: player-count table** (2026-10-15). The one-pager shows an empty table for player-count changes. If the rulebook has none, say so explicitly ("No player-count changes in this game") instead of an empty table. Do much later.
- **Game box thumbnails on game cards** (2026-10-15). Game display cards include a thumbnail of the game box. The Curator agent must make the effort to find them. Rights: link/hotlink or licensed source only, with attribution, per AGENTS.md rule 3 (no copying publisher art without a rights check); log in REVIEW_LOG. Do much later.
- **Multi-lingual website** (2026-10-15). The entire site (not only rules chat) in the user's language. Needs: a language-string management solution (string catalogs per locale, a way to find missing keys, translation workflow, localised images where needed); move all UI text and images to the strings; default = saved preference if logged in, else the browser Accept-Language; language selector on the site; persist choice for logged-in users (users table column). Builds on the i18n skeleton (en/de). Do much later.
- Open Rogue to the public (done 2026-10-15, see PROGRESS).

## Later
- Auth (OAuth providers, Better Auth), interactive chat, ratings, Discord bot, fit solver, Librarian agent, Scout agent, more games, i18n UI.


See docs/BGG_NOTES.md for BGG API access rules (registration, bearer token, limits, logo, no BGG login). Not applied yet; Cory decides later.

## Much later (Cory 2026-10-15)
- **(Promoted to ROADMAP 'Game intake pipeline' 2026-10-15) Automated game search by name, with BGG confirmation** (Cory 2026-10-15). In /request-game the user types only a game name. Rogue searches for candidates (BGG search, see docs/BGG_NOTES.md for the token/registration rules) and shows them with year, publisher and a BoardGameGeek link; the user confirms which one they mean before anything else happens. Then a Scout finds the publisher's rulebook link itself (search + publisher page link extraction, per docs/SCOUT_PLAYBOOK.md), stores bgg_id on the game, and hands the result to the existing Rights Officer checks and admin approval. Manual link entry stays as a fallback. Only link/facts from BGG, no copied descriptions or art. Builds on the add-game flow (0.0.56).
- **Discord server to host the bot with @bot ability.** A Rogue-owned Discord server where people can @mention the bot (needs gateway/message-content or mention handling, not only slash commands). Do much later.
- **Discord admin channel (low priority).** Private admins channel for alerts, weekly digest and approval buttons (plan in docs/DISCORD.md). Cory: digest timezone = UTC, button approvals are fine for now. Code may be prepared, but the channel itself is low priority.
- **Discord app verification** (Cory 2026-10-15, much later). Needed to get the Discord app verified (currently missing 4 criteria):
  - App must belong to a Team (not a personal account).
  - No harmful or bad language in app name, description, commands or role connection metadata.
  - Link to Terms of Service (write and host a /terms page).
  - Link to Privacy Policy (write and host a /privacy page; GDPR-aligned, covers Discord ids and rating votes).
  - Install link (set in the Developer Portal, default install settings).
  - All Team members need a verified email and 2FA.
- **Answer Improvement Agent** (Cory 2026-10-16). Nanobot agent that works the improvement queue (poorly rated answers and unanswered asks): diagnoses why (missing source, bad chunk, weak retrieval, gate too strict), and proposes fixes via propose-only tools (new claim, source to scout, FAQ edit). Humans approve. Depends on the improvement queue below being built.
