# 0002. Nanobot for multi-agent orchestration (no bake-off)

Status: accepted (Cory, 2026-10-15)

## Context
Plan v13 phase 1b called for running the same tasks on Hermes, DeepSeek Harness and Nanobot and scoring them. Cory decided the comparison is not worth the time.

## Decision
- Use Nanobot (github.com/HKUDS/nanobot, MIT, Python, OpenAI-compatible providers, MCP client, sub-agent spawn) for Rogue's in-product agent team.
- If it needs a runtime of its own, run it as a Docker sidecar next to the app. It talks to Rogue only through a narrow, token-protected MCP tool surface (propose-only) and to models through the Olares Router.
- Use only what Rogue needs: agent loop, sub-agent spawn, MCP tools, provider config. Do not enable chat channels, WebUI, memory consolidation or cron.
- Agents propose; deterministic code in core (rights gate, Jurisdiction Policy, provenance triggers) decides. Humans approve through the review queue.

## Consequences
- No scoring report; the plan's bake-off exit item is dropped.
- Agent specs stay in our own small format so another runner could replace Nanobot later (AGENTS.md rule 4, pluggable everything).
- Open check before building: Nanobot version/config format and its sandbox behaviour must be probed against the live release, not assumed.

## Live probe (2026-10-15, Hermes)
- Latest release v0.3.5 (2026-09-15); main moves daily (4,889 commits). `pip`-installable (`nanobot` entry point, installed cleanly into a venv), MIT.
- Config is one JSON file (`~/.nanobot/config.json`): `agents.defaults` (model, provider, maxToolIterations 200, maxConcurrentSubagents 4, `dream` memory consolidation ON by default, `idleCompact`), `providers`, `tools`, `channels`, `gateway`, `api`, `modelPresets`.
- Runs as an OpenAI-compatible API server: `nanobot serve --host --port --config --workspace` exposes `/v1/chat/completions`. That is the cheap integration: Rogue calls an agent as a chat model; no custom protocol.
- MCP client: `tools.mcpServers` (empty by default). Rogue's propose-only tools would be registered there.
- Dangerous defaults to switch off for Rogue: `tools.exec.enable` (shell), `tools.file.enable`, `tools.cliApps` (can install CLI apps), `tools.my`, `webuiAllowRemotePackageInstall`, `dream.enabled`, all `channels`. Keep `tools.web` only if the agent should browse (Rogue's own SSRF-guarded fetch is preferred, so likely off too). `restrictToWorkspace` is false by default: set true.
- Consequence: the sidecar is a Python container (not in the Node app image), config generated from our agent specs, reachable only inside the pod, models via Olares Router. Not built yet.
- Still to decide: whether Scout/Terms Agent decisions that are deterministic today (TypeScript in core) gain anything from an LLM loop. Proposal: wrap only the judgement steps (is this page the publisher's? is this terms sentence a prohibition?) as Nanobot agent calls, keep fetch, rights gate and approval in code.

## Principle: AI work goes to agents, the website stays fast (Cory, 2026-10-15)
- Straightforward code operations stay in code (web app, packages/core): fetching through the rights gate, robots/TDM checks, link extraction and ranking, SSRF guards, DB writes, approvals, rendering.
- AI tasks (anything that waits on a model) go to Nanobot agents over MCP/the OpenAI-compatible API: Librarian drafting and verifying claims, Terms Agent judgement of legal text, Scout's 'is this the publisher's page' calls, Curator, FAQ Curator, one-pager quality review, eval judging.
- The website never blocks on slow AI. It enqueues a job, shows status, and the agent writes back through propose-only tools (state in the DB: queued -> running -> done/needs human). Today's in-process queue (intake.ts), Librarian and Curator runs are the code that moves to agents.
- Open design point: interactive Ask answers are AI but a user waits for them. Plan: keep them a direct, streamed model call (or a fast agent endpoint with streaming); move everything that is not a live user wait to background agents.
- Agents propose; deterministic code decides; humans only see exceptions.
