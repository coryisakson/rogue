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
- [~] First real HTML seed: Pandemic product page seeded 0.0.60 (live ingest to verify)
- [x] Authority ranking across sources (kind x authority weight in retrieval fusion) 0.0.60
- [ ] Scout finds the rulebook link itself (search + publisher page link extraction); terms-of-use clause flagging
- [ ] Configure the frontier judge (ROGUE_JUDGE_*) so Curator can reject, not only restore
- [x] Rules FAQ from answer ratings (public 'N of M helpful', admin sees low-rated only) 0.0.58
- [x] Live click-through of signed-in flows (Cory confirmed 2026-10-15)

## Game intake pipeline (Cory 2026-10-15, replaces the 'paste a rulebook link' idea as the main path)
User types ONLY a game name -> Rogue shows a pick list of matches (BGG style: title, year, publisher, BGG link) -> user picks one -> admin approves the request -> it enters a job queue -> Scout agent finds publisher, rulebook, FAQ/errata by internet search -> Rights Officer checks (code) -> hand-off to Librarian -> game appears on the site. Manual link entry stays as a fallback.
- [x] (0.0.65) Catalog search provider interface (pluggable): BGG XML API v2 `search` (needs a registered app token; anonymous calls answer 401, probed 2026-10-15; RGE-A16), fallback provider if no token yet; results cached; only title/year/id/link stored, bgg_id kept on the game
- [x] (0.0.65) /request-game step 1: name box + pick list; step 2: user confirms the match; request stores bgg_id, no rulebook link needed
- [x] (0.0.65) Admin approves the request (name/publisher level), NOT yet a host: approval puts a job in the queue
- [x] (0.0.65) Job queue + stages (queued -> scouting -> rights check -> awaiting terms read -> ingest -> index -> librarian -> published), visible to requester and admin, retries, kill switch
- [x] (0.0.65) Scout web search tool (search provider pluggable; Firecrawl key exists on the Hermes host, needs an approval before use in the app) finds publisher page + document links; reuses Scout v0 (0.0.64) ranking and terms flagging
- [x] (0.0.65) Scout output goes to Rights Officer (code) then a second, small human gate for the terms-of-use read and host allowlisting; then Librarian
- [ ] Nanobot wraps these stages as agents/tools (ADR 0002)

## Priority queue for the next session (Cory 2026-10-15, set at end of session)
0. Game intake pipeline (section above): name search + pick list -> approve -> queue -> Scout search -> Rights -> Librarian.
1. Agent orchestration on Nanobot (Phase 1b, ADR 0002) and the Scout (finds rulebook link by search + publisher page link extraction; terms-of-use clause flagging). Cory wants these first.
2. FAQ test suite: web-search 10 real FAQs for Pandemic and 10 for Slay the Spire (BGG/publisher/forums, record the source URL and the expected answer with its rulebook page), store as an eval file (packages/core/eval/, like pandemic.json) and run each against the Ask endpoint (/api/admin/eval-rules style, answer + citation check). Include count/list questions (Pandemic roles). Do this before Phase 2.
3. One search box: merge the fact search and rules Ask into a single UI. Users only want answers; every answer is cited, so the separate fact list/search is not needed on the game page (facts stay internal; keep them reachable for admins).
Added by Cory 2026-10-15 (all before Phase 2; goal: fewer admin tasks through smart agent decisions):
- [x] (0.0.68) A. One search experience: merge fact search and rules Ask (see item 3). Users just want answers; citations make that enough.
- [x] (0.0.67) B. Terms-of-use agent: when Scout cannot clear a site itself, it also reads the site's terms of use / legal page and tries to verify automatically (bot, scraping, AI/TDM clauses). Scout hands off to a Terms Agent; the human admin is only asked when the agent cannot decide (exceptions only, like claim review).
- [x] (0.0.67) C. Host awareness: a CDN or asset host (e.g. cdn.svc.asmodee.net) is not the publisher. The agent must resolve the publisher site from the page that linked the file (referrer page host / game publisher) and judge the terms of that site, not the CDN. Today's message 'Terms of use of cdn.svc.asmodee.net are not read automatically. A human must check them...' must go away for such cases.
- [x] (0.0.68) D. /games page: shows the most popular games immediately (no long list to scroll), typeahead search, and when nothing matches shows the 'missing game' question with a link to /request-game.
Then the MVP-focus items below.

## MVP focus (Cory 2026-10-15)
Most valuable for MVP: (1) generated setup one-pagers, (2) Ask about the game / rules. Individual facts are internal building blocks for those, not a user-facing product; the game page shows them collapsed.
- [x] Aggregate questions ("how many roles are there") answered by collecting items across excerpts and counting them (wider retrieval + neighbour chunks + list prompt) 0.0.59
- [x] Game cards on /games no longer link to BGG (details page keeps it) 0.0.62
- [ ] Principle: facts a rule never states outright ("how many roles in Pandemic": no number printed, 7 role cards listed) are derived by chat from the listed items and counted; the eval set must include such questions and the expected count, and the answer must cite the pages listing the items
- [x] Web-page sources are cited by section heading, not a fake page number (chunks.locator, (s.N) in prompts, 0.0.63)
- [ ] Printed page numbers: PDF citations use the physical page index (the PDF has no page labels, checked on Slay the Spire). Detect the number printed in header/footer when consistent across pages, show 'PDF page N (printed M)'; fall back to physical
- [ ] Measure it: add list/count questions (Pandemic roles, Slay the Spire characters/card types) to the eval set and check the answers; tune retrieval depth
- [ ] User Q&A become facts: a well-rated cited answer is stored as a 'qa' candidate fact (question, answer, page citations). Citations must be on retrieved pages, same provenance rules as any claim
- [ ] FAQ Curator agent (runs occasionally, Phase 1b): merges duplicate/near-duplicate Q&A, rewrites into one concise canonical answer with citations, drops low-rated or uncited ones, publishes the common Q&A list per game (replaces raw question text on /games/<slug>/faq). Proposes; admin sees exceptions only
- [ ] One-pager quality is the other MVP gate: print fit check, player-count variants table (or explicit 'none'), look at the real print

## Phase 1b · Agent team on Nanobot (decision: docs/adr/0002-nanobot-orchestration.md)
Principle (Cory 2026-10-15): AI tasks run in Nanobot agents (via MCP) in the background; plain code operations stay in the web app so the site stays fast. Move in this order: Librarian runs, Terms Agent judgement, Scout page judgement, Curator. Live Ask stays a direct streamed call.
No harness bake-off. Nanobot (HKUDS, MIT) is the multi-agent orchestrator; use only the features needed, nothing speculative.
- [ ] Run Nanobot as a Docker sidecar (own container, own volume, no access to the DB or data dir); only if it cannot run in-process/beside the pod without it
- [ ] Agent spec format: one small file per agent (role, allowed tools, model role); Scout, Rights Officer, Librarian, Designer as first specialists
- [ ] Scoped KB tools exposed to Nanobot over MCP (propose-only: propose_source, propose_claim; no direct publish, no rights-grant changes)
- [ ] Proposals land in the existing review queue / approvals; audit log entry per agent action; kill switch (one flag stops all agent runs)
- [ ] Jurisdiction Policy engine and opt-out checks stay deterministic code in core (agents propose, code decides)
- [ ] Exit test: given a game name, Scout + Librarian find permitted sources and propose cited facts; a human approves in the queue
- Out of scope: multi-harness comparison, scoring report, extra Nanobot channels (chat apps, WebUI, cron, memory/dream), sandboxing beyond the container boundary.

## Accessibility and design system (added 2026-10-16, Cory; unattended-friendly, see docs/adr/0003-design-system-and-accessibility.md)
Target: Section 508 = WCAG 2.2 AA, plus an ACR/VPAT. Work these in order, one PR-sized item per session; none needs Cory except the sign-off at the end.
- [ ] A1 Audit: run axe-core (and Lighthouse) against the live pages with a headless browser (home, games, game chat, facts, setup, aid, faq, login, account, request-game, about; admin pages via admin session). Save the report as docs/a11y/audit-<date>.md with counts by rule and a fix list. No fixes yet.
- [ ] A2 Quick fixes on the current CSS: colour contrast 4.5:1 (text) / 3:1 (UI), visible focus rings, skip-to-content link, labels for every input and emoji button (vote buttons), `aria-live="polite"` for new chat answers, heading order, table headers/captions, `lang` per language, reduced-motion for spinners, 200% zoom/reflow at 320px. Add an automated axe check to scripts/qcheck.sh or CI so regressions fail.
- [ ] A3 Design tokens: move colours/spacing/type into CSS variables (light + dark); keep class names (.btn, .card, .pill) working.
- [ ] A4 Pilot shadcn/ui: add Tailwind + `@astrojs/react` + shadcn init in apps/web; port ONE widget (language switcher as an accessible Select) and the chat input/thread as islands; measure JS size and page speed; write the result into ADR 0003 (accept or fall back to Zag.js/Ark UI).
- [x] A5 Migrate pages to the design system one at a time (game page, facts, account, login, then admin); axe must stay clean after each.
- [ ] A6 Print/sheet accessibility: setup sheet, player aid and cut-out sheet have text alternatives, logical reading order, and a high-contrast print option.
- [ ] A7 Manual pass: keyboard-only walkthrough of every flow; NVDA + VoiceOver notes in docs/a11y/manual-<date>.md. Cory (or a tester) confirms screen-reader behaviour.
- [ ] A8 Publish docs/a11y/ACR.md (VPAT 2.5 WCAG edition) from the audits; link from /about and the footer, plus an accessibility statement page and a feedback contact.
- [ ] Acceptance: axe reports 0 serious/critical on all pages, keyboard-only works end to end, ACR published.

## Later phases (see plan §11)
1 KB core · 1a Operator v0 · 1b Agent team on Nanobot · 2 Learning loop · 3 Setup sheets · 4 Game chat ·
4b Rights/publisher program · 5 Public surfaces · 5b Ratings/organizers · 5c Admin/compliance · 6 MCP ·
7 Collections · 7b Cloud storage · 7c Self-host packaging · 8 Launch.

## Phase 6: MCP (docs/MCP.md)
- [x] Public read-only /mcp: Streamable HTTP, protocol 2026-07-28 plus legacy initialize (2025-11-25 ... 2024-11-05), Origin/CORS, 64 KB cap
- [x] Per-IP limits (30/min, 8/min for ask_rules + search_rules); every tool result cited, else isError
- [x] 9 tools incl. get_player_aid, list_sources, get_game_summary; tested with the official SDK client
- [x] /docs/mcp page (5 languages, footer + /about), server card at /mcp/server-card
- [ ] Verify with real clients (Claude connector, ChatGPT, MCP Inspector) on the live instance
- [ ] Authenticated tools over OAuth (rate facts, request games); needs an auth design + approval
- [ ] Publish to the MCP Registry / AI Catalog once the live URL is stable

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
