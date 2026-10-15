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
| RGE-A13 | OPEN | Restoring after losing the volume | Backups are encrypted (AES-256-GCM). The key is the file `backup-key` on the Rogue data share (Data/rogue/files/backup-key). Save a copy somewhere that is NOT the same disk (password manager). Without it the backups are unreadable. | Copy it now; the file is 44 bytes. |
| RGE-A14 | OPEN | Discord alerts | Create a Discord webhook in the channel for backup-failure alerts and weekly source digests, then put `{"webhook":"https://..."}` in Data/rogue/files/discord.json. Until then alerts are only logged. | Use your existing notifications channel. |
