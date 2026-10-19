# 0007. Consolidate the Nanobot agents: Reviewer + Librarian (Scout becomes a procedure)

Status: accepted (Cory 2026-10-19, after Hermes' evaluation)

## Context
The sidecar runs five agents (quality-curator, scout, librarian, terms-agent, faq-curator), each with its own port, derived token, job kind, tool list, settings entry and healthcheck. Live data (2026-10-19): quality_curate 46 jobs (9 needs_human, 1 page each), scout_variants 15 jobs (all found nothing), scout_judge 6, terms_judge 4, faq_curate 0 (never run), librarian_draft 14 (the only sustained multi-step work; up to 180 min, 400 tool iterations). Specs are 25-42 lines, 1-6 tools. Adding an agent (the proposed Extractor, ADR 0005) means changes in six places plus a sidecar image rebuild.

## Decision
- One `reviewer` agent with one skill per short propose-only review job: quality repair, terms judgement, FAQ canonicalisation, extractor page choice. The job kind selects the skill (instruction section) and the tool subset. Skills live in `sidecar/agents/reviewer/<skill>.md` and are loaded for the job's kind only (small local models route badly when given every skill at once).
- `librarian` stays separate (different runtime profile: hours, hundreds of tool calls).
- `scout` stops being a standing agent: its variant search never produced a result, and source judging is a skill the Reviewer can run (`scout_judge`). Variant search runs only when the Reviewer marks a source badly scanned.
- Keep the safety model unchanged: every tool takes job_id and refuses unless that job is running and its kind is allowed for the calling agent AND the tool belongs to that kind's tool subset; pure core functions decide; per-agent tokens derived from the shared key.
- Per-kind model settings (agent-settings.json) replace per-agent ones.

## Consequences
- 5 ports become 2 (reviewer 8901, librarian 8903); a new review job is a skill file + job kind + tools, no new port, token or healthcheck.
- Risk: one small model must handle several skills. Each migrated kind gets a before/after check against the old agent on the same jobs before the old agent is removed.
- Migration order: (1) add reviewer with the Extractor skill (`extract_review`); (2) move quality_curate; (3) terms_judge, faq_curate, scout_judge; (4) retire old specs/ports. Old agents keep working until their kind is moved. Sidecar VERSION and chart agentsImageTag bump together each step.
- Step 1 built (2026-10-19, sidecar 0.7.0): `reviewer` on 8901 with skill `extract_review`; `quality-curator` moved to 8906 until step 2. Skill loading: Nanobot reads one instruction file per process (workspace AGENTS.md) and has no per-request instructions, so `gen_config.py` appends every `agents/reviewer/<skill>.md` as a section `## Skill: <skill>` and the web app's task text names the one section to follow (`jobTask`). Chosen over one Nanobot process per skill because that brings back a port per skill. If a small model mixes skills up once several exist, switch to per-skill processes. Tool subsets: `JOB_TOOLS` in core; every tool passes its name to `agentMayActOn`, so a skill cannot call another skill's tools even though the agent's MCP list is the union.
- Step 2 built (2026-10-19, sidecar 0.8.0): `quality_curate` is the Reviewer skill `agents/reviewer/quality_curate.md` (ported from the quality-curator spec); `JOB_AGENT.quality_curate` is `reviewer` and `JOB_TOOLS.quality_curate` keeps it to get_job, get_page_text, reocr_page, propose_page_repair, mark_page_unusable, finish_job. The Reviewer's one `get_job` answers per job kind. Nothing else used the quality-curator agent, so its spec, port 8906, token and healthcheck entry are removed (its model setting `ROGUE_AGENT_MODEL_QUALITY_CURATOR` is gone too; set the reviewer model instead). Queued quality_curate jobs simply run on the Reviewer; no migration. The before/after check against the old agent is still to do on live jobs.
