# Handoff (written 2026-10-15, end of session)

Live: https://rogue.cisakson.olares.com, version 0.0.35 (public: front-end pages only; /api, /mcp, admin need the x-rogue-admin token).
Working tree: /opt/data/repos/rogue, branch main. Follow AGENTS.md and docs/DEPLOY.md.

## Done
Fetcher + rights gate, page-cited chunk index, hybrid search + LLM rerank (hit@1 92%), Librarian v0 (Pandemic: 92 published cited claims),
claim admin (reject/dedupe), rules chat (/games/<slug>/ask, sign-in required), fit solver setup sheet, weekly recheck + Discord digest,
OAuth login code (GitHub/Google/Discord), ratings on facts, backups, takedown flow. Test leftover in claim_ratings cleared with Cory's approval.

## Waiting on Cory
OAuth app client ids/secrets (docs/LOGIN_SETUP.md). Until then login is untested end to end.

## Next (core plan, in order)
1. Rate chat answers (needs a stored answer id).
2. (done 0.0.36) ratings FK + account deletion.
3. Discord bot sharing the core lib.
4. Add-game flow behind login (Scout + Rights Officer as code paths first).
5. More games only after the above (Cory: no more games for MVP).

## Not now (Cory)
BGG collection/what-shall-we-play is backlog only (docs/BACKLOG.md, docs/BGG_NOTES.md; test user CoryIsakson). MVP: acceptable beats gold-plated.

## Gotchas
Docker Hub tags lag CI by 1-3 min (deploy.sh retry). Pod DNS needs ipv4Fetch. gemma4 needs large max_tokens. Hourly stall-check cron 9a8bfa208abe resumes ROADMAP work if idle.
