import { createHmac } from 'node:crypto';

/**
 * Agent identity for the Nanobot sidecar. One shared key lives on the hand-off volume (written by the web app, read-only in the
 * sidecar); every secret is derived from it per agent name, so nothing agent-specific is stored and a leaked token only works
 * for one agent. Agents call Rogue's MCP endpoint with header `x-rogue-agent: <name>:<token>`.
 */
export const AGENT_NAMES = ['quality-curator', 'scout', 'librarian', 'terms-agent'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export const AGENT_PORTS: Record<AgentName, number> = { 'quality-curator': 8901, scout: 8902, librarian: 8903, 'terms-agent': 8904 };

/** Kinds of agent job (agent_jobs.kind) and the one agent allowed to work on each. terms_judge works on a game request, the rest on a source. */
export const JOB_KINDS = ['quality_curate', 'scout_variants', 'librarian_draft', 'terms_judge'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_AGENT: Record<JobKind, AgentName> = { quality_curate: 'quality-curator', scout_variants: 'scout', librarian_draft: 'librarian', terms_judge: 'terms-agent' };
/**
 * How long one agent run may take, in minutes. The Librarian reads a whole rulebook page by page with a local model,
 * so it gets hours; the others finish within the sidecar's default 25-minute API timeout.
 */
export const JOB_MINUTES: Record<JobKind, number> = { quality_curate: 25, scout_variants: 25, librarian_draft: 180, terms_judge: 25 };

/** Tool calls are refused unless the job is running and its kind belongs to the calling agent. */
export function agentMayActOn(agent: string, job: { kind: string; status: string } | null | undefined): boolean {
  if (!job || job.status !== 'running') return false;
  return (JOB_KINDS as readonly string[]).includes(job.kind) && JOB_AGENT[job.kind as JobKind] === agent;
}

const hmac = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');
/** Token the agent presents to Rogue's MCP endpoint. */
export const agentToken = (key: string, name: string): string => hmac(key, name);
/** Bearer key Rogue presents to the agent's OpenAI-compatible API. */
export const agentApiKey = (key: string, name: string): string => hmac(key, `api:${name}`);

/** Parse and verify the `x-rogue-agent` header value. Returns the agent name or null. */
export function verifyAgentHeader(value: string | null | undefined, key: string | null | undefined): AgentName | null {
  if (!value || !key) return null;
  const i = value.indexOf(':');
  if (i < 1) return null;
  const name = value.slice(0, i);
  const given = value.slice(i + 1);
  if (!(AGENT_NAMES as readonly string[]).includes(name)) return null;
  const want = agentToken(key, name);
  if (given.length !== want.length) return null;
  let diff = 0;
  for (let k = 0; k < want.length; k++) diff |= given.charCodeAt(k) ^ want.charCodeAt(k);
  return diff === 0 ? (name as AgentName) : null;
}
