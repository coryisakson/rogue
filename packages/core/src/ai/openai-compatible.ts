import type { AiProvider, ChatRequest, ChatResult, EmbedResult } from './types.js';

export interface OpenAiCompatibleOptions {
  /** Base URL ending in /v1, e.g. the Olares Router endpoint. */
  baseUrl: string;
  /** Optional bearer key. Inside Olares the caller identity is injected, so this is usually empty. */
  apiKey?: string;
  defaultChatModel?: string;
  defaultEmbedModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch; // injectable for tests
  /** Send `reasoning_effort` when a request sets it (default true). Off for per-role overrides such as Anthropic's
   *  OpenAI-compatible endpoint, which may reject the field. */
  sendReasoning?: boolean;
}

/** The /chat/completions request body. Optional fields are left out entirely so endpoints that do not know them are not confused. */
export function chatBody(req: ChatRequest, model: string, opts: { sendReasoning?: boolean } = {}): Record<string, unknown> {
  return {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0,
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    ...(req.reasoning !== undefined && opts.sendReasoning !== false ? { reasoning_effort: req.reasoning } : {}),
  };
}

/** Works with Olares Router, llama.cpp, Ollama, vLLM, OpenAI and any OpenAI-compatible endpoint. */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';
  private readonly f: typeof fetch;

  constructor(private readonly o: OpenAiCompatibleOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.o.apiKey) headers['authorization'] = `Bearer ${this.o.apiKey}`;
    const res = await this.f(`${this.o.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new Error(`AI request ${path} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const model = req.model ?? this.o.defaultChatModel ?? 'default-chat';
    const j = await this.post('/chat/completions', chatBody(req, model, { sendReasoning: this.o.sendReasoning ?? true }));
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error(`AI chat response missing choices[0].message.content: ${JSON.stringify(j).slice(0, 400)}`);
    return {
      text,
      model: j.model ?? model,
      promptTokens: j.usage?.prompt_tokens ?? 0,
      completionTokens: j.usage?.completion_tokens ?? 0,
    };
  }

  async embed(inputs: string[], model?: string): Promise<EmbedResult> {
    const m = model ?? this.o.defaultEmbedModel ?? 'default-embedding';
    const j = await this.post('/embeddings', { model: m, input: inputs });
    const vectors = (j?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
    if (vectors.length !== inputs.length) throw new Error('AI embeddings response size mismatch');
    return { vectors, model: j.model ?? m };
  }

  /** Cohere/Jina-style rerank (POST {base}/rerank). Returns document indexes, best first. Throws on any failure (callers fall back). */
  async rerank(query: string, documents: string[], model: string, topN?: number): Promise<number[]> {
    const j = await this.post('/rerank', { model, query, documents, ...(topN ? { top_n: topN } : {}) });
    return parseRerankResponse(j, documents.length);
  }

  /** Model ids the endpoint offers (GET {base}/models). */
  async listModels(): Promise<string[]> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.o.apiKey) headers['authorization'] = `Bearer ${this.o.apiKey}`;
    const res = await this.f(`${this.o.baseUrl.replace(/\/$/, '')}/models`, { headers, signal: AbortSignal.timeout(this.o.timeoutMs ?? 15_000) });
    if (!res.ok) throw new Error(`AI request /models failed: HTTP ${res.status}`);
    return parseModelList(await res.json());
  }
}

/** Indexes from a rerank answer ({results:[{index, relevance_score}]}, or {data:[...]}), sorted by score when given. Unknown or repeated indexes are dropped. */
export function parseRerankResponse(j: unknown, n: number): number[] {
  const list = (j as { results?: unknown; data?: unknown })?.results ?? (j as { data?: unknown })?.data;
  if (!Array.isArray(list)) throw new Error('rerank response has no results');
  const rows = list
    .map((r: { index?: unknown; relevance_score?: unknown; score?: unknown }, i: number) => ({ index: Number(r?.index), score: Number(r?.relevance_score ?? r?.score ?? -i) }))
    .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < n);
  rows.sort((a, b) => b.score - a.score);
  return [...new Set(rows.map((r) => r.index))];
}

/** Model ids from an OpenAI-style /models answer ({data:[{id}]}), sorted, without duplicates. */
export function parseModelList(j: unknown): string[] {
  const data = (j as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return [...new Set(data.map((m: { id?: unknown }) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean))].sort();
}
