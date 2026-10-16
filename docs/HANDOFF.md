# Handoff (rewritten 2026-10-16). Keep this file under 3 KB; history lives in docs/archive/.

Live: https://rogue.cisakson.olares.com, version 0.0.69 deployed (0.0.70 shipped per PROGRESS; confirm with /healthz). Repo /opt/data/repos/rogue, main. Games: Pandemic, Slay the Spire.
Rulebook: AGENTS.md. Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## Next (ordered; do the first unfinished one)
1. PAUSED (Cory 2026-10-16): content-quality validation, i.e. Ask evals/tuning, KB quality checks and OCR/page-text quality work. Resume only once Nanobot runs and can take it over. CODE quality is NOT paused: workers keep tests, types and scripts/qcheck.sh green.
2. Nanobot sidecar (Python container in pod; risky tools off; propose-only MCP tools; job state in DB); migrate Librarian first. Self-contained -> worker.
3. Q&A become facts, FAQ Curator, one-pager quality gate, printed-page detection, frontier judge (needs APPROVALS entry).

## Unverified live
Terms Agent auto-approve on a fresh request; Scout publisher-first run (0.0.66).

## Not now
BACKLOG.md items (BGG collection etc.) are not worked unless Cory names one. Off-box backups = Phase 7b.

## Gotchas (full deploy steps: skill rogue-project-workflow, docs/DEPLOY.md)
Admin token: Data/rogue/files/admin-token (header x-rogue-admin). Pod DNS needs ipv4Fetch. POST handlers need sameOrigin(). Layouts cannot redirect. Keep deploy steps in separate terminal calls. Hourly stall-check cron 9a8bfa208abe.
