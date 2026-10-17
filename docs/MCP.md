# MCP server

Public, read-only, cited. Endpoint `https://<host>/mcp`; human docs at `/docs/mcp`; server card at `/mcp/server-card`.
The Nanobot sidecar's private, token-guarded endpoints (`/agent/mcp/<agent>`) are separate (ADR 0002).

## Protocol
- Streamable HTTP, JSON responses only (no SSE, no sessions; `Mcp-Session-Id` ignored).
- Dual-era (spec 2026-07-28, "Backward Compatibility"):
  - modern: version in `params._meta["io.modelcontextprotocol/protocolVersion"]`, `server/discover`, `resultType`,
    headers `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` checked against the body (-32020), unsupported version -32022 (400),
    unknown method 404;
  - legacy: `initialize` echoes 2025-11-25, 2025-06-18, 2025-03-26 or 2024-11-05, else offers 2025-11-25; batches (max 16).
- POST only; notifications 202; GET/DELETE 405; OPTIONS answers CORS preflight.
- Origin: absent (server clients), same host, localhost (Inspector) or `ROGUE_MCP_ALLOWED_ORIGINS`; else 403.
- Body cap 64 KB (413), JSON only (415), Accept must allow JSON (406).
- `resources/list` is empty; `prompts/list` has `answer_rules_question`.

## Tools (packages/core/src/mcp/public-tools.ts)
`list_games`, `get_game_summary`, `get_game_facts`, `search_facts`, `ask_rules`*, `search_rules`*, `get_setup_sheet`,
`get_player_aid`, `list_sources`. All `readOnlyHint: true`, `openWorldHint: false`, with `title` and an `outputSchema`.
Results have text JSON plus `structuredContent`. Every result has `citations` (`title`, `url`, `page`, `quote`); with none,
the server returns `isError` instead (design plan: no claim without a source). Data comes only through `PublicKb`
(`apps/web/src/lib/mcp.ts`): published facts, short snippets, links. No files, no admin data, no writes.

## Limits (per client IP, per minute)
- `ROGUE_MCP_RATE_LIMIT` (30) per POST, 429 + `Retry-After` past it.
- `ROGUE_MCP_MODEL_RATE_LIMIT` (8) for the tools marked * (local AI); past it the tool returns isError "retry in a minute".

## Connect
- Claude Code: `claude mcp add --transport http rogue https://<host>/mcp`
- Claude / ChatGPT: custom connector with the URL.
- Inspector: `npx @modelcontextprotocol/inspector`, Streamable HTTP.

## Tests
`packages/core/src/mcp/*.test.ts`: protocol edge cases, HTTP layer, tools with a fake KB, and `sdk.e2e.test.ts` (official
`@modelcontextprotocol/sdk` client, dev dependency, over real HTTP; it speaks the legacy era).

## Later
OAuth-authenticated tools (rate facts, request games), registry / AI Catalog listing, checks with live clients.
The server card fields follow SEP-2127's text and registry `server.json`; not yet validated against the extension's `schema.ts`.
