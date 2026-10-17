/**
 * MCP Server Card (SEP-2127, Final, Extensions Track): static, public metadata for pre-connection discovery.
 * Served at `<mcp-url>/server-card`, the location the SEP reserves. Field names follow the SEP text and the
 * MCP Registry's server.json where they overlap; cards deliberately list no tools (clients use tools/list).
 */
import { SUPPORTED_PROTOCOL_VERSIONS } from './server.js';

export interface ServerCardInput { name: string; title: string; version: string; description: string; mcpUrl: string; websiteUrl: string; repositoryUrl?: string }

export function buildServerCard(c: ServerCardInput): Record<string, unknown> {
  return {
    name: c.name,
    title: c.title,
    version: c.version,
    description: c.description,
    websiteUrl: c.websiteUrl,
    ...(c.repositoryUrl ? { repository: { url: c.repositoryUrl, source: 'github' } } : {}),
    remotes: [{ type: 'streamable-http', url: c.mcpUrl, supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] }],
  };
}
