# Handoff (rewritten 2026-10-17 midday). Keep under 3 KB; history in docs/archive/.

Live: https://rogue.cisakson.olares.com, 0.0.115. Games: Pandemic (EN+DE), Slay the Spire, Azul (EN+partial DE). Rulebook: AGENTS.md.
Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## Next (ordered; do the first unfinished one)
0. Cory to click 'Queue BGG top 10' on /admin/requests, then watch the queue: expect terms-read gates and some manual research; use the new 'Edit source' when the Scout picks the wrong site. Hermes helps clear the queue.
1. BGG: API import needs ROGUE_BGG_TOKEN (RGE-A16 pending). Until then CSV upload works at /account/collection. Cory to test with his cisakson export.
2. A6 print/sheet accessibility, A7 manual keyboard/screen-reader pass (needs Cory), A8 ACR/VPAT + accessibility statement.
3. MCP OAuth is LIVE (0.0.114, ADR 0004, A19 approved; revoke verified by Cory). Next: audit-log entries for revoke/token use; REVIEW_LOG line for non-en OAuth/collection strings (machine-translated, need native review).
4. Azul: DE copy is the partial 'Nicht komplett' portal PDF (R32). Cory may supply a full German rulebook.
5. ASK EVALS to 10/10 and extra sources: PAUSED for MVP (Reddit/BGG ruled out R29/R30).

## Needs Cory's eyes
Print tests (setup page, player aid), admin pages in browser (shadcn migration), R34 (Azul EN source) review.

## Done recently
A5 design migration complete (0.0.107-0.0.108); Pandemic DE (R33 approved); Azul EN (R34); BGG collection page; MCP OAuth; Librarian ?source=<id>.

## Gotchas (deploy steps: skill rogue-project-workflow, docs/DEPLOY.md)
Admin token: Data/rogue/files/admin-token (header x-rogue-admin). New routes must be added to isPublicPath. Pod DNS needs ipv4Fetch. Keep deploy steps in separate terminal calls. Main node_modules was repaired with npm ci (workers share it). Hourly stall-check cron 9a8bfa208abe.
