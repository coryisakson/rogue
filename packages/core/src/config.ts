import { loadAiRoles, type AiEndpoint, type AiRole } from './ai/roles.js';

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
  /** Thinking budget for the final rules-chat answer (ROGUE_AI_ANSWER_REASONING). 'default' = send nothing, let the model decide. */
  aiAnswerReasoning: 'none' | 'low' | 'default';
  /** Rules-chat questions per signed-in user per day (ROGUE_CHAT_DAILY_LIMIT); admins are exempt. */
  chatDailyLimit: number;
  /** Per-role chat endpoints (ROGUE_AI_CHAT_* / ROGUE_AI_TRANSLATE_* / ROGUE_AI_MULTI_*), each falling back to the default. */
  aiRoles: Record<AiRole, AiEndpoint>;
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
    aiAnswerReasoning: parseReasoning(env['ROGUE_AI_ANSWER_REASONING']),
    chatDailyLimit: positiveInt(env['ROGUE_CHAT_DAILY_LIMIT'], 60),
    aiRoles: loadAiRoles(env),
  };
}

// 'low' keeps some thinking for rule answers (they need it) but cuts the ~430-token think the model does by default.
function parseReasoning(v: string | undefined): 'none' | 'low' | 'default' {
  return v === 'none' || v === 'default' ? v : 'low';
}

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
