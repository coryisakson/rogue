import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

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
