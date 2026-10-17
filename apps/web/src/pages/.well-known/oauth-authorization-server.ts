import type { APIRoute } from 'astro';
import { authServerMetadata } from '@rogue/core';
import { metadataResponse, notFound, oauthEnabled, oauthOrigin, preflight } from '../../lib/oauth';

/** RFC 8414 Authorization Server Metadata. The issuer is the bare origin, so no path insertion. ADR 0004; 404 when off. */
export const GET: APIRoute = ({ request }) => (oauthEnabled() ? metadataResponse(authServerMetadata(oauthOrigin(request))) : notFound());
export const OPTIONS: APIRoute = () => preflight();
