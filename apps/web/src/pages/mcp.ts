import type { APIRoute } from 'astro';
import { handleMcpHttp, PUBLIC_MCP_INSTRUCTIONS, PUBLIC_MCP_PROMPTS, publicTools } from '@rogue/core';
import { clientIp, mcpAllowedOrigins, mcpGeneral, mcpModel, publicKb, publicOrigin } from '../lib/mcp';
import { VERSION } from '../lib/version';

/**
 * Public, read-only MCP endpoint (Streamable HTTP, protocol 2026-07-28 plus the legacy initialize handshake).
 * No admin token: the tool list in publicTools() is the whole surface. Rate limits per client IP, body capped at 64 KB.
 * Human docs: /docs/mcp. Authenticated tools (OAuth) are a later milestone.
 */
export const ALL: APIRoute = ({ request }) => {
  const ip = clientIp(request);
  return handleMcpHttp(request, {
    tools: publicTools(publicKb(publicOrigin(request))),
    info: { name: 'rogue', title: 'T-AI-bletop Rogue', version: VERSION, websiteUrl: `${publicOrigin(request)}/docs/mcp` },
    options: { instructions: PUBLIC_MCP_INSTRUCTIONS, prompts: PUBLIC_MCP_PROMPTS, requireCitations: true, strictArgs: true, allowCostly: () => mcpModel.allow(ip) },
    allowedOrigins: mcpAllowedOrigins,
    allowRequest: () => mcpGeneral.allow(ip),
  });
};
