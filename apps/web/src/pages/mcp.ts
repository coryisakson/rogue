import type { APIRoute } from 'astro';
import { handleMcpHttp, mcpChallenge, parseBearer, PUBLIC_MCP_INSTRUCTIONS, PUBLIC_MCP_PROMPTS, publicTools, resourceMetadataUrl, userTools, type McpCaller, type McpTool } from '@rogue/core';
import { clientIp, mcpAllowedOrigins, mcpGeneral, mcpModel, publicKb, publicOrigin } from '../lib/mcp';
import { mcpResource, oauthEnabled, oauthLimits, oauthOrigin, verifyAccessToken, type TokenUser } from '../lib/oauth';
import { userApi } from '../lib/oauth-tools';
import { VERSION } from '../lib/version';

/** The caller's token, checked only when OAuth is on. Off: the Authorization header is ignored, as before. */
async function caller(request: Request): Promise<{ caller: McpCaller; user: TokenUser | null }> {
  const token = parseBearer(request.headers.get('authorization'));
  if (token === null) return { caller: { kind: 'anonymous' }, user: null };
  const user = token ? await verifyAccessToken(token, mcpResource(request)) : null;
  return user ? { caller: { kind: 'user', scopes: user.scopes }, user } : { caller: { kind: 'invalid' }, user: null };
}

/** The signed-in tools when a user is known; without one their handlers are never reached (the challenge answers 401). */
const anonymousApi = userApi({ userId: 0, name: '', provider: '', language: null, scopes: [], clientId: '' });

/**
 * MCP endpoint (Streamable HTTP, protocol 2026-07-28 plus the legacy initialize handshake). Public read-only tools need
 * no token. With ROGUE_MCP_OAUTH=1 (ADR 0004) the signed-in tools are listed too and need a bearer token with their scope;
 * without one the call answers 401 + WWW-Authenticate so the client can run OAuth. Limits per client IP (and per user).
 * Human docs: /docs/mcp.
 */
export const ALL: APIRoute = async ({ request }) => {
  const ip = clientIp(request);
  const origin = publicOrigin(request);
  let tools: McpTool[] = publicTools(publicKb(origin));
  let challenge: ((body: unknown) => ReturnType<typeof mcpChallenge>) | undefined;
  let allowRequest = () => mcpGeneral.allow(ip);
  if (oauthEnabled() && request.method === 'POST') {
    const who = await caller(request);
    const signedIn = userTools(who.user ? userApi(who.user) : anonymousApi);
    tools = [...tools, ...signedIn];
    challenge = (body) => mcpChallenge(body, tools, who.caller, resourceMetadataUrl(oauthOrigin(request)));
    if (who.user) { const id = String(who.user.userId); allowRequest = () => mcpGeneral.allow(ip) && oauthLimits.mcpUser.allow(id); }
  }
  return handleMcpHttp(request, {
    tools,
    info: { name: 'rogue', title: 'T-AI-bletop Rogue', version: VERSION, websiteUrl: `${origin}/docs/mcp` },
    options: { instructions: PUBLIC_MCP_INSTRUCTIONS, prompts: PUBLIC_MCP_PROMPTS, requireCitations: true, strictArgs: true, allowCostly: () => mcpModel.allow(ip) },
    allowedOrigins: mcpAllowedOrigins,
    allowRequest,
    ...(challenge ? { challenge } : {}),
  });
};
