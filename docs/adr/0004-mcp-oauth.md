# ADR 0004: OAuth 2.1 for signed-in MCP tools

Status: proposed (2026-10-17). Needs Cory's approval (RGE-A19). Until then the code ships behind `ROGUE_MCP_OAUTH=1`
(default off): with the flag off every `/oauth/*` and `/.well-known/oauth-*` route answers 404 and `/mcp` behaves exactly
as before (public read-only tools, `Authorization` header ignored).

## Context
`/mcp` is public and read-only (docs/MCP.md). Users asked for the same writes the website has: rate a fact, request a game.
Those need to know *who* is calling. The MCP spec (revision 2026-07-28, "Authorization", checked 2026-10-17; the draft
says the same) makes the MCP server an OAuth 2.1 resource server: Protected Resource Metadata (RFC 9728) is required,
PKCE S256 is required, clients send the `resource` parameter (RFC 8707) and servers must check that tokens were issued for
them. Client ID Metadata Documents are SHOULD; Dynamic Client Registration (RFC 7591) is MAY and marked deprecated but is
still what most clients (Claude, Claude Code, Inspector, ChatGPT) fall back to.

Alternatives considered: (a) an external IdP (Keycloak, Authentik, Olares auth) as authorization server: one more
service to run and its own user store, while Rogue already has GitHub/Google/Discord login and users; (b) personal API
keys pasted into clients: no standard discovery, keys leak into config files, no per-app revoke; (c) a separate
authenticated endpoint (`/mcp/user`): clients would need two connectors. Chosen: Rogue is its own small authorization
server, on the same origin, on top of the existing login.

## Decision
- **Roles.** Issuer = the public origin (`https://<host>`). Resource = `https://<host>/mcp` (canonical: lowercase scheme
  and host, no trailing slash, no fragment). The user signs in with the existing Rogue login; the AS has no passwords.
- **Discovery.** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` (RFC 9728;
  `authorization_servers: [issuer]`, `scopes_supported`, `bearer_methods_supported: ["header"]`).
  `/.well-known/oauth-authorization-server` (RFC 8414) with `code_challenge_methods_supported: ["S256"]`,
  `token_endpoint_auth_methods_supported: ["none"]`, `authorization_response_iss_parameter_supported: true` (RFC 9207).
  No OpenID Connect (no ID tokens, no userinfo).
- **Client registration.** `POST /oauth/register` (RFC 7591), public clients only (no secrets), `grant_types`
  authorization_code + refresh_token. Client ID Metadata Documents are *not* implemented yet: they make the AS fetch
  arbitrary URLs (SSRF surface) and need the same host guards as the rights fetcher; follow-up once a client requires it.
- **Flow.** Authorization code + PKCE S256 only (`plain` refused; verifier 43-128 chars). Code lifetime 5 minutes,
  single use; a second use revokes every token issued from that code's grant. The response carries `iss`.
- **Scopes.** `profile:read` (display name, sign-in provider, language), `facts:rate` (rate published facts 1-5),
  `games:request` (submit a game request into the normal admin queue). No admin scope exists and none will be issued
  over MCP. Unknown scopes are refused (`invalid_scope`); no `scope` = all three, shown on the consent screen.
  `offline_access` is not used (refresh tokens are always issued, per the spec's guidance that it is not a resource scope).
- **Tokens.** Opaque random 256-bit strings with a recognisable prefix (`rga_` access, `rgr_` refresh) so secret scanners
  can spot them. Access token 1 hour, bound to the resource (`/mcp`) and the granted scopes. Refresh token 30 days,
  rotated on every use (OAuth 2.1 for public clients); presenting an already-rotated or revoked refresh token revokes the
  whole grant (reuse detection). One consent = one *grant* (`grant_id`); revoking a grant kills all its tokens.
- **Storage.** Migrations 0035 (`oauth_clients`), 0036 (`oauth_codes`), 0037 (`oauth_tokens`). Codes and tokens are stored
  only as SHA-256 hashes (like `sessions`). Tokens, codes, verifiers and the `Authorization` header are never logged,
  never put in URLs (tokens in query strings are refused) and never echoed in errors.
- **Bearer check at `/mcp`.** No `Authorization` header: public tools work as today; signed-in tools are listed (marked
  "needs sign-in") and calling one answers HTTP 401 with
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="<tool scope>"`, which
  starts the client's OAuth flow. Invalid, expired, revoked or wrong-audience token: 401 `error="invalid_token"` on any
  request. Valid token without the tool's scope: 403 `error="insufficient_scope"` with the needed scope (step-up).
- **Writes use the website's gates.** `rate_fact` runs the same insert as `/rate` (published facts only, one rating per
  user, re-rating replaces, 30/min per user). `request_game` runs the same parsers and submit functions as
  `/request-game` (link mode: rights checks then admin approval; free-text mode: admin researches by hand), shares its
  5 per hour per user budget and its 5-open-requests cap. Nothing is published or ingested without an admin.
- **Consent screen** (`/oauth/authorize`). Shadcn card: the client's self-chosen name, labelled *unverified*, the host it
  will send you back to, the scopes in plain words, Allow / Deny. Signed out: the request is parked in a 10-minute
  HttpOnly cookie and the user goes through `/login`, then back. CSRF: same-origin check plus a token derived from the
  session; `frame-ancestors 'none'` against clickjacking. Re-shown on every authorization (no silent re-consent yet).
- **Connected apps** (`/oauth/apps`). Lists the user's live grants (app, scopes, first and last use) with Revoke.
  `POST /oauth/revoke` (RFC 7009) lets a client revoke its own token. Deleting the account cascades everything.
  (The brief asked for this on `/account`; that page is owned by other work, so it lives at `/oauth/apps` and `/account`
  should link to it once approved.)
- **Redirect URIs.** Registered list, exact string match at authorize and token time. Allowed: `https` (no userinfo, no
  fragment), `http` only on loopback (`localhost`, `127.0.0.1`, `[::1]`; the port may differ, RFC 8252 7.3), and
  private-use schemes of native apps (not `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `about:`, `ws(s):`, `ftp:`).
  Until the client and redirect URI are validated, errors are shown as a page and never redirected (no open redirect).
- **Rate limits** (in memory, per process, like the rest of Rogue): register 10/hour per IP, token 30/min per client,
  authorize 30/min per user, revoke 30/min per IP, signed-in MCP calls 60/min per user on top of the per-IP limits.

## Threat notes
- *Stolen access token*: 1 hour, header-only, scoped, revocable at `/oauth/apps`. Not sender-constrained (no DPoP yet).
- *Stolen refresh token*: rotation + reuse detection kills the grant when attacker and client race.
- *Code interception*: PKCE S256, single use, 5 minutes, bound to client + redirect URI + resource.
- *Malicious client registration* (anyone may register "Claude"): the consent screen shows *unverified* and the real
  redirect host; scopes are low-impact and every write still passes the website's human gates.
- *Confused deputy / token passthrough*: Rogue never forwards tokens; the provider tokens from GitHub/Google/Discord are
  used once at login and discarded, exactly as today.
- *Mix-up*: single AS, `iss` in the response.
- *CSRF on consent*: same-origin + session-bound token; cookies are SameSite=Lax.
- *DNS rebinding / browser callers*: existing Origin validation at `/mcp` is unchanged; `WWW-Authenticate` is exposed to CORS.
- *Data minimisation (GDPR)*: we store client name, redirect URIs, hashes, scopes, timestamps. No IPs are stored.

## Consequences
- Three tables and ~10 small routes; no new service, no new dependency.
- In-memory limits reset on restart (accepted for one instance, as elsewhere).
- Open follow-ups: Client ID Metadata Documents, remembering consent per client, DPoP, an `/account` link, a server-card
  `authorization` hint once SEP-2127 settles on a field, and tests against live Claude/ChatGPT connectors.
