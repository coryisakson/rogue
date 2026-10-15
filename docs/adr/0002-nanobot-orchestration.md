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
