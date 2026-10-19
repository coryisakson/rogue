import { describe, expect, it } from 'vitest';
import { AGENT_NAMES, AGENT_PORTS, JOB_AGENT, JOB_KINDS, JOB_MINUTES, JOB_TOOLS, agentApiKey, agentMayActOn, agentToken, jobSkill, verifyAgentHeader } from './index.js';

describe('reviewer skills (ADR 0007)', () => {
  it('runs extract_review and quality_curate on the reviewer at port 8901; the quality curator is retired', () => {
    expect(JOB_AGENT.extract_review).toBe('reviewer');
    expect(JOB_AGENT.quality_curate).toBe('reviewer');
    expect(AGENT_PORTS.reviewer).toBe(8901);
    expect(AGENT_NAMES as readonly string[]).not.toContain('quality-curator');
    expect(Object.values(AGENT_PORTS)).not.toContain(8906);
    expect(jobSkill('extract_review')).toBe('extract_review');
    expect(jobSkill('quality_curate')).toBe('quality_curate');
    expect(jobSkill('scout_judge')).toBeNull();
  });
  it('lists a tool subset for every kind, always with get_job and finish_job', () => {
    for (const k of JOB_KINDS) { expect(JOB_TOOLS[k]).toContain('get_job'); expect(JOB_TOOLS[k]).toContain('finish_job'); }
  });
  it('refuses a tool outside the job kind subset', () => {
    const job = { kind: 'extract_review', status: 'running' };
    expect(agentMayActOn('reviewer', job, 'get_page')).toBe(true);
    expect(agentMayActOn('reviewer', job, 'propose_page_choice')).toBe(true);
    expect(agentMayActOn('reviewer', job, 'propose_page_repair')).toBe(false);
    expect(agentMayActOn('reviewer', { ...job, status: 'queued' }, 'get_page')).toBe(false);
    expect(agentMayActOn('scout', job, 'get_job')).toBe(false);
  });
  it('keeps the quality_curate skill to its own tools', () => {
    const job = { kind: 'quality_curate', status: 'running' };
    for (const t of ['get_job', 'get_page_text', 'reocr_page', 'propose_page_repair', 'mark_page_unusable', 'finish_job']) expect(agentMayActOn('reviewer', job, t)).toBe(true);
    expect(agentMayActOn('reviewer', job, 'get_page')).toBe(false);
    expect(agentMayActOn('reviewer', job, 'propose_page_choice')).toBe(false);
    expect(agentMayActOn('quality-curator', job, 'get_job')).toBe(false);
    expect(agentMayActOn('reviewer', { kind: 'extract_review', status: 'running' }, 'reocr_page')).toBe(false);
  });
});

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
  it('gives faq_curate jobs only to the faq-curator, on its own port', () => {
    expect(JOB_KINDS).toContain('faq_curate');
    expect(JOB_AGENT.faq_curate).toBe('faq-curator');
    expect(JOB_MINUTES.faq_curate).toBe(25);
    expect(AGENT_PORTS['faq-curator']).toBe(8905);
    expect(verifyAgentHeader(`faq-curator:${agentToken('k', 'faq-curator')}`, 'k')).toBe('faq-curator');
    expect(agentMayActOn('faq-curator', { kind: 'faq_curate', status: 'running' })).toBe(true);
    expect(agentMayActOn('faq-curator', { kind: 'faq_curate', status: 'queued' })).toBe(false);
    expect(agentMayActOn('faq-curator', { kind: 'scout_judge', status: 'running' })).toBe(false);
    expect(agentMayActOn('scout', { kind: 'faq_curate', status: 'running' })).toBe(false);
  });
});
