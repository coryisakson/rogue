import { OpenAiCompatibleProvider, type SettingTest } from '@rogue/core';
import { aiConfig, getAi, getEmbedder, getReranker, ipv4Fetch } from './services';
import { getJudge } from './curator';
import { setting } from './settings';

/** Live "Test" buttons on /admin/settings: one tiny real call per endpoint, with latency. Never returns a key or token. */
export interface CheckResult { ok: boolean; ms: number; detail: string }

const ping = async (ai: OpenAiCompatibleProvider | null, sendNone: boolean, model?: string): Promise<string> => {
  if (!ai) return Promise.reject(new Error('no base URL configured'));
  const r = await ai.chat({ messages: [{ role: 'user', content: 'Reply with the word pong.' }], maxTokens: 64, ...(sendNone ? { reasoning: 'none' as const } : {}), ...(model ? { model } : {}) });
  return `model ${r.model}: "${r.text.trim().slice(0, 40)}"`;
};

async function getStatus(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await ipv4Fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: await res.text() };
}

async function check(test: SettingTest): Promise<string> {
  const cfg = aiConfig();
  switch (test) {
    case 'models': {
      const n = (await routerModels(true)).length;
      return `${n} models listed`;
    }
    case 'chat': case 'translate': case 'chat_multilingual':
      return ping(getAi(test), !cfg.aiRoles[test].overridden);
    case 'embed': {
      const ai = getEmbedder(); if (!ai) throw new Error('no base URL configured');
      const r = await ai.embed(['ping']);
      return `model ${r.model}: ${r.vectors[0]?.length ?? 0} dimensions${r.vectors[0]?.length === 768 ? '' : ' (index expects 768)'}`;
    }
    case 'rerank': {
      const rr = getReranker(); if (!rr) return 'no rerank model set: the chat model ranks (nothing to test here)';
      const order = await rr.ai.rerank('Which one is a fruit?', ['A car has four wheels.', 'An apple is a fruit.'], rr.model);
      if (order[0] !== 1) throw new Error(`unexpected order ${JSON.stringify(order)}`);
      return `model ${rr.model}: ranked the right document first`;
    }
    case 'judge': {
      const j = getJudge(); if (!j) throw new Error('judge base URL not set');
      return ping(j.ai, false, j.model);
    }
    case 'ocr': {
      const base = setting('ROGUE_OCR_BASE_URL'); if (!base) throw new Error('OCR base URL not set');
      const key = setting('ROGUE_OCR_API_KEY');
      const r = await getStatus(base, key ? { authorization: `Bearer ${key}` } : {});
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return `reachable (HTTP ${r.status}, provider ${setting('ROGUE_OCR_PROVIDER') ?? 'auto'})`;
    }
    case 'search': {
      const base = setting('ROGUE_SEARCH_BASE_URL'); if (!base) throw new Error('search base URL not set');
      const r = await getStatus(`${base.replace(/\/+$/, '')}/search?format=json&q=test`, { accept: 'application/json' });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const n = (JSON.parse(r.body) as { results?: unknown[] }).results?.length ?? 0;
      return `${n} results for "test"`;
    }
    case 'bgg': {
      const token = setting('ROGUE_BGG_TOKEN'); if (!token) throw new Error('BGG token not set');
      // No whoami endpoint exists: fetch one small thing (Die Macher, id 1); 401/403 means the token is wrong.
      const r = await getStatus('https://boardgamegeek.com/xmlapi2/thing?id=1', { authorization: `Bearer ${token}`, accept: 'application/xml', 'user-agent': 'Rogue (rules knowledge base)' });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return 'token accepted';
    }
  }
}

export async function runCheck(test: SettingTest): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const detail = await check(test);
    return { ok: true, ms: Date.now() - t0, detail };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: (e as Error).message.slice(0, 300) };
  }
}

let modelCache: { at: number; base: string; ids: string[] } | null = null;

/** Model ids the Router offers (GET {base}/models), cached 60 s. Empty when the Router is unset or unreachable (unless `strict`). */
export async function routerModels(strict = false): Promise<string[]> {
  const cfg = aiConfig();
  const base = cfg.aiBaseUrl;
  if (!base) { if (strict) throw new Error('Router base URL not set'); return []; }
  if (!strict && modelCache && modelCache.base === base && Date.now() - modelCache.at < 60_000) return modelCache.ids;
  try {
    const ids = await new OpenAiCompatibleProvider({ baseUrl: base, ...(cfg.aiApiKey ? { apiKey: cfg.aiApiKey } : {}), timeoutMs: 5000, fetchImpl: ipv4Fetch }).listModels();
    modelCache = { at: Date.now(), base, ids };
    return ids;
  } catch (e) {
    if (strict) throw e;
    return [];
  }
}
