# Approvals needed from Cory

Reply with IDs, e.g. "approve A01 A02, A05 = AGPL-3.0, A07 = option 1". Agents keep working on unblocked items meanwhile.
Status: OPEN / DONE. Newest IDs at the bottom.

| ID | Status | Blocks | What is needed | Recommendation |
|----|--------|--------|----------------|----------------|
| RGE-A01 | DONE* | First Docker image build (CI), all deploys | Cory: Actions builds to Docker Hub; "it has access". *Unverified: repo-level secrets list was empty when checked (API may hide org/account-level). First real build will confirm; see A11 if login fails. | |
| RGE-A02 | DONE | First deploy to Olares | Approved: first install, route rogue, auth private. | |
| RGE-A03 | DONE | Safe parallel agent work | Decision: feature branches + PRs; Cory approves/merges PRs when he wants to test. Branch protection not enabled by agent. | |
| RGE-A04 | DONE | Unattended Claude Code runs | Decision: Claude subscription with usage caps, no pay-as-you-go API. Use until the usage wall. | |
| RGE-A05 | DONE | Adding a LICENSE file | Approved: AGPL-3.0 code; CC BY-SA data. LICENSE file to be added. | |
| RGE-A06 | DONE | Postgres in the deployment | Decision: whole solution is ONE app container. Postgres/persistent storage and AI services run outside the container. | |
| RGE-A07 | DONE | Backups | Decision: external data path like webOlares (Olares Data mount); agent recommends backup plan from day 1 (docs/BACKUP_PLAN.md). | |
| RGE-A08 | DONE | Branding | Decision: working brand "T-AI-bletop Rogue" (or similar). Trademark/domain search still logged in Review Log R5. | |
| RGE-A09 | DONE | Model providers (Phase 1) | Decision: dev uses local AI for nearly everything. Cloud caps not needed. | |
| RGE-A10 | DONE | | Approved: poll GitHub Actions and Docker Hub releases (read-only). | |
| RGE-A11 | OPEN | Verified image publish | Merge PR `fix/build-workflow-yaml` (fixes invalid workflow YAML; first image build failed before running). After merge the build runs on main; if Docker login fails, add DOCKER_USERNAME/DOCKER_PASSWORD secrets to this repo. | Merge. |
| RGE-A12 | OPEN | Postgres/AI endpoints | Where do external Postgres (pgvector) and the local AI endpoint run on Olares, and what URLs/credentials? Needed before DB work (vault flow for credentials). Until then core code uses env-configured URLs with no DB yet. | Tell me the Olares service names. |
