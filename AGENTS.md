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
3. **Don't copy publisher art or text.** Themed styling is original; paraphrase facts, quote briefly with citation.
4. **Pluggable everything.** Models, storage, and source adapters sit behind interfaces. No provider SDK calls outside `packages/providers`/adapters. Local-first model preference.
5. **Hosting-country neutral.** EU defaults come from the instance profile (`packages/core/src/config.ts`), never hard-coded.
6. **Humans merge.** Agents open PRs; Cory merges. Agents never change rights grants, retention, secrets or production data without an approval entry.
7. **Keep a Review Log.** Anything needing legal/expert review goes in `docs/REVIEW_LOG.md`; no formal legal review yet.

## Stack and layout
- TypeScript (strict) everywhere; Astro 7 SSR (`apps/web`), shared logic in `packages/core`. Python only as an isolated worker if later needed. Rust only for a profiled hot spot.
- Postgres + pgvector is the single data store (not yet wired; Phase 0). Node >= 22.
- Layout: `apps/web` (site), `packages/core` (domain logic, no I/O frameworks), `deploy/olares/rogue` (chart), `scripts/` (ops), `docs/` (plans, ADRs, approvals).
- Code must be readable by a TypeScript/C#/Python developer who does not write code daily: small functions, plain names, comments explaining *why*.

## Working loop (every task)
1. Read `docs/PROGRESS.md` (state) and `docs/APPROVALS.md` (blockers). Pick the next unblocked roadmap item (`docs/ROADMAP.md`).
2. Branch `feat/<slug>` (or `cc/<slug>` when delegated to Claude Code). Never commit directly to `main` once branch protection is on; until then, small direct commits to `main` are allowed only for docs/CI plumbing.
3. Write the test first or alongside. `npm run check` must pass (typecheck, tests, build, version consistency).
4. Update `docs/PROGRESS.md` (one dated line: what changed, what is verified, what is left).
5. If you need something you cannot do (credentials, spend, external account, a decision), add an entry to `docs/APPROVALS.md` with the next free ID `RGE-Axx`, then **continue with other unblocked work**. Do not wait.
6. Commit with a conventional message (`feat:`, `fix:`, `docs:`, `chore:`). Small commits.

## Definition of done
Tests pass, `npm run check` green, docs updated, no secret in the diff, citations/rights rules respected, PROGRESS entry written. Never claim a result you did not run.

## Delivery pipeline (GitHub, Docker Hub, Olares)
`bump-version.sh` -> commit -> push `main` -> **CI** (`ci.yml`: typecheck/test/build) and **image build** (`build-image.yml`, pushes `cisakson/rogue:<version>` and `:latest`) -> `scripts/deploy.sh` on a host with `olares-cli` (package chart, upload, in-place upgrade, set route/auth) -> `scripts/verify.sh` (state + `/healthz` version). Full runbook: `docs/DEPLOY.md`.
Rules: bump version for every deploy (CI fails on drift); never uninstall the app; never hand-roll `olares-cli market` commands; the domain/route step is a hard gate.

## Secrets
Never print or commit secrets. Host token lives in `/opt/data/.env` (`GITHUB_TOKEN`, Hermes host only). CI secrets: `DOCKER_USERNAME`, `DOCKER_PASSWORD`. Never ask Cory to paste a credential in chat; use the vault/approval flow.

## Approval IDs
Blockers are tracked as `RGE-Axx` in `docs/APPROVALS.md` and emailed to Cory. Cory replies with IDs (e.g. "approve A02, A03; A05 = AGPL"). Update the file when resolved.

## Where decisions live
`docs/adr/NNNN-title.md` for architecture decisions (short: context, decision, consequences). Add one whenever you choose between real alternatives.
