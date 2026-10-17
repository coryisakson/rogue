import type { APIRoute } from 'astro';
import { protectedResourceMetadata } from '@rogue/core';
import { metadataResponse, notFound, oauthEnabled, oauthOrigin, preflight } from '../../lib/oauth';

/** RFC 9728 Protected Resource Metadata, root form (MCP clients try /mcp path insertion first). ADR 0004; 404 when off. */
export const GET: APIRoute = ({ request }) => (oauthEnabled() ? metadataResponse(protectedResourceMetadata(oauthOrigin(request))) : notFound());
export const OPTIONS: APIRoute = () => preflight();
