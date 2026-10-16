import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import { loadServices, migrate, OpenAiCompatibleProvider, LocalStorageProvider, type AiRole } from '@rogue/core';

export const services = loadServices(process.env);

let pool: pg.Pool | null = null;
let migrated: Promise<void> | null = null;

export function getPool(): pg.Pool | null {
  if (!services.databaseUrl) return null;
  pool ??= new pg.Pool({ connectionString: services.databaseUrl, max: 5, connectionTimeoutMillis: 3000 });
  return pool;
}

/** Run pending migrations once per process, on first use. */
export function ensureMigrated(): Promise<void> {
  const p = getPool();
  if (!p) return Promise.resolve();
  migrated ??= (async () => {
    const client = await p.connect();
    try {
      await migrate(client, services.migrationsDir);
    } finally {
      client.release();
    }
  })().catch((e) => {
    migrated = null; // allow retry on next request
    throw e;
  });
  return migrated;
}

export const storage = new LocalStorageProvider(services.dataDir);

/**
 * fetch() replacement that resolves hostnames as IPv4 only. Inside Olares pods the default dual-stack lookup
 * fails (ENOTFOUND) for *.olares.com names while an IPv4 lookup works, so AI calls use this.
 */
export const ipv4Fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const mod = url.protocol === 'https:' ? https : http;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const req = mod.request(
      url,
      { method: init?.method ?? 'GET', headers, family: 4, signal: init?.signal ?? undefined },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502 })),
        );
      },
    );
    req.on('error', reject);
    if (init?.body) req.write(init.body as string | Uint8Array);
    req.end();
  })) as typeof fetch;

/** The default AI provider, or the one for a chat role (ROGUE_AI_<ROLE>_* override, else the default). */
export function getAi(role?: AiRole): OpenAiCompatibleProvider | null {
  if (role) {
    const r = services.aiRoles[role];
    if (!r.baseUrl) return null;
    return new OpenAiCompatibleProvider({
      baseUrl: r.baseUrl,
      ...(r.apiKey ? { apiKey: r.apiKey } : {}),
      defaultChatModel: r.model,
      defaultEmbedModel: services.aiEmbedModel,
      // An override (e.g. Anthropic's OpenAI-compatible endpoint) may reject reasoning_effort, so it is only sent to the default provider.
      sendReasoning: !r.overridden,
      fetchImpl: ipv4Fetch,
    });
  }
  if (!services.aiBaseUrl) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: services.aiBaseUrl,
    ...(services.aiApiKey ? { apiKey: services.aiApiKey } : {}),
    defaultChatModel: services.aiChatModel,
    defaultEmbedModel: services.aiEmbedModel,
    fetchImpl: ipv4Fetch,
  });
}

/** Is a chat role served by its own endpoint (not the default)? */
export const aiRoleOverridden = (role: AiRole): boolean => services.aiRoles[role].overridden;
