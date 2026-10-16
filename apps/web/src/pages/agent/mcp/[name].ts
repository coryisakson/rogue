import type { APIRoute } from 'astro';
import { AGENT_NAMES, handleMcp, verifyAgentHeader } from '@rogue/core';
import { agentKey } from '../../../lib/agent-jobs';
import { AGENT_TOOLS } from '../../../lib/agent-tools';
import { VERSION } from '../../../lib/version';

/**
 * MCP endpoint for the Nanobot sidecar. Public path in middleware (agents have no admin session), so the handler is the gate:
 * header `x-rogue-agent: <name>:<token>` must verify against the shared key and match the agent in the URL; anything else is a 404.
 * Each agent sees only its own propose-only tools.
 */
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const notFound = () => new Response('not found', { status: 404 });

export const POST: APIRoute = async ({ params, request }) => {
  const name = params['name'] ?? '';
  if (!(AGENT_NAMES as readonly string[]).includes(name)) return notFound();
  if (verifyAgentHeader(request.headers.get('x-rogue-agent'), agentKey()) !== name) return notFound();
  let body: unknown;
  try { body = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const res = await handleMcp(body, AGENT_TOOLS[name as (typeof AGENT_NAMES)[number]], { name: `rogue-${name}`, version: VERSION });
  return res === null ? new Response(null, { status: 202 }) : json(res);
};

// Stateless server: no SSE stream to offer, so GET says 405 as the streamable-HTTP spec asks.
export const GET: APIRoute = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
