# Approvals needed from Cory

Reply with IDs, e.g. "approve A01 A02, A05 = AGPL-3.0, A07 = option 1". Agents keep working on unblocked items meanwhile.
Status: OPEN / DONE. Newest IDs at the bottom.

| ID | Status | Blocks | What is needed | Recommendation |
|----|--------|--------|----------------|----------------|
| RGE-A01 | DONE | Docker Hub publish | Verified: DOCKER_USERNAME/DOCKER_PASSWORD set as repo secrets by Hermes (token from its env); images cisakson/rogue 0.0.1-0.0.3 published. Optional hardening: replace with a repo-scoped Docker Hub token. | |
| RGE-A02 | DONE | First deploy to Olares | Approved: first install, route rogue, auth private. | |
| RGE-A03 | DONE | Safe parallel agent work | Decision: feature branches + PRs; Cory approves/merges PRs when he wants to test. Branch protection not enabled by agent. | |
| RGE-A04 | DONE | Unattended Claude Code runs | Decision: Claude subscription with usage caps, no pay-as-you-go API. Use until the usage wall. | |
| RGE-A05 | DONE | Adding a LICENSE file | Approved: AGPL-3.0 code; CC BY-SA data. LICENSE file to be added. | |
| RGE-A06 | DONE | Postgres in the deployment | Decision: whole solution is ONE app container. Postgres/persistent storage and AI services run outside the container. | |
| RGE-A07 | DONE | Backups | Decision: external data path like webOlares (Olares Data mount); agent recommends backup plan from day 1 (docs/BACKUP_PLAN.md). | |
| RGE-A08 | DONE | Branding | Decision: working brand "T-AI-bletop Rogue" (or similar). Trademark/domain search still logged in Review Log R5. | |
| RGE-A09 | DONE | Model providers (Phase 1) | Decision: dev uses local AI for nearly everything. Cloud caps not needed. | |
| RGE-A10 | DONE | | Approved: poll GitHub Actions and Docker Hub releases (read-only). | |
| RGE-A11 | DONE | PR merge | Hermes merged PR #1 (Cory: skip branching until first Olares build; now committing to main). | |
| RGE-A12 | DONE | Postgres/AI | Cory: Postgres runs as a sidecar in the same pod (pgvector/pgvector:pg17, PVC subPath postgres). AI via Olares Router shared entrance (see PROGRESS). Compose file for desktop testing. | |
| RGE-A13 | DONE | Restoring after losing the volume | Backups are encrypted (AES-256-GCM). The key is the file `backup-key` on the Rogue data share (Data/rogue/files/backup-key). Save a copy somewhere that is NOT the same disk (password manager). Without it the backups are unreadable. | Copy it now; the file is 44 bytes. | Cory confirmed key copied off-box 2026-10-15. |
| RGE-A14 | DEFERRED | Discord alerts | Create a Discord webhook in the channel for backup-failure alerts and weekly source digests, then put `{"webhook":"https://..."}` in Data/rogue/files/discord.json. Until then alerts are only logged. | Use your existing notifications channel. | Cory: wait until full Discord integration (users interact with Rogue in the Discord app), then add an admins channel and wire alerts/digests there. |
| RGE-A15 | DONE | Discord bot | Create a Discord application, then set ROGUE_DISCORD_APP_ID and ROGUE_DISCORD_PUBLIC_KEY on the Rogue app, set the Interactions Endpoint URL to https://rogue.cisakson.olares.com/discord/interactions, register commands (docs/DISCORD.md). Bot token only for the one-time register script, never in the app. | Do it when you want users in Discord; nothing else is blocked. | Done 2026-10-15: app id + public key in chart (0.0.53), commands registered, Interactions Endpoint URL saved (Discord's signed PING passed). Cory still needs to invite the bot to his server (OAuth2 URL: scopes applications.commands). Token file Data/rogue/discord.txt can be deleted. |
| RGE-A16 | OPEN | Game name search (pick list) | BGG's search API answers 401 without a token (checked 2026-10-15). Register a non-commercial application at https://boardgamegeek.com/applications (details in docs/BGG_NOTES.md; approval can take a week+), create a token, and put it in Data/rogue/files/bgg-token. Meanwhile I build the provider interface and a fallback so the flow works. | Register now; it is the long pole. |
| RGE-A17 | OPEN | Scout internet search | The Scout needs a web search API inside the app. Hermes host has a Firecrawl key; may Rogue use a Firecrawl key (search only, rate-limited, results used just to find links) or do you prefer a self-hosted SearXNG on Olares? | Firecrawl to start, behind the search interface. |
