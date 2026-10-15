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
- [~] Backup job + automated restore test done; restore CLI, Discord alerts, private/encrypted dump, files backup left
- [ ] Admin console Backups page; auth (login); design system; i18n skeleton
- [ ] `REVIEW_LOG.md` seeded with R1-R23 from the plan

## Later phases (see plan §11)
1 KB core · 1a Operator v0 · 1b Agent team + harness bake-off · 2 Learning loop · 3 Setup sheets · 4 Game chat ·
4b Rights/publisher program · 5 Public surfaces · 5b Ratings/organizers · 5c Admin/compliance · 6 MCP ·
7 Collections · 7b Cloud storage · 7c Self-host packaging · 8 Launch.

## Curation lifecycle (added 2026-10-15)
- [x] Policy: docs/CURATION_POLICY.md, docs/TAKEDOWN_RUNBOOK.md
- [~] Migration 0005: source availability, claim ratings, disproofs, takedown requests, source suggestions (done); recheck + takedown code (done); scheduled weekly recheck, weekly Discord digest, frontier-model confirmation step, rating UI (todo)

## Knowledge pipeline (added 2026-10-15)
- [x] Fetcher with rights gate; PDF text; page-cited chunk index; hybrid search + LLM rerank (hit@1 92% on 12-question eval)
- [x] Librarian v0: cited claim drafting with verbatim-quote + verifier gates (Pandemic: 99 claims)
- [ ] Librarian quality: frontier-model spot verification, bulk reject by creator, semantic dedupe
- [ ] Scheduled weekly recheck + Discord digest
- [ ] Rules chat (answer with quotes from search_rules, public UI behind login)
- [ ] Fit solver / sheet generation from claims instead of hand-built page
- [ ] Auth (OAuth), ratings UI, Discord bot
