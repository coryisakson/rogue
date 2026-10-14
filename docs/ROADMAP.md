# Roadmap (from design plan v13 §11)

Status key: [x] done, [~] in progress, [ ] not started, [!] blocked (see APPROVALS).

## Phase 0 · Foundations
- [x] Repo scaffold: Astro SSR + `@rogue/core` workspace, strict TS, vitest
- [x] Dockerfile, Olares chart (lints), version-sync scripts
- [x] CI workflow, image-build workflow, deploy/verify scripts
- [x] AGENTS.md, progress + approvals tracking
- [!] Docker Hub secrets in GitHub (RGE-A01) -> first image build
- [!] First deploy to Olares + route (RGE-A02)
- [ ] Postgres + pgvector service in the Olares chart, migrations tool, schema skeleton (rights grants, tombstone log)
- [ ] Storage Provider interface + local provider + conformance tests
- [ ] Backup job (nightly dump to mount), restore CLI, automated restore test
- [ ] Admin console Backups page; auth (login); design system; i18n skeleton
- [ ] `REVIEW_LOG.md` seeded with R1-R23 from the plan

## Later phases (see plan §11)
1 KB core · 1a Operator v0 · 1b Agent team + harness bake-off · 2 Learning loop · 3 Setup sheets · 4 Game chat ·
4b Rights/publisher program · 5 Public surfaces · 5b Ratings/organizers · 5c Admin/compliance · 6 MCP ·
7 Collections · 7b Cloud storage · 7c Self-host packaging · 8 Launch.
