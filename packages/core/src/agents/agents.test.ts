import { describe, expect, it } from 'vitest';
import { agentApiKey, agentToken, verifyAgentHeader } from './index.js';

describe('agent identity', () => {
  it('derives distinct, stable secrets per agent', () => {
    expect(agentToken('k', 'scout')).toBe(agentToken('k', 'scout'));
    expect(agentToken('k', 'scout')).not.toBe(agentToken('k', 'quality-curator'));
    expect(agentToken('k', 'scout')).not.toBe(agentApiKey('k', 'scout'));
    expect(agentToken('k', 'scout')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('verifies only a matching name and token', () => {
    const ok = `scout:${agentToken('k', 'scout')}`;
    expect(verifyAgentHeader(ok, 'k')).toBe('scout');
    expect(verifyAgentHeader(ok, 'other')).toBeNull();
    expect(verifyAgentHeader(`quality-curator:${agentToken('k', 'scout')}`, 'k')).toBeNull();
    expect(verifyAgentHeader('nobody:abc', 'k')).toBeNull();
    expect(verifyAgentHeader(null, 'k')).toBeNull();
    expect(verifyAgentHeader(ok, null)).toBeNull();
  });
});
