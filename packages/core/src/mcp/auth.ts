/**
 * Bearer-token gate for the MCP endpoint (ADR 0004). Public tools need nothing; a tool with `scopes` needs a token that
 * carries them. Decided per POST from the parsed body, before any tool runs, so the client gets a real HTTP 401/403 with
 * WWW-Authenticate and can start (or step up) its OAuth flow.
 */
import { wwwAuthenticate } from '../auth/mcp-oauth.js';
import type { McpTool } from './server.js';

/** What the caller presented: no token, a token we rejected, or a valid token with its scopes. */
export type McpCaller = { kind: 'anonymous' } | { kind: 'invalid' } | { kind: 'user'; scopes: readonly string[] };

export interface McpChallenge { status: 401 | 403; wwwAuthenticate: string; message: string }

/** Scopes needed by the tools/call messages in this body (one message or a legacy batch), in tool order, no duplicates. */
export function scopesNeeded(body: unknown, tools: McpTool[]): string[] {
  const needed = new Set<string>();
  for (const m of Array.isArray(body) ? body : [body]) {
    if (typeof m !== 'object' || m === null) continue;
    const msg = m as Record<string, unknown>;
    const params = msg['params'] as Record<string, unknown> | undefined;
    if (msg['method'] !== 'tools/call' || typeof params?.['name'] !== 'string') continue;
    for (const s of tools.find((t) => t.name === params['name'])?.scopes ?? []) needed.add(s);
  }
  return [...needed];
}

/** null = go ahead. A rejected token is refused on every request (spec: invalid tokens MUST get 401). */
export function mcpChallenge(body: unknown, tools: McpTool[], caller: McpCaller, resourceMetadata: string): McpChallenge | null {
  if (caller.kind === 'invalid')
    return { status: 401, message: 'The access token is invalid, expired or revoked; sign in again.', wwwAuthenticate: wwwAuthenticate({ resourceMetadata, error: 'invalid_token' }) };
  const needed = scopesNeeded(body, tools);
  if (!needed.length) return null;
  const scope = needed.join(' ');
  if (caller.kind === 'anonymous')
    return { status: 401, message: `This tool needs a Rogue sign-in (scope ${scope}).`, wwwAuthenticate: wwwAuthenticate({ resourceMetadata, scope }) };
  const missing = needed.filter((s) => !caller.scopes.includes(s));
  if (!missing.length) return null;
  return {
    status: 403, message: `The token lacks scope ${missing.join(' ')}; authorize again with it.`,
    wwwAuthenticate: wwwAuthenticate({ resourceMetadata, scope, error: 'insufficient_scope', description: 'More permission needed for this tool' }),
  };
}
