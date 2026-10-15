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
    const j = await this.post('/chat/completions', {
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    });
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
}
