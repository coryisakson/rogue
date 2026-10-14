# Approvals needed from Cory

Reply with IDs, e.g. "approve A01 A02, A05 = AGPL-3.0, A07 = option 1". Agents keep working on unblocked items meanwhile.
Status: OPEN / DONE. Newest IDs at the bottom.

| ID | Status | Blocks | What is needed | Recommendation |
|----|--------|--------|----------------|----------------|
| RGE-A01 | OPEN | First Docker image build (CI), all deploys | Add GitHub repo secrets `DOCKER_USERNAME` (cisakson) and `DOCKER_PASSWORD` (Docker Hub PAT, read/write) to `coryisakson/rogue`. I cannot read the web-olares secret values. Either create a PAT and enter it via the vault flow when I ask, or add them in GitHub Settings > Secrets. | Create a new PAT named `rogue-ci`. |
| RGE-A02 | OPEN | First deploy to Olares | Approve first install of app `rogue` on your Olares, route `rogue` -> https://rogue.cisakson.olares.com, auth level `private` (Olares login) until we choose otherwise. | Approve; private. |
| RGE-A03 | OPEN | Safe parallel agent work | Turn on branch protection for `main` (PRs required, CI must pass, you merge). Needs repo admin; my token may or may not allow it. | Approve; I will try via API. |
| RGE-A04 | OPEN | Unattended Claude Code runs | Claude subscription may not permit unattended automation (plan R21). Choose: (1) keep subscription for supervised runs only, (2) provide an Anthropic API key (vault flow) for heavy automation. Set a monthly cap. | Option 2 with a cap you choose. |
| RGE-A05 | OPEN | Adding a LICENSE file | Pick code license: AGPL-3.0 (plan leaning) vs MIT/Apache-2.0. Data license CC BY-SA vs CC0. | AGPL-3.0 code; CC BY-SA data. |
| RGE-A06 | OPEN | Postgres in the deployment | Choose how Rogue gets Postgres+pgvector on Olares: (1) own pgvector container + volume inside the Rogue chart (portable, self-host friendly), (2) Olares shared Postgres middleware (less ops, Olares-only). | Option 1. |
| RGE-A07 | OPEN | Backups | Which Olares path is the backup mount (e.g. `drive/Data/rogue-backups`), and is there a second off-box location? | Default `drive/Data/rogue-backups` for now. |
| RGE-A08 | OPEN | Branding | Approve a trademark and domain-availability search for "Rogue" (plan R5). Needs web research only; no spend. Also which domain(s) to register later. | Approve the search. |
| RGE-A09 | OPEN | Model providers (Phase 1) | Monthly cap for cloud LLM fallback, and which local models to try first on the 24 GB GPU. Not needed until Phase 1. | Defer. |
