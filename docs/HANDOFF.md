# Handoff (rewritten 2026-10-16 evening). Keep this file under 3 KB; history lives in docs/archive/.

Live: https://rogue.cisakson.olares.com, version 0.0.94. Repo /opt/data/repos/rogue, main. Games: Pandemic, Slay the Spire.
Rulebook: AGENTS.md. Product principle: AI tasks -> Nanobot agents over MCP in background; plain code stays in app (ADR 0002).

## Next (ordered; do the first unfinished one)
0. MVP FOCUS (Cory 2026-10-16): answer-perfecting (item 2 remainder) is PAUSED. Work the one-pager gate: verify real print (browser print preview), card-size player aids, then item 3.
1. DONE in 0.0.90 (weights changed, visible on /admin/quality; evals not yet re-run). SOURCE WEIGHTS (Cory 2026-10-16, from the original brief). Order: rulebooks HIGHEST, then clarifications from the publisher or author (FAQ, errata, designer posts), then everything else (community, forum, Reddit). Code today (core index/authority.ts) ranks errata 1.3 > faq 1.2 > rulebook 1.1, which CONTRADICTS this: change it, keep the tier-2 weights below rulebook, test it, re-run evals. Weights must be visible per source in admin.
2. ASK EVALS to 10/10 (0.0.91: count fixed, roles=7; 0.0.92: eval patterns fixed; remaining: StS 'carries over between acts' answer misses deck/relics/gold, rulebook has Heal/Shuffle at Act change p.4 only; verify with a re-run)  on Pandemic and StS (re-enabled). State at 0.0.89 (MinerU OCR, re-indexed): Pandemic 8/10, StS 7/10 (single runs, ~1 question noise; baseline before MinerU 6 and 8). Fixes: (a) count questions ('how many roles') use the wide-retrieval + neighbour path list questions use (says 4, list says 7); (b) 'what carries over between acts' needs wider retrieval + prompt to cover what persists; (c) Pandemic Share Knowledge eval pattern wants the Researcher exception wording, answer is correct: fix the pattern and check the rulebook has the exception; (d) StS Retain/draw and Daze/exhaust expect BGG-forum answers that the rulebook lacks: solved by item 3, else change evals to expect a cited 'rulebook does not say'. StS p.5 is a picture, empty is correct.
3. EXTRA SOURCES (Reddit+BGG ruled out, R29/R30; remaining: run Scout for publisher FAQ/errata on both games) within terms (Cory): publisher sites often have extra info and FAQs (Scout already finds FAQ/errata links; use it for both games). BGG and Reddit answers only if NO terms violation: read BGG_NOTES.md (BGG blocks automated reads; API needs a registered app token, no re-exposing data) and Reddit API terms/robots first, record verdicts in REVIEW_LOG.md, and add an APPROVALS entry before ingesting. Forum/Reddit content gets the lowest weight and is only quoted briefly with citation.
4. Then: aid page shipped 0.0.94 (needs print test, card_size unset), Player Aid Agent (see BACKLOG), frontier judge (needs APPROVALS entry). Q&A-to-facts shipped (0 of 4 eligible).

## Done recently
MinerU OCR 0.0.86-0.0.89 (docs/OCR.md); chart 0.0.4 api-server at http://75f353a31.cisakson.olares.local. Both games re-indexed.

## Unverified live
FAQ Curator: POST /api/admin/faq-curate?game=pandemic, poll ?job=. Terms Agent auto-approve and scout_judge on a fresh request; Scout publisher-first run (0.0.66).

## Not now
BACKLOG.md items (BGG collection etc.) are not worked unless Cory names one. Off-box backups = Phase 7b.

## Gotchas (full deploy steps: skill rogue-project-workflow, docs/DEPLOY.md)
Admin token: Data/rogue/files/admin-token (header x-rogue-admin). Pod DNS needs ipv4Fetch. POST handlers need sameOrigin(). Layouts cannot redirect. Keep deploy steps in separate terminal calls. Hourly stall-check cron 9a8bfa208abe.
