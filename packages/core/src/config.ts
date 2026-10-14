/**
 * Instance profile (see design plan section 7f). Phase 0 only defines the shape and EU defaults.
 * Everything instance-specific (name, domain, region, policy pack) lives here, never hard-coded elsewhere.
 */
export interface InstanceProfile {
  name: string;
  region: 'eu' | 'us' | 'other';
  policyPack: string;
  localOnly: boolean;
}

export const DEFAULT_PROFILE: InstanceProfile = {
  name: 'Rogue',
  region: 'eu',
  policyPack: 'eu-default',
  localOnly: false,
};

export function loadProfile(env: Record<string, string | undefined> = {}): InstanceProfile {
  const region = env['ROGUE_REGION'];
  return {
    name: env['ROGUE_INSTANCE_NAME'] ?? DEFAULT_PROFILE.name,
    region: region === 'us' || region === 'other' ? region : 'eu',
    policyPack: env['ROGUE_POLICY_PACK'] ?? DEFAULT_PROFILE.policyPack,
    localOnly: env['ROGUE_LOCAL_ONLY'] === 'true',
  };
}

/** External services the single app container talks to (design: DB, storage and AI live outside the app image). */
export interface ServiceConfig {
  databaseUrl: string | null;
  dataDir: string;
  migrationsDir: string;
  aiBaseUrl: string | null;
  aiApiKey: string | null;
  aiChatModel: string;
  aiEmbedModel: string;
}

export function loadServices(env: Record<string, string | undefined> = {}): ServiceConfig {
  return {
    databaseUrl: env['DATABASE_URL'] || null,
    dataDir: env['ROGUE_DATA_DIR'] || '/app/data',
    migrationsDir: env['ROGUE_MIGRATIONS_DIR'] || '/app/packages/core/migrations',
    aiBaseUrl: env['ROGUE_AI_BASE_URL'] || null,
    aiApiKey: env['ROGUE_AI_API_KEY'] || null,
    aiChatModel: env['ROGUE_AI_CHAT_MODEL'] || 'default-chat',
    aiEmbedModel: env['ROGUE_AI_EMBED_MODEL'] || 'default-embedding',
  };
}
