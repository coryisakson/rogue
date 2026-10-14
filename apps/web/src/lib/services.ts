import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import { loadServices, migrate, OpenAiCompatibleProvider, LocalStorageProvider } from '@rogue/core';

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
    if (init?.body) req.write(init.body as string);
    req.end();
  })) as typeof fetch;

export function getAi(): OpenAiCompatibleProvider | null {
  if (!services.aiBaseUrl) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: services.aiBaseUrl,
    ...(services.aiApiKey ? { apiKey: services.aiApiKey } : {}),
    defaultChatModel: services.aiChatModel,
    defaultEmbedModel: services.aiEmbedModel,
    fetchImpl: ipv4Fetch,
  });
}
