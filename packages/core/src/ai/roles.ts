/**
 * Per-role AI endpoints. Each chat role can point at its own OpenAI-compatible endpoint; anything unset falls back to the
 * default ROGUE_AI_* settings (local first). Example: multilingual chat on Claude through Anthropic's OpenAI-compatible
 * endpoint while English stays on the local model:
 *   ROGUE_AI_MULTI_BASE_URL=https://api.anthropic.com/v1  ROGUE_AI_MULTI_API_KEY=(app secret)  ROGUE_AI_MULTI_MODEL=(model id)
 * Keys come from env only, never from code or chart values.
 */
export const AI_ROLES = ['chat', 'translate', 'chat_multilingual'] as const;
export type AiRole = (typeof AI_ROLES)[number];

/** Env prefix per role: ROGUE_AI_<PREFIX>_BASE_URL / _API_KEY / _MODEL. */
export const AI_ROLE_ENV: Record<AiRole, string> = { chat: 'CHAT', translate: 'TRANSLATE', chat_multilingual: 'MULTI' };

export interface AiEndpoint {
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  /** True when the role has its own base URL. Such endpoints never get `reasoning_effort` (it may be rejected). */
  overridden: boolean;
}

export function loadAiRole(env: Record<string, string | undefined>, role: AiRole): AiEndpoint {
  const p = `ROGUE_AI_${AI_ROLE_ENV[role]}_`;
  const defaultModel = env['ROGUE_AI_CHAT_MODEL'] || 'default-chat';
  const model = env[`${p}MODEL`] || defaultModel;
  const ownUrl = env[`${p}BASE_URL`] || null;
  // An own endpoint never inherits the default key: the local router's key must not be sent to a third party.
  if (ownUrl) return { baseUrl: ownUrl, apiKey: env[`${p}API_KEY`] || null, model, overridden: true };
  return { baseUrl: env['ROGUE_AI_BASE_URL'] || null, apiKey: env[`${p}API_KEY`] || env['ROGUE_AI_API_KEY'] || null, model, overridden: false };
}

export function loadAiRoles(env: Record<string, string | undefined>): Record<AiRole, AiEndpoint> {
  return Object.fromEntries(AI_ROLES.map((r) => [r, loadAiRole(env, r)])) as Record<AiRole, AiEndpoint>;
}

/**
 * Which role serves the two model calls of one rules-chat ask. Multilingual asks (user language not English, or the
 * question must be translated to the rulebook language) use the chat_multilingual override when it is configured;
 * otherwise the rewrite/translate step uses 'translate' (when translating) or 'chat', and the answer uses 'chat'.
 */
export function chatRoles(input: { userLang: string; translating: boolean; multiConfigured: boolean }): { rewrite: AiRole; answer: AiRole } {
  const multilingual = input.userLang !== 'en' || input.translating;
  if (multilingual && input.multiConfigured) return { rewrite: 'chat_multilingual', answer: 'chat_multilingual' };
  return { rewrite: input.translating ? 'translate' : 'chat', answer: 'chat' };
}
