/**
 * AI provider interfaces (design plan section 6). Each agent role asks for a capability ("chat", "embed")
 * and the instance config decides which provider answers. Default: Olares Router (local first).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string; // route name such as "default-chat", or "provider/model"
  temperature?: number;
  maxTokens?: number;
  /** Thinking budget for reasoning models, sent as `reasoning_effort`. 'none' skips thinking: short structured calls
   *  (rerank, query rewrite) answer in ~0.3 s instead of 2-8 s. Unset = the model's default. */
  reasoning?: ReasoningEffort;
}

export type ReasoningEffort = 'none' | 'low';

export interface ChatResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
}

export interface AiProvider {
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResult>;
  embed(inputs: string[], model?: string): Promise<EmbedResult>;
}
