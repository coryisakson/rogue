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

export function getAi(): OpenAiCompatibleProvider | null {
  if (!services.aiBaseUrl) return null;
  return new OpenAiCompatibleProvider({
    baseUrl: services.aiBaseUrl,
    ...(services.aiApiKey ? { apiKey: services.aiApiKey } : {}),
    defaultChatModel: services.aiChatModel,
    defaultEmbedModel: services.aiEmbedModel,
  });
}
