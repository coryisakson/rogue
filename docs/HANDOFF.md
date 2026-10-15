# Handoff (updated 2026-10-15, end of session)

Live: https://rogue.cisakson.olares.com, version 0.0.68 (game intake: name search, queue, Scout search; Discord bot on, add-game flow) (games: Pandemic, Slay the Spire) (public: front-end pages only; /api, /mcp and admin APIs need the x-rogue-admin token; /admin pages need a signed-in admin).
Working tree: /opt/data/repos/rogue, branch main (commit straight to main until Cory accepts the first Olares build; see AGENTS.md). Follow AGENTS.md and docs/DEPLOY.md.

## Done
- Phase 0 complete: Olares deploy, Postgres sidecar, migrations, storage provider, encrypted DB + files backups, restore CLI (scripts/restore.mjs), restore test, Discord alert code, i18n skeleton, design tokens, admin console (/admin: overview, backups, approvals, review log, users, design), OAuth login (GitHub/Google/Discord all working), account linking + merge, account deletion (GDPR), admins via Data/rogue/files/admins.json (Cory = user 8).
- Phase 1 partly: rights-gated fetcher, page-cited chunk index, hybrid search + LLM rerank, Librarian v0 (Pandemic: 92 published cited claims), claim admin (reject/dedupe), DB-enforced provenance (triggers + provenance_violations view, 0 violations), rules chat, fit-solver setup sheet, ratings on facts, weekly recheck, MCP (backend only).

## Waiting on Cory
- Nothing. RGE-A13 done (key copied). RGE-A14 deferred by Cory: Discord alerts/digests wait for the full Discord integration (users use Rogue inside the Discord app); then add an admins channel. Alert code (notify.ts) already exists and only logs until a webhook/bot is configured.

## Done 2026-10-15 late (pre-Phase 2 todos from Cory, all live in 0.0.69, Cory confirmed Ask flow, game request and Terms Agent in his browser)
- Terms Agent + CDN awareness (0.0.67): reads the PUBLISHER's terms (linking page, then file host if real, then domain main site), auto-approves a source when rights pass and terms are clear; kill switch ROGUE_AUTO_APPROVE_SOURCES=0. Generic copyright wording counts as clear (0.0.69, Review Log R28).
- Answers-first game page (one Ask box, fact list admin-only via ?facts=) and /games popular six + typeahead + missing-game link (0.0.68).
- Nanobot probed (ADR 0002 addendum): v0.3.5, pip install, `nanobot serve` OpenAI-compatible API, MCP via tools.mcpServers; risky defaults (exec, file, cliApps, dream, channels) must be off. Nothing built.
- Principle (Cory): AI tasks go to Nanobot agents via MCP in the background; plain code stays in the app so the site is fast. Live Ask stays a direct streamed call (open point, tell Cory). Move order: Librarian, Terms judgement, Scout judgement, Curator.

## Start here next session (order)
1. FAQ eval set: web-search 10 real FAQs each for Pandemic and Slay the Spire (source URL, expected answer, rulebook page), store in packages/core/eval/, run against Ask incl. count/list questions. Gates Phase 2. (Was about to start.)
2. Nanobot sidecar: Python container in the pod (not in the Node image), config generated from agent specs, all risky tools off, restrictToWorkspace true, models via Olares Router; propose-only MCP tools; job queue state in DB; then migrate Librarian first.
3. Then: Q&A become facts, FAQ Curator agent, one-pager quality gate, printed-page detection, frontier judge (ROGUE_JUDGE_*, needs a model route; ask Cory via APPROVALS).
Unverified live: Terms Agent auto-approve on a fresh request (Contention should clear now; Z-Man's legal page is JS-built so stays human), Scout publisher-first run (0.0.66).

## Next (in order)
1. (DONE 0.0.43, /admin/claims) Review queue UI. Now exceptions-only (needs_review or low-rated), per Cory: agents run the system, humans see only what really needs them. Still to do: reuse for the approvals handshake; (DONE 0.0.46: Curator auto-resolves needs_review; frontier judge via ROGUE_JUDGE_* env still unconfigured, so it restores but never rejects).
2. HTML adapter + OCR merged; OCR http provider verified live against Cory's PaddleOCR-VL (0.0.49; in-pod OCR confirmed on Slay the Spire p.1). HTML seed (Pandemic product page) + authority ranking shipped 0.0.60; left: verify live ingest.
3. (DONE 0.0.57, click confirmed by Cory: chat_answers id + helpful/not helpful buttons, POST /rate-answer, migration 0016.)
4. Discord integration (ENABLED 0.0.53, endpoint verified by Discord; Cory must invite the bot, then test live /ask; rating buttons DONE 0.0.54; left: Discord-to-Rogue user link DONE 0.0.55 (sign in with Discord on the site; votes tied to account); Cory decisions: digest timezone UTC, button approvals OK for now; admins channel is low priority backlog): bot sharing the core lib so people use Rogue (setup sheets, rules chat, ratings) inside the Discord app; then an admins channel for alerts, weekly digest and the approval handshake (plan 1a); closes RGE-A14.
5. (DONE 0.0.56: /request-game + /admin/requests, Rights Officer v0 as code; needs a live walk-through in Cory's browser). Left: Scout that finds the rulebook link itself (search + publisher page link extraction), terms-of-use clause flagging.
6. Then Phase 1b agent team on Nanobot (no bake-off; ADR 0002; sidecar only if needed, minimal features), Phase 2 learning loop. Cory: no more games for the MVP; acceptable beats gold-plated.

## MVP direction (Cory 2026-10-15)
Users don't care about the raw fact list; MVP value = setup one-pagers + Ask the rules. Facts feed those. User Q&A (cited answers) should become facts, and a FAQ Curator agent should occasionally merge them into a concrete common Q&A list per game (see ROADMAP 'MVP focus'). Count/list questions ('how many roles in Pandemic') must work by assembling items from the rulebook (shipped 0.0.59, needs eval).

## Not now (Cory)
BGG collection / what-shall-we-play is backlog only (docs/BACKLOG.md, docs/BGG_NOTES.md; test user cisakson). Off-box backups and cloud storage = Phase 7b (R24).

## Parallel workers
Use delegate_task (max 3) with a git worktree + branch cc/<slug> each (git worktree add -b cc/x ../rogue-wt-x main); workers never touch docs/PROGRESS.md or main. Merge with scripts/merge-branch.sh cc/x (rebases, re-checks, ff-merges, pushes; exit 2 = conflict, resolve in the worktree and re-run). Then bump + push + deploy serially.

## Gotchas
- Deploy chain: scripts/bump-version.sh patch -> commit -> push with GITHUB_TOKEN header (see DEPLOY.md) -> wait for CI + image (monitor-actions.py) -> scripts/deploy.sh (retry once after 90 s: Docker Hub lags 1-3 min) -> scripts/verify.sh. PATH needs /home/linuxbrew/.linuxbrew/bin. Pod takes ~1-2 min after deploy (502 meanwhile).
- Admin API token: Data/rogue/files/admin-token, header x-rogue-admin. Fetch with olares-cli files download.
- Pod DNS needs ipv4Fetch; gemma4 needs large max_tokens; Astro checkOrigin is off, every POST handler must call sameOrigin().
- Layouts cannot return redirects: guard in middleware.ts.
- Long chained terminal commands can trip the approval timeout; keep deploy steps in separate calls.
- Hourly stall-check cron 9a8bfa208abe resumes ROADMAP work if idle.
