# Roadmap (from design plan v13 §11)

Status key: [x] done, [~] in progress, [ ] not started, [!] blocked (see APPROVALS).

## Phase 0 · Foundations
- [x] Repo scaffold: Astro SSR + `@rogue/core` workspace, strict TS, vitest
- [x] Dockerfile, Olares chart (lints), version-sync scripts
- [x] CI workflow, image-build workflow, deploy/verify scripts
- [x] AGENTS.md, progress + approvals tracking
- [x] Docker Hub secrets in GitHub (RGE-A01) -> image builds
- [x] First deploy to Olares + route (RGE-A02), live 0.0.7
- [x] Postgres + pgvector sidecar, migrations tool, schema skeleton, KB core tables
- [x] Storage Provider interface + local provider + conformance tests
- [x] Backup job, encrypted DB + files archive, automated restore test, restore CLI (scripts/restore.mjs), Discord failure alerts (needs webhook, RGE-A14)
- [x] Admin console; auth (login); design tokens (styles/rogue.css); i18n skeleton (packages/core/src/i18n)
- [x] `REVIEW_LOG.md` seeded with R1-R23 from the plan

## Phase 1 · KB core (in progress)
- [x] Rights-gated fetcher, PDF + HTML adapters, OCR (PaddleOCR-VL), QR links, page-cited chunk index, hybrid search + rerank
- [x] Librarian v0, provenance enforced in DB, review by exception, Curator auto-resolve, rules chat, ratings (facts + answers), Discord bot, add-game flow + Rights Officer v0
- [ ] First real HTML seed through the HTML adapter (adapter merged, never run on a live page)
- [ ] Authority ranking across sources (per-game, publisher > third party)
- [ ] Scout finds the rulebook link itself (search + publisher page link extraction); terms-of-use clause flagging
- [ ] Configure the frontier judge (ROGUE_JUDGE_*) so Curator can reject, not only restore
- [x] Rules FAQ from answer ratings (public 'N of M helpful', admin sees low-rated only) 0.0.58
- [ ] Live click-through of signed-in flows (Cory's browser)

## Phase 1b · Agent team on Nanobot (decision: docs/adr/0002-nanobot-orchestration.md)
No harness bake-off. Nanobot (HKUDS, MIT) is the multi-agent orchestrator; use only the features needed, nothing speculative.
- [ ] Run Nanobot as a Docker sidecar (own container, own volume, no access to the DB or data dir); only if it cannot run in-process/beside the pod without it
- [ ] Agent spec format: one small file per agent (role, allowed tools, model role); Scout, Rights Officer, Librarian, Designer as first specialists
- [ ] Scoped KB tools exposed to Nanobot over MCP (propose-only: propose_source, propose_claim; no direct publish, no rights-grant changes)
- [ ] Proposals land in the existing review queue / approvals; audit log entry per agent action; kill switch (one flag stops all agent runs)
- [ ] Jurisdiction Policy engine and opt-out checks stay deterministic code in core (agents propose, code decides)
- [ ] Exit test: given a game name, Scout + Librarian find permitted sources and propose cited facts; a human approves in the queue
- Out of scope: multi-harness comparison, scoring report, extra Nanobot channels (chat apps, WebUI, cron, memory/dream), sandboxing beyond the container boundary.

## Later phases (see plan §11)
1 KB core · 1a Operator v0 · 1b Agent team on Nanobot · 2 Learning loop · 3 Setup sheets · 4 Game chat ·
4b Rights/publisher program · 5 Public surfaces · 5b Ratings/organizers · 5c Admin/compliance · 6 MCP ·
7 Collections · 7b Cloud storage · 7c Self-host packaging · 8 Launch.

## Curation lifecycle (added 2026-10-15)
- [x] Policy: docs/CURATION_POLICY.md, docs/TAKEDOWN_RUNBOOK.md
- [~] Migration 0005: source availability, claim ratings, disproofs, takedown requests, source suggestions (done); recheck + takedown code (done); scheduled weekly recheck, weekly Discord digest, frontier-model confirmation step, rating UI (todo)

## Knowledge pipeline (added 2026-10-15)
- [x] Fetcher with rights gate; PDF text; page-cited chunk index; hybrid search + LLM rerank (hit@1 92% on 12-question eval)
- [x] Librarian v0: cited claim drafting with verbatim-quote + verifier gates (Pandemic: 99 claims)
- [ ] Librarian quality: frontier-model spot verification, bulk reject by creator, semantic dedupe
- [x] Scheduled weekly recheck + digest code (needs ROGUE_DISCORD_WEBHOOK_URL to post)
- [x] Rules chat v0 (cited answers only from excerpts; login gate later)
- [~] Fit solver v0 (line-budget claim selection) live; print fit check + variants table left
- [x] Auth (OAuth) code, needs provider credentials (docs/LOGIN_SETUP.md)
- [x] Ratings UI (facts)
- [x] Account deletion + ratings FK (GDPR)
- [ ] Review queue UI (admin) for Librarian claims; second source adapter (HTML), OCR, authority ranking
- [ ] Rate chat answers; Discord bot
