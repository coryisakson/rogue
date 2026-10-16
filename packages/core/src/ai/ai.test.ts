import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider, chatBody } from './openai-compatible.js';
import { chatRoles, loadAiRole } from './roles.js';

function fakeFetch(handler: (url: string, body: any) => unknown, status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) =>
    new Response(JSON.stringify(handler(url, JSON.parse(String(init.body)))), { status })) as unknown as typeof fetch;
}

describe('OpenAiCompatibleProvider', () => {
  it('chats using the default-chat route and reports usage', async () => {
    const p = new OpenAiCompatibleProvider({
      baseUrl: 'http://router/v1/',
      fetchImpl: fakeFetch((url, body) => {
        expect(url).toBe('http://router/v1/chat/completions');
        expect(body.model).toBe('default-chat');
        return { model: 'm1', choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } };
      }),
    });
    expect(await p.chat({ messages: [{ role: 'user', content: 'yo' }] })).toEqual({
      text: 'hi', model: 'm1', promptTokens: 3, completionTokens: 1,
    });
  });

  it('sends reasoning_effort and max_tokens only when set', async () => {
    const bodies: any[] = [];
    const p = new OpenAiCompatibleProvider({
      baseUrl: 'http://router/v1',
      defaultChatModel: 'Olares/gemma4:e4b',
      fetchImpl: fakeFetch((_url, body) => { bodies.push(body); return { choices: [{ message: { content: '[1]' } }] }; }),
    });
    await p.chat({ messages: [{ role: 'user', content: 'rank' }], reasoning: 'none', maxTokens: 120 });
    await p.chat({ messages: [{ role: 'user', content: 'answer' }], reasoning: 'low', temperature: 0.2 });
    await p.chat({ messages: [{ role: 'user', content: 'plain' }] });
    expect(bodies[0]).toEqual({ model: 'Olares/gemma4:e4b', messages: [{ role: 'user', content: 'rank' }], temperature: 0, max_tokens: 120, reasoning_effort: 'none' });
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'low', temperature: 0.2 });
    expect(bodies[1]).not.toHaveProperty('max_tokens');
    expect(bodies[2]).not.toHaveProperty('reasoning_effort');
  });

  it('embeds and checks vector count', async () => {
    const p = new OpenAiCompatibleProvider({
      baseUrl: 'http://router/v1',
      fetchImpl: fakeFetch(() => ({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] })),
    });
    expect((await p.embed(['a', 'b'])).vectors).toEqual([[1, 2], [3, 4]]);
    await expect(p.embed(['only one'])).rejects.toThrow(/mismatch/);
  });

  it('throws a readable error on HTTP failure', async () => {
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://router/v1', fetchImpl: fakeFetch(() => ({ error: 'x' }), 503) });
    await expect(p.chat({ messages: [] })).rejects.toThrow(/HTTP 503/);
  });
});

describe('per-role AI endpoints', () => {
  const env = {
    ROGUE_AI_BASE_URL: 'http://router/v1', ROGUE_AI_API_KEY: 'local-key', ROGUE_AI_CHAT_MODEL: 'Olares/gemma4:e4b',
    ROGUE_AI_MULTI_BASE_URL: 'https://api.anthropic.com/v1', ROGUE_AI_MULTI_API_KEY: 'test-key', ROGUE_AI_MULTI_MODEL: 'claude-test',
  };

  it('falls back to the default endpoint unless the role has its own base URL', () => {
    expect(loadAiRole(env, 'chat')).toEqual({ baseUrl: 'http://router/v1', apiKey: 'local-key', model: 'Olares/gemma4:e4b', overridden: false });
    expect(loadAiRole({ ...env, ROGUE_AI_TRANSLATE_MODEL: 'small' }, 'translate')).toMatchObject({ baseUrl: 'http://router/v1', model: 'small', overridden: false });
    expect(loadAiRole(env, 'chat_multilingual')).toEqual({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'test-key', model: 'claude-test', overridden: true });
  });

  it('never sends the default key to an overridden endpoint', () => {
    expect(loadAiRole({ ...env, ROGUE_AI_MULTI_API_KEY: undefined }, 'chat_multilingual').apiKey).toBeNull();
  });

  it('request body: an overridden role gets no reasoning_effort, the default provider still does', async () => {
    const bodies: any[] = [];
    const fetchImpl = fakeFetch((_url, body) => { bodies.push(body); return { choices: [{ message: { content: 'ok' } }] }; });
    const multi = loadAiRole(env, 'chat_multilingual');
    const over = new OpenAiCompatibleProvider({ baseUrl: multi.baseUrl!, defaultChatModel: multi.model, sendReasoning: !multi.overridden, fetchImpl });
    const local = new OpenAiCompatibleProvider({ baseUrl: 'http://router/v1', defaultChatModel: 'Olares/gemma4:e4b', fetchImpl });
    await over.chat({ messages: [{ role: 'user', content: 'hallo' }], reasoning: 'low', maxTokens: 700 });
    await local.chat({ messages: [{ role: 'user', content: 'hi' }], reasoning: 'low' });
    expect(bodies[0]).toEqual({ model: 'claude-test', messages: [{ role: 'user', content: 'hallo' }], temperature: 0, max_tokens: 700 });
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'low' });
    expect(chatBody({ messages: [], reasoning: 'none' }, 'm', { sendReasoning: false })).not.toHaveProperty('reasoning_effort');
  });

  it('routes multilingual asks to the multilingual override only when it is configured', () => {
    expect(chatRoles({ userLang: 'de', translating: true, multiConfigured: true })).toEqual({ rewrite: 'chat_multilingual', answer: 'chat_multilingual' });
    expect(chatRoles({ userLang: 'en', translating: true, multiConfigured: true })).toEqual({ rewrite: 'chat_multilingual', answer: 'chat_multilingual' });
    expect(chatRoles({ userLang: 'en', translating: false, multiConfigured: true })).toEqual({ rewrite: 'chat', answer: 'chat' });
    expect(chatRoles({ userLang: 'de', translating: true, multiConfigured: false })).toEqual({ rewrite: 'translate', answer: 'chat' });
  });
});
