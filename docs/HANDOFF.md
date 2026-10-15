# Handoff (updated 2026-10-15, end of session)

Live: https://rogue.cisakson.olares.com, version 0.0.53 (Discord bot on) (games: Pandemic, Slay the Spire) (public: front-end pages only; /api, /mcp and admin APIs need the x-rogue-admin token; /admin pages need a signed-in admin).
Working tree: /opt/data/repos/rogue, branch main (commit straight to main until Cory accepts the first Olares build; see AGENTS.md). Follow AGENTS.md and docs/DEPLOY.md.

## Done
- Phase 0 complete: Olares deploy, Postgres sidecar, migrations, storage provider, encrypted DB + files backups, restore CLI (scripts/restore.mjs), restore test, Discord alert code, i18n skeleton, design tokens, admin console (/admin: overview, backups, approvals, review log, users, design), OAuth login (GitHub/Google/Discord all working), account linking + merge, account deletion (GDPR), admins via Data/rogue/files/admins.json (Cory = user 8).
- Phase 1 partly: rights-gated fetcher, page-cited chunk index, hybrid search + LLM rerank, Librarian v0 (Pandemic: 92 published cited claims), claim admin (reject/dedupe), DB-enforced provenance (triggers + provenance_violations view, 0 violations), rules chat, fit-solver setup sheet, ratings on facts, weekly recheck, MCP (backend only).

## Waiting on Cory
- Nothing. RGE-A13 done (key copied). RGE-A14 deferred by Cory: Discord alerts/digests wait for the full Discord integration (users use Rogue inside the Discord app); then add an admins channel. Alert code (notify.ts) already exists and only logs until a webhook/bot is configured.

## Next (in order)
1. (DONE 0.0.43, /admin/claims) Review queue UI. Now exceptions-only (needs_review or low-rated), per Cory: agents run the system, humans see only what really needs them. Still to do: reuse for the approvals handshake; (DONE 0.0.46: Curator auto-resolves needs_review; frontier judge via ROGUE_JUDGE_* env still unconfigured, so it restores but never rejects).
2. HTML adapter + OCR merged; OCR http provider verified live against Cory's PaddleOCR-VL (0.0.49; in-pod OCR confirmed on Slay the Spire p.1). Left: first real HTML seed, authority ranking across sources.
3. Rate chat answers (needs stored answer id).
4. Discord integration (ENABLED 0.0.53, endpoint verified by Discord; Cory must invite the bot, then test live /ask; left: rating buttons, Discord-to-Rogue user link): bot sharing the core lib so people use Rogue (setup sheets, rules chat, ratings) inside the Discord app; then an admins channel for alerts, weekly digest and the approval handshake (plan 1a); closes RGE-A14.
5. Add-game flow behind login (Scout + Rights Officer as code paths first).
6. Then Phase 1b agent team, Phase 2 learning loop. Cory: no more games for the MVP; acceptable beats gold-plated.

## Not now (Cory)
BGG collection / what-shall-we-play is backlog only (docs/BACKLOG.md, docs/BGG_NOTES.md; test user CoryIsakson). Off-box backups and cloud storage = Phase 7b (R24).

## Parallel workers
Use delegate_task (max 3) with a git worktree + branch cc/<slug> each (git worktree add -b cc/x ../rogue-wt-x main); workers never touch docs/PROGRESS.md or main. Merge with scripts/merge-branch.sh cc/x (rebases, re-checks, ff-merges, pushes; exit 2 = conflict, resolve in the worktree and re-run). Then bump + push + deploy serially.

## Gotchas
- Deploy chain: scripts/bump-version.sh patch -> commit -> push with GITHUB_TOKEN header (see DEPLOY.md) -> wait for CI + image (monitor-actions.py) -> scripts/deploy.sh (retry once after 90 s: Docker Hub lags 1-3 min) -> scripts/verify.sh. PATH needs /home/linuxbrew/.linuxbrew/bin. Pod takes ~1-2 min after deploy (502 meanwhile).
- Admin API token: Data/rogue/files/admin-token, header x-rogue-admin. Fetch with olares-cli files download.
- Pod DNS needs ipv4Fetch; gemma4 needs large max_tokens; Astro checkOrigin is off, every POST handler must call sameOrigin().
- Layouts cannot return redirects: guard in middleware.ts.
- Long chained terminal commands can trip the approval timeout; keep deploy steps in separate calls.
- Hourly stall-check cron 9a8bfa208abe resumes ROADMAP work if idle.
