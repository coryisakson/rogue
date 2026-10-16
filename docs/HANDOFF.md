# Handoff (rewritten 2026-10-16). Keep this file under 3 KB; history lives in docs/archive/.

Live: https://rogue.cisakson.olares.com, version 0.0.82 deploying. Repo /opt/data/repos/rogue, main. Games: Pandemic, Slay the Spire.
Rulebook: AGENTS.md. Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## Next (ordered; do the first unfinished one)
1. NEXT: OCR/page-text quality (UNPAUSED, Cory 2026-10-16). Pandemic chunks mix card art/map labels into rules text (see chunks src 1); design a cleanup pass (layout-aware extract or noise filter) via worker. Still paused: Ask evals/tuning and other KB quality checks until Nanobot can take them over. CODE quality is NOT paused: workers keep tests, types and scripts/qcheck.sh green.
2. DONE: Nanobot sidecar + Librarian (0.0.78) + Terms Agent (0.0.79) + Scout page judgement (0.0.80). FAQ Curator shipped (0.0.81, faq_curate). Librarian yield is low (1 of 5 drafted on StS); tuning counts as content quality = paused.
3. Printed pages 0.0.82 shipped and re-indexed (Pandemic printed=physical; StS none). Then Q&A become facts, one-pager quality gate, frontier judge (needs APPROVALS entry).

## Unverified live
FAQ Curator: POST /api/admin/faq-curate?game=pandemic, poll ?job=. Terms Agent auto-approve and scout_judge on a fresh request; Scout publisher-first run (0.0.66).

## Not now
BACKLOG.md items (BGG collection etc.) are not worked unless Cory names one. Off-box backups = Phase 7b.

## Gotchas (full deploy steps: skill rogue-project-workflow, docs/DEPLOY.md)
Admin token: Data/rogue/files/admin-token (header x-rogue-admin). Pod DNS needs ipv4Fetch. POST handlers need sameOrigin(). Layouts cannot redirect. Keep deploy steps in separate terminal calls. Hourly stall-check cron 9a8bfa208abe.
