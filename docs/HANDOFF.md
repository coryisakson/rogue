# Handoff (rewritten 2026-10-17 midday). Keep under 3 KB; history in docs/archive/.

Live: https://rogue.cisakson.olares.com, 0.0.115. Games: Pandemic (EN+DE), Slay the Spire, Azul (EN+partial DE). Rulebook: AGENTS.md.
Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## Next (ordered; do the first unfinished one)
0. QUALITY FOCUS (Cory 2026-10-17): fix Space Base source (store-page text, not rulebook), re-index Brass (52 chunks no embeddings), run Librarian on new top-10 games, list/count retrieval fix (roles questions fail on all models), eval sets for new games. BGG top 10 queued (done); Terraforming Mars rejected (reason unchecked); Grimcoven awaits approval.
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
