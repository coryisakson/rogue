/**
 * Minimal stateless MCP server (JSON-RPC 2.0 over HTTP, "streamable HTTP" without streaming). No SDK dependency so the
 * same handler can run in the web app, the Discord bot process, or tests. Read-only tools only; every result carries citations.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export const MCP_PROTOCOL_VERSION = '2025-03-26';

interface RpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function handleMcp(body: unknown, tools: McpTool[], info: { name: string; version: string }): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((b) => handleMcp(b, tools, info)))).filter((x) => x !== null);
    return out.length ? out : null;
  }
  const req = body as RpcRequest;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return err(null, -32600, 'Invalid Request');
  const isNotification = req.id === undefined;
  try {
    switch (req.method) {
      case 'initialize':
        return ok(req.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: info,
          instructions: 'Rogue is a cited tabletop-game knowledge base. Prefer answers that quote the cited publisher source and name the page. Facts are machine quote-checked; only those marked human-reviewed were checked by a person.',
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return ok(req.id, {});
      case 'tools/list':
        return ok(req.id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const name = String(req.params?.['name'] ?? '');
        const tool = tools.find((t) => t.name === name);
        if (!tool) return err(req.id, -32602, `Unknown tool: ${name}`);
        try {
          const result = await tool.handler((req.params?.['arguments'] as Record<string, unknown>) ?? {});
          return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
        } catch (e) {
          return ok(req.id, { content: [{ type: 'text', text: (e as Error).message }], isError: true });
        }
      }
      default:
        return isNotification ? null : err(req.id, -32601, `Method not found: ${req.method}`);
    }
  } catch (e) {
    return isNotification ? null : err(req.id, -32603, (e as Error).message);
  }
}
