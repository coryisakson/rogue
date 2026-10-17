import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import { loadServices, migrate, OpenAiCompatibleProvider, LocalStorageProvider, type AiEndpoint, type AiRole, type ServiceConfig } from '@rogue/core';
import { settingsEnv, settingsVersion } from './settings';

/** Infrastructure config (database, data dir, migrations): env only, fixed for the process. */
export const services = loadServices(process.env);

let aiCache: { version: number; cfg: ServiceConfig } | null = null;
/** Models, endpoints and keys as currently configured (lib/settings.ts: app_settings > env > default). */
export function aiConfig(): ServiceConfig {
  const env = settingsEnv(); // may start a background reload, which bumps the version
  const v = settingsVersion();
  if (!aiCache || aiCache.version !== v) aiCache = { version: v, cfg: loadServices(env) };
  return aiCache.cfg;
}

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
  const cfg = aiConfig();
  if (role) return endpointProvider(cfg.aiRoles[role], cfg.aiEmbedModel);
  if (!cfg.aiBaseUrl) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: cfg.aiBaseUrl,
    ...(cfg.aiApiKey ? { apiKey: cfg.aiApiKey } : {}),
    defaultChatModel: cfg.aiChatModel,
    defaultEmbedModel: cfg.aiEmbedModel,
    fetchImpl: ipv4Fetch,
  });
}

/** Provider for one configured endpoint (chat role, embeddings, rerank). Null when it has no base URL. */
export function endpointProvider(r: AiEndpoint, embedModel: string): OpenAiCompatibleProvider | null {
  if (!r.baseUrl) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: r.baseUrl,
    ...(r.apiKey ? { apiKey: r.apiKey } : {}),
    defaultChatModel: r.model,
    defaultEmbedModel: embedModel,
    // An override (e.g. Anthropic's OpenAI-compatible endpoint) may reject reasoning_effort, so it is only sent to the default provider.
    sendReasoning: !r.overridden,
    fetchImpl: ipv4Fetch,
  });
}

/** The embeddings provider: the Router unless ROGUE_AI_EMBED_BASE_URL gives embeddings their own endpoint. */
export function getEmbedder(): OpenAiCompatibleProvider | null {
  const e = aiConfig().aiEmbed;
  return endpointProvider(e, e.model);
}

/** The rerank model endpoint, or null when none is configured (the chat model ranks instead). */
export function getReranker(): { ai: OpenAiCompatibleProvider; model: string } | null {
  const r = aiConfig().aiRerank; if (!r) return null;
  const ai = endpointProvider(r, 'none');
  return ai ? { ai, model: r.model } : null;
}

/** Is a chat role served by its own endpoint (not the default)? */
export const aiRoleOverridden = (role: AiRole): boolean => aiConfig().aiRoles[role].overridden;
