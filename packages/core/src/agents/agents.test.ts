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
    expect(jobSkill('scout_variants')).toBeNull();
  });
  it('runs terms_judge, faq_curate and scout_judge on the reviewer (step 3); terms agent and faq curator are retired', () => {
    for (const k of ['terms_judge', 'faq_curate', 'scout_judge'] as const) { expect(JOB_AGENT[k]).toBe('reviewer'); expect(jobSkill(k)).toBe(k); }
    expect(AGENT_NAMES as readonly string[]).not.toContain('terms-agent');
    expect(AGENT_NAMES as readonly string[]).not.toContain('faq-curator');
    expect(Object.values(AGENT_PORTS)).not.toContain(8904);
    expect(Object.values(AGENT_PORTS)).not.toContain(8905);
    expect(verifyAgentHeader(`terms-agent:${agentToken('k', 'terms-agent')}`, 'k')).toBeNull();
    expect(verifyAgentHeader(`faq-curator:${agentToken('k', 'faq-curator')}`, 'k')).toBeNull();
    // The scout keeps only text-variant search.
    expect(JOB_AGENT.scout_variants).toBe('scout');
    expect(Object.values(JOB_AGENT).filter((a) => a === 'scout')).toHaveLength(1);
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
  it('keeps terms_judge, faq_curate and scout_judge to their own tools', () => {
    const terms = { kind: 'terms_judge', status: 'running' };
    for (const t of ['get_job', 'judge_sentences', 'finish_job']) expect(agentMayActOn('reviewer', terms, t)).toBe(true);
    for (const t of ['propose_canonical', 'propose_source', 'preview_url', 'propose_page_repair']) expect(agentMayActOn('reviewer', terms, t)).toBe(false);
    const faq = { kind: 'faq_curate', status: 'running' };
    for (const t of ['get_job', 'list_faq_candidates', 'propose_canonical', 'finish_job']) expect(agentMayActOn('reviewer', faq, t)).toBe(true);
    for (const t of ['judge_sentences', 'propose_source', 'get_page_text']) expect(agentMayActOn('reviewer', faq, t)).toBe(false);
    const judge = { kind: 'scout_judge', status: 'running' };
    for (const t of ['get_job', 'preview_url', 'propose_source', 'finish_job']) expect(agentMayActOn('reviewer', judge, t)).toBe(true);
    for (const t of ['propose_text_variant', 'judge_sentences', 'propose_canonical']) expect(agentMayActOn('reviewer', judge, t)).toBe(false);
    expect(agentMayActOn('scout', judge, 'propose_source')).toBe(false);
    expect(agentMayActOn('terms-agent', terms, 'get_job')).toBe(false);
    expect(agentMayActOn('faq-curator', faq, 'get_job')).toBe(false);
    expect(agentMayActOn('reviewer', { kind: 'scout_variants', status: 'running' }, 'preview_url')).toBe(false);
    expect(agentMayActOn('reviewer', { ...judge, status: 'queued' }, 'get_job')).toBe(false);
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
  it('gives scout_variants jobs only to the scout, with a time budget', () => {
    expect(JOB_MINUTES.scout_judge).toBe(25);
    expect(JOB_MINUTES.terms_judge).toBe(25);
    expect(JOB_MINUTES.faq_curate).toBe(25);
    expect(agentMayActOn('scout', { kind: 'scout_variants', status: 'running' })).toBe(true);
    expect(agentMayActOn('scout', { kind: 'terms_judge', status: 'running' })).toBe(false);
    expect(agentMayActOn('scout', { kind: 'faq_curate', status: 'running' })).toBe(false);
    expect(agentMayActOn('reviewer', { kind: 'scout_variants', status: 'running' })).toBe(false);
  });
});
