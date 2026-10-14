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
}

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
