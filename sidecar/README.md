# Rogue agents sidecar

Container `cisakson/rogue-agents` (python:3.12-slim + pinned `nanobot-ai[api]==0.3.5`) running Rogue's in-product agents
(ADR 0002) next to `web` and `db` in the Olares pod. One `nanobot serve` per spec in `agents/*.md`, bound to 127.0.0.1.

## Layout
- `agents/<name>.md` (+ optional skill files `agents/<name>/<skill>.md`): frontmatter `{name, port, tools, maxToolIterations, apiTimeout?, toolTimeout?}` (seconds; defaults 1500 and 60); body = agent instructions (written to the agent workspace `AGENTS.md`, which Nanobot injects into the system prompt; verified).
- `gen_config.py`: spec -> `/work/<name>/{config.json,workspace/AGENTS.md}` (idempotent). `run.py`: waits for the key file, generates, supervises (backoff restart, exit 1 if all give up, SIGTERM forwarded).
- `VERSION` -> image tag; CI `.github/workflows/build-agents-image.yml`; chart value `agentsImageTag` must match.

## Tool contract
Agents see only the MCP server `rogue` at `${ROGUE_MCP_URL}/<agent>` (stateless streamable HTTP: POST JSON-RPC, 405 on GET) with header `x-rogue-agent: <name>:<token>`; `enabledTools` is the spec's `tools` list.
- reviewer (8901, ADR 0007): one agent, one skill per short review job kind. `agents/reviewer.md` is the shared header; each
  `agents/reviewer/<skill>.md` (frontmatter `{skill, tools}`) becomes a section `## Skill: <skill>` of the instructions and adds its
  tools. Nanobot loads instructions per process, so the web app's task text names the one skill to follow; the web app also refuses
  any tool outside the job kind's subset (`JOB_TOOLS` in core). Skills: `extract_review` (get_job, get_page, propose_page_choice,
  finish_job): choose text layer, OCR or a merge for unsure PDF pages; `acceptPageChoice` (core) rejects invented words or numbers.
  `quality_curate` (get_job, get_page_text, reocr_page, propose_page_repair, mark_page_unusable, finish_job): repair OCR damage on weak
  pages; `acceptRepair` (core) rejects changed numbers or drifting wording. Moved from the retired quality-curator agent (ADR 0007 step 2).
- scout (8902): get_job, preview_url, propose_text_variant, propose_source, finish_job. Two job kinds: `scout_variants` (one PDF source:
  propose a text version; overlap and host gates in code) and `scout_judge` (one game request, `agent_jobs.request_id`: propose which
  publisher-page links are the official rulebook/faq/errata). `judgeSourcePick` decides each proposal (listed or same publisher site,
  robots, approved host, else needs_human); picks land in `agent_jobs.result.picks` and the request's scout report. Nothing is ingested.
- librarian (8903): get_job, get_page_text, propose_claim, finish_job. Job kind `librarian_draft` (one rulebook source). propose_claim runs
  the same gates as the in-process Librarian (verbatim quote, duplicate quote, verifier model) and publishes with a citation; counts
  drafted/published/rejected and lastPage in `agent_jobs.result`. Budget: 400 tool iterations, API timeout 10800s, toolTimeout 180s.
- terms-agent (8904): get_job, judge_sentences, finish_job. Job kind `terms_judge` (one game request, `agent_jobs.request_id`). Only
  for terms the code judged 'unclear' because of bot/AI sentences; the agent labels each sentence forbids/allows/unrelated/unsure and
  code (`decideTermsWithAgent`) sets the verdict when the job ends. Never changes a clear or restricted code verdict.
- faq-curator (8905): get_job, list_faq_candidates, propose_canonical, finish_job. Job kind `faq_curate` (one game, `agent_jobs.game_slug`;
  on demand via `POST /api/admin/faq-curate?game=<slug>`). Merges duplicate well-rated player questions into `faq_canonical` entries;
  `judgeCanonical` (core) requires the game's own non-hidden questions, citations from their sources and no new numbers. A finished
  job with entries replaces the game's older ones; without entries the public FAQ shows the rating tally.

Web app calls `POST http://127.0.0.1:<port>/v1/chat/completions` with `Authorization: Bearer <api key>`, body `{messages:[{role:'user',content}], session_id:'job-<id>'}` (no `model`). `/health` is open. API timeout 1500s, MCP toolTimeout 60s, unless the spec raises them (the app waits `JOB_MINUTES` per job kind).

## Env
`ROGUE_AI_BASE_URL` (Router, default in-cluster URL), `ROGUE_AI_CHAT_MODEL` (default `Olares/gemma4:e4b`), `ROGUE_MCP_URL` (default `http://127.0.0.1:4321/agent/mcp`), `ROGUE_AGENT_KEY_FILE` (default `/agent-share/agent-key`), `ROGUE_WORK_DIR` (`/work`), `ROGUE_KEY_WAIT_S` (600), `ROGUE_AGENTS_DIR`.

## Secrets
Never in git. Key = contents of the key file (written by the web app into the shared dir; mounted read-only here). `token = hex(HMAC-SHA256(key, name))`, `api key = hex(HMAC-SHA256(key, "api:"+name))`. Both sides derive the same values.

## Hardening
Config disables exec, file, cliApps, my, web, image generation, dream, heartbeat, transcription, channels; `restrictToWorkspace=true`. Nanobot's SSRF guard blocks loopback, so `tools.ssrfWhitelist` is set to the MCP host only (without it the MCP server is silently "blocked unsafe URL" and the model answers without tools).

## Tests
- `python3 sidecar/test/test_gen_config.py` (stdlib only).
- `bash sidecar/test/smoke.sh`: stub MCP (`test/stub_mcp.py`) + supervisor + real Router; creates a uv venv under `$TMPDIR/rogue-smoke`; passes when the model calls get_job and finish_job with the right header.

## IPv4 / DNS note
The Node app needs IPv4-only lookups for the Router host in pods. Nanobot uses httpx/openai (getaddrinfo, tries all families). Not reproducible here, so unverified in-pod. If the Router host fails to resolve or hangs there, mitigate by setting `ROGUE_AI_BASE_URL` to the Router's IPv4 address (with a Host header is not supported; use the IP URL if the Router answers on it) or add a `hostAliases` entry in the Deployment pointing `3a77b15d.shared.olares.com` at the IPv4 address.
