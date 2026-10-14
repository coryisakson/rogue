import type { APIRoute } from 'astro';
import { getAi } from '../../lib/services';

/** Smoke test for the configured AI provider (tiny prompt). Private app, auth-gated by Olares. */
export const GET: APIRoute = async () => {
  const ai = getAi();
  if (!ai) return Response.json({ ok: false, reason: 'ROGUE_AI_BASE_URL not set' }, { status: 503 });
  const t = Date.now();
  try {
    const r = await ai.chat({ messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 16 });
    return Response.json({ ok: true, model: r.model, text: r.text.trim(), ms: Date.now() - t });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
};
