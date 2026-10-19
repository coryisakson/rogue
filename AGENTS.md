# AGENTS.md: the guide for every AI agent working on Rogue

Read this first, every session. `CLAUDE.md` points here. The product design is in
`docs/design/rogue-design-plan-v13.html` (the source of truth for *what*); this file says *how to work*.

## What Rogue is
An open-source, cited, rights-aware tabletop-game knowledge platform: a continuously learning knowledge base (KB)
with two first products (setup one-pagers, cited rules chat), run by a small team of least-privilege agents.
EU/GDPR-first, self-hostable, MCP-native, every model and storage provider pluggable. Owner: Cory (cisakson).

## Non-negotiable rules (from the design plan)
1. **No claim without a source.** Anything shown to users (chat, FAQs, sheet lines, images, accessories) carries attribution. Unattributed claims cannot be stored as published.
2. **Rights first.** Never host or serve full rulebooks. Fetch/cache/quote only within the Jurisdiction Policy; honour opt-outs (robots, TDM reservations, site terms). Enforcement lives in the KB service, never only in a prompt.
2b. **Source preference (Cory 2026-10-18):** prefer the publisher or rights holder when a usable source exists, but do not restrict to it. Other sources (fan summaries, third-party rules sites, community text) are allowed when the rights gates pass (robots, TDM, site terms, no bot-wall bypass) and are recorded with a lower authority weight and a REVIEW_LOG verdict. Never bypass a bot wall. A game published only as a wiki may be stored with publisher authority when an admin attests (audited checkbox) that the wiki is the publisher's official documentation.
3. **Don't copy publisher art or text.** Themed styling is original; paraphrase facts, quote briefly with citation.
4. **Pluggable everything.** Models, storage, and source adapters sit behind interfaces. No provider SDK calls outside `packages/providers`/adapters. Local-first model preference.
5. **Hosting-country neutral.** EU defaults come from the instance profile (`packages/core/src/config.ts`), never hard-coded.
6. **Humans approve.** (After the branching switch, agents open PRs and Cory merges.) Agents never change rights grants, retention, secrets or production data without an approval entry.
7. **Keep a Review Log.** Anything needing legal/expert review goes in `docs/REVIEW_LOG.md`; no formal legal review yet.

## Stack and layout
- TypeScript (strict) everywhere; Astro 7 SSR (`apps/web`), shared logic in `packages/core`. Python only as an isolated worker if later needed. Rust only for a profiled hot spot.
- **One app image; Postgres is a sidecar.** The app image holds only the app (plus pg client tools for backups). Postgres (pgvector) runs as a sidecar container in the same Olares pod (and as a `db` service in `docker-compose.yml` for desktop tests); persistent files/backups live on the app-data mount; AI models run outside via Olares Router. Everything is reached through env (`DATABASE_URL`, `ROGUE_DATA_DIR`, `ROGUE_BACKUP_DIR`, `ROGUE_AI_*`). Never bake a database or models into the image.
- Postgres + pgvector is the single data store (wired: migrations in `packages/core/migrations`, applied on first use). Node >= 22.
- **Olares quirks:** Router in-cluster URL is `http://3a77b15d.shared.olares.com/v1`; Node's default DNS lookup fails there, so use `ipv4Fetch` (`apps/web/src/lib/services.ts`). Use explicit model ids (`Olares/gemma4:e4b`, `Olares/embeddinggemma-300m`); embeddings allow 1 concurrent request. Background shells need `/home/linuxbrew/.linuxbrew/bin` on PATH for `olares-cli`.
- **AI default is local** (Cory's local model server, OpenAI-compatible endpoint); cloud models are optional per-role overrides.
- Licence: AGPL-3.0 code, CC BY-SA data (approved).
- Brand: working name "T-AI-bletop Rogue"; keep the name in the instance profile, not hard-coded.
- Layout: `apps/web` (site), `packages/core` (domain logic, no I/O frameworks), `deploy/olares/rogue` (chart), `scripts/` (ops), `docs/` (plans, ADRs, approvals).
- Code must be readable by a TypeScript/C#/Python developer who does not write code daily: small functions, plain names, comments explaining *why*.

## Working loop (every task)
1. Read `docs/PROGRESS.md` (state) and `docs/APPROVALS.md` (blockers). Pick the next unblocked roadmap item (`docs/ROADMAP.md`).
2. **Branching (Cory 2026-10-15): parallel workers.** Each worker uses its own git worktree and branch `cc/<slug>` (or `feat/`, `fix/`), never edits `main` directly, never edits `docs/PROGRESS.md`/`HANDOFF.md` (put notes in the final report), and only uses its assigned migration number range. When `npm run check` is green the branch is merged to `main` automatically with `scripts/merge-branch.sh <branch>` (rebase on main, re-check, fast-forward merge, push). Hermes then bumps the version and ships from `main`: GitHub Actions builds and pushes the image to Docker Hub, `scripts/deploy.sh` deploys. Deploys stay serial.
3. Write the test first or alongside. `npm run check` must pass (typecheck, tests, build, version consistency).
4. Update `docs/PROGRESS.md` (one dated line: what changed, what is verified, what is left).
5. If you need something you cannot do (credentials, spend, external account, a decision), add an entry to `docs/APPROVALS.md` with the next free ID `RGE-Axx`, then **continue with other unblocked work**. Do not wait.
6. Commit with a conventional message (`feat:`, `fix:`, `docs:`, `chore:`). Small commits.

## Definition of done
Tests pass, `npm run check` green, docs updated, no secret in the diff, citations/rights rules respected, PROGRESS entry written. Never claim a result you did not run.

## Delivery pipeline (GitHub, Docker Hub, Olares)
`bump-version.sh` -> commit -> push `main` -> **CI** (`ci.yml`: typecheck/test/build) and **image build** (`build-image.yml`, pushes `cisakson/rogue:<version>` and `:latest`) -> `scripts/deploy.sh` on a host with `olares-cli` (package chart, upload, in-place upgrade, set route/auth) -> `scripts/verify.sh` (state + `/healthz` version). Full runbook: `docs/DEPLOY.md`.
Rules: bump version for every deploy (CI fails on drift); never uninstall the app; never hand-roll `olares-cli market` commands; the domain/route step is a hard gate.

## Claude Code usage
Delegated coding runs on Cory's Claude subscription (no pay-as-you-go API). Use what the task needs until the usage limit; if you hit it, record the stopping point in `docs/PROGRESS.md` and continue non-AI work or wait. See skill `claude-code-offload`.

## Secrets
Never print or commit secrets. Host token lives in `/opt/data/.env` (`GITHUB_TOKEN`, Hermes host only). CI secrets: `DOCKER_USERNAME`, `DOCKER_PASSWORD`. Never ask Cory to paste a credential in chat; use the vault/approval flow.

## Approval IDs
Blockers are tracked as `RGE-Axx` in `docs/APPROVALS.md` and emailed to Cory. Cory replies with IDs (e.g. "approve A02, A03; A05 = AGPL"). Update the file when resolved.

## Where decisions live
`docs/adr/NNNN-title.md` for architecture decisions (short: context, decision, consequences). Add one whenever you choose between real alternatives.

## Product principle: agents do what the builder did
The manual find-and-retrieve work done while building Rogue (search, read publisher pages, check rights, fetch, extract, cite) is the template for the in-product agents. Follow `docs/SCOUT_PLAYBOOK.md`; when you learn a better way while building, update the playbook so the product agents inherit it.

## Context discipline (every agent; sessions were hitting context limits)
- Session start reads ONLY `docs/HANDOFF.md` (<3 KB) and the top 8 lines of `docs/PROGRESS.md`. Do not read ROADMAP, APPROVALS, REVIEW_LOG or archive files unless the task touches them; `grep` them instead.
- `docs/PROGRESS.md` entries stay under 400 characters. Detail goes in the commit message or an ADR. When the file passes 4 KB, move older entries to `docs/archive/PROGRESS-archive.md`.
- Never dump long output. Use `scripts/qcheck.sh` (not raw `npm run check`), `scripts/wait-build.py` (not polling loops), and redirect anything else to a file, then grep/`head`.
- Read files with `grep -n` + a line range, not whole. Do not re-read a file you just edited.
- Anything that touches 3 or more files, or a self-contained subsystem, goes to a worker: `scripts/new-worker.sh <slug>`, fill TASK.md, `scripts/run-worker.sh <slug>` (background), then `scripts/merge-branch.sh cc/<slug>`. The orchestrator reads only the worker's short report and `git diff --stat`, never the full diff unless something looks wrong.

## Content-quality validation (Cory 2026-10-16)
OCR/page-text quality work AND Ask evals / KB quality checks are ENABLED again (Cory re-enabled them after the MinerU OCR switch, 0.0.88). Code quality always applies: tests, strict types and `scripts/qcheck.sh` CHECK OK for every change.
