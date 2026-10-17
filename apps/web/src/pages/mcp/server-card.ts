import type { APIRoute } from 'astro';
import { buildServerCard } from '@rogue/core';
import { publicOrigin } from '../../lib/mcp';
import { VERSION } from '../../lib/version';

/** MCP Server Card (SEP-2127) at <mcp-url>/server-card: public metadata, open CORS as the SEP allows, cacheable. */
export const GET: APIRoute = ({ request }) => {
  const origin = publicOrigin(request);
  const card = buildServerCard({
    name: 'rogue', title: 'T-AI-bletop Rogue', version: VERSION,
    description: 'Read-only, cited tabletop-game rules knowledge: games, facts with sources, rulebook search, rules Q&A, setup sheets and player aids.',
    mcpUrl: `${origin}/mcp`, websiteUrl: `${origin}/docs/mcp`, repositoryUrl: 'https://github.com/coryisakson/rogue',
  });
  return new Response(JSON.stringify(card, null, 2), {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' },
  });
};
