# MCP server

Public, read-only, cited (signed-in write tools behind a flag: see "Signed-in tools"). Endpoint `https://<host>/mcp`; human docs at `/docs/mcp`; server card at `/mcp/server-card`.
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

## Signed-in tools (OAuth 2.1, ADR 0004; off unless `ROGUE_MCP_OAUTH=1`, approval RGE-A19)
- Flag off: nothing changes. The `/oauth/*` and `/.well-known/oauth-*` routes answer 404 and `Authorization` is ignored.
- Flag on: `tools/list` adds `get_my_profile` (`profile:read`), `rate_fact` (`facts:rate`) and `request_game`
  (`games:request`) (packages/core/src/mcp/user-tools.ts). Public tools still need no token.
  - Calling a signed-in tool without a token: HTTP 401 +
    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp", scope="facts:rate"`.
  - Token without the scope: 403 `error="insufficient_scope"`. Invalid/expired/revoked token on any request: 401 `invalid_token`.
  - The gate runs per POST before any tool (packages/core/src/mcp/auth.ts, `challenge` hook in http.ts).
- Writes run the website's logic (apps/web/src/lib/oauth-tools.ts): rating = the `/rate` insert (published facts only);
  game request = the `/request-game` parsers + `submitRequest`/`submitDetails`, sharing its 5/hour per-user budget.
  An admin still approves every game. Write results are receipts (`receipt: true`), so the citation rule skips them.
- Authorization server (apps/web/src/lib/oauth.ts, helpers in packages/core/src/auth/mcp-oauth.ts):
  - `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728), `/.well-known/oauth-authorization-server` (RFC 8414).
  - `POST /oauth/register` (RFC 7591, public clients only), `/oauth/authorize` (consent page; PKCE S256 required,
    `resource` must be `<origin>/mcp`, `iss` in the response), `POST /oauth/token` (code + verifier; refresh rotation
    with reuse detection), `POST /oauth/revoke` (RFC 7009), `/oauth/apps` (connected apps, revoke).
  - Tokens: `rga_` access 1 h, `rgr_` refresh 30 days; only SHA-256 hashes stored (migrations 0035-0037).
  - Redirect URIs: exact match; https, loopback http (port may vary) or native app schemes. No redirect before the
    client and redirect URI are verified.
  - `ROGUE_PUBLIC_URL` pins the issuer/resource; otherwise the proxy headers decide (as for `/mcp`).
- Not yet: Client ID Metadata Documents, remembered consent, DPoP, an `/account` link to `/oauth/apps`, live client tests.

## Later
Registry / AI Catalog listing, checks with live clients.
The server card fields follow SEP-2127's text and registry `server.json`; not yet validated against the extension's `schema.ts`.
