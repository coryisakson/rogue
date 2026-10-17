import type { APIRoute } from 'astro';
import { protectedResourceMetadata } from '@rogue/core';
import { metadataResponse, notFound, oauthEnabled, oauthOrigin, preflight } from '../../../lib/oauth';

/** RFC 9728 Protected Resource Metadata for /mcp (path-inserted form; the URL our WWW-Authenticate points at). ADR 0004. */
export const GET: APIRoute = ({ request }) => (oauthEnabled() ? metadataResponse(protectedResourceMetadata(oauthOrigin(request))) : notFound());
export const OPTIONS: APIRoute = () => preflight();
