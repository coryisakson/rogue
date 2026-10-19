# Handoff (rewritten 2026-10-17 midday). Keep under 3 KB; history in docs/archive/.

Live: https://rogue.cisakson.olares.com, 0.0.115. Games: Pandemic (EN+DE), Slay the Spire, Azul (EN+partial DE). Rulebook: AGENTS.md.
Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## FEASIBILITY FRAMING (Cory 2026-10-18, read first)
The current goal is to measure whether Rogue's solution works IF we had all the content, setting rights/terms-of-service blocks aside for the experiment. If sources keep being blocked (bot walls, restrictive terms, no usable publisher text), the whole idea may not be feasible and Cory will pivot to a different project. Track blockers per game as evidence. Open items (Cory 2026-10-18):
- Extraction: Scout only finds/judges sources; extraction is plain code (pdf-adapter.ts, ingest.ts). Propose a separate Extractor agent for smarter extraction.
- Text layers: prefer them. ROGUE_OCR_ALL_PAGES=1 currently discards every PDF text layer and OCRs all pages. Measure text layer vs OCR per source first, then choose per page (text layer when clean, OCR for scanned/garbled).
- Source rule: AGENTS.md 2b = prefer publisher, not restricted to it (lower authority weight + REVIEW_LOG verdict; still no bot-wall bypass). scout.md and add-game error text still say publisher-only: update.
- Admin capture for bot-walled pages: human opens page in own browser, bookmarklet or paste box on /admin/sources sends URL+text; source marked manual capture by named admin. Fixes access, not permission (officialgamerules.org R36 forbids copying; DECIDED 2026-10-18 (R36): link only, and only a direct link to the game's page; revisit capture once the admin capture feature exists).
- Plan: 1) text-layer measurement, 2) per-page text-layer/OCR selection, 3) admin capture, 4) Extractor agent. Source fixes (Space Base, Grimcoven, Gloomhaven, Brass, Twilight Imperium, Star Wars Rebellion) await Cory's go-ahead.

## Next (ordered; do the first unfinished one)
0a. (SHIPPED 0.0.129, needs Cory click-through) ADMIN GAME HUB (Cory 2026-10-18): (1) /admin/games: search box (no dropdown) plus the last few added/updated games as quick links; (2) per-game page with full history: request, sources, extracts, deletes in one view; (3) /admin/requests becomes a simplified list; accepting a request removes it from there and the game appears under Admin Games; (4) admin search covers ingested games only, except on the requests page where it can search/add new games. Source delete (cc/source-delete) is in progress; build the hub after it merges.
0. QUALITY FOCUS (Cory 2026-10-17): fix Space Base source (store-page text, not rulebook), re-index Brass (52 chunks no embeddings), run Librarian on new top-10 games, list/count retrieval fix (roles questions fail on all models), eval sets for new games. BGG top 10 queued (done); Terraforming Mars rejected (reason unchecked); Grimcoven awaits approval.
0c. (SHIPPED 0.0.142, needs Cory click-through) wiki import + wiki-as-publisher attestation + admin all-games list/delete.
0b. EXTRACTION (Cory 2026-10-18): (a) new Extractor agent separate from Scout (Scout only finds/judges sources); (b) text layers: ROGUE_OCR_ALL_PAGES=1 currently overwrites every PDF text layer with OCR; make it per-page best-of (text layer when clean, OCR when scanned/garbled), measure first; (c) source rule is now prefer-publisher-not-only (AGENTS.md 2b; scout.md and add-game error text still say publisher-only, update); (d) admin 'capture from browser' for bot-walled pages (bookmarklet/paste, source marked manual capture).
1. BGG: API import needs ROGUE_BGG_TOKEN (RGE-A16 submitted by Cory, awaiting BGG). Until then CSV upload works at /account/collection. Cory to test with his cisakson export.
2. A6 print/sheet accessibility, A7 manual keyboard/screen-reader pass (SKIPPED: Cory has no screen reader; keep automated checks only), A8 ACR/VPAT + accessibility statement.
3. MCP OAuth LIVE with audit entries (done). Next: item 2 (accessibility A6-A8) or Cory-blocked items.
4. Azul: DE copy is the partial 'Nicht komplett' portal PDF (R32). Cory may supply a full German rulebook.
5. ASK EVALS to 10/10 and extra sources: PAUSED for MVP (Reddit/BGG ruled out R29/R30).

## Needs Cory's eyes (LATER, Cory will return)
Print tests, R34 (Azul EN source) review, full German Azul rulebook.

## Done recently
A5 design migration complete (0.0.107-0.0.108); Pandemic DE (R33 approved); Azul EN (R34); BGG collection page; MCP OAuth; Librarian ?source=<id>.

## Gotchas (deploy steps: skill rogue-project-workflow, docs/DEPLOY.md)
Admin token: Data/rogue/files/admin-token (header x-rogue-admin). New routes must be added to isPublicPath. Pod DNS needs ipv4Fetch. Keep deploy steps in separate terminal calls. Main node_modules was repaired with npm ci (workers share it). Hourly stall-check cron 9a8bfa208abe.
