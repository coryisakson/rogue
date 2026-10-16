import { describe, expect, it } from 'vitest';
import { AGENT_NAMES, AGENT_PORTS, JOB_AGENT, JOB_KINDS, JOB_MINUTES, agentApiKey, agentMayActOn, agentToken, verifyAgentHeader } from './index.js';

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
  it('accepts the librarian header and keeps ports unique', () => {
    expect(verifyAgentHeader(`librarian:${agentToken('k', 'librarian')}`, 'k')).toBe('librarian');
    expect(AGENT_PORTS.librarian).toBe(8903);
    expect(new Set(AGENT_NAMES.map((n) => AGENT_PORTS[n])).size).toBe(AGENT_NAMES.length);
  });
});

describe('agent jobs', () => {
  it('maps every job kind to a known agent with a time budget', () => {
    expect(JOB_AGENT.librarian_draft).toBe('librarian');
    for (const k of JOB_KINDS) { expect(AGENT_NAMES).toContain(JOB_AGENT[k]); expect(JOB_MINUTES[k]).toBeGreaterThan(0); }
    expect(JOB_MINUTES.librarian_draft).toBeGreaterThan(JOB_MINUTES.scout_variants);
  });
  it('refuses tool calls on jobs that are not running or belong to another agent', () => {
    expect(agentMayActOn('librarian', { kind: 'librarian_draft', status: 'running' })).toBe(true);
    expect(agentMayActOn('librarian', { kind: 'librarian_draft', status: 'queued' })).toBe(false);
    expect(agentMayActOn('librarian', { kind: 'librarian_draft', status: 'done' })).toBe(false);
    expect(agentMayActOn('scout', { kind: 'librarian_draft', status: 'running' })).toBe(false);
    expect(agentMayActOn('librarian', { kind: 'scout_variants', status: 'running' })).toBe(false);
    expect(agentMayActOn('librarian', { kind: 'unknown', status: 'running' })).toBe(false);
    expect(agentMayActOn('librarian', null)).toBe(false);
  });
  it('gives terms_judge jobs only to the terms agent', () => {
    expect(JOB_AGENT.terms_judge).toBe('terms-agent');
    expect(AGENT_PORTS['terms-agent']).toBe(8904);
    expect(verifyAgentHeader(`terms-agent:${agentToken('k', 'terms-agent')}`, 'k')).toBe('terms-agent');
    expect(agentMayActOn('terms-agent', { kind: 'terms_judge', status: 'running' })).toBe(true);
    expect(agentMayActOn('scout', { kind: 'terms_judge', status: 'running' })).toBe(false);
    expect(agentMayActOn('terms-agent', { kind: 'scout_variants', status: 'running' })).toBe(false);
  });
  it('gives scout_judge jobs only to the scout, with a time budget', () => {
    expect(JOB_KINDS).toContain('scout_judge');
    expect(JOB_AGENT.scout_judge).toBe('scout');
    expect(JOB_MINUTES.scout_judge).toBe(25);
    expect(agentMayActOn('scout', { kind: 'scout_judge', status: 'running' })).toBe(true);
    expect(agentMayActOn('scout', { kind: 'scout_judge', status: 'queued' })).toBe(false);
    expect(agentMayActOn('terms-agent', { kind: 'scout_judge', status: 'running' })).toBe(false);
  });
});
