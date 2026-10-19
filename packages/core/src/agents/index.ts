import { createHmac } from 'node:crypto';

/**
 * Agent identity for the Nanobot sidecar. One shared key lives on the hand-off volume (written by the web app, read-only in the
 * sidecar); every secret is derived from it per agent name, so nothing agent-specific is stored and a leaked token only works
 * for one agent. Agents call Rogue's MCP endpoint with header `x-rogue-agent: <name>:<token>`.
 */
export const AGENT_NAMES = ['reviewer', 'scout', 'librarian', 'terms-agent', 'faq-curator'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
/**
 * ADR 0007: the Reviewer took over port 8901 and gains one skill per short review job kind. Step 2 moved quality_curate onto it,
 * so the Quality Curator and its temporary port 8906 are gone.
 */
export const AGENT_PORTS: Record<AgentName, number> = { reviewer: 8901, scout: 8902, librarian: 8903, 'terms-agent': 8904, 'faq-curator': 8905 };

/** Kinds of agent job (agent_jobs.kind) and the one agent allowed to work on each. terms_judge and scout_judge work on a game request, faq_curate on a game, the rest on a source. */
export const JOB_KINDS = ['quality_curate', 'scout_variants', 'librarian_draft', 'terms_judge', 'scout_judge', 'faq_curate', 'extract_review'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_AGENT: Record<JobKind, AgentName> = { quality_curate: 'reviewer', scout_variants: 'scout', librarian_draft: 'librarian', terms_judge: 'terms-agent', scout_judge: 'scout', faq_curate: 'faq-curator', extract_review: 'reviewer' };
/**
 * The tools a job of each kind may call (ADR 0007). An agent with several skills sees all its tools over MCP, but a tool
 * refuses unless the running job's kind lists it, so one skill can never use another skill's write tools.
 */
export const JOB_TOOLS: Record<JobKind, readonly string[]> = {
  quality_curate: ['get_job', 'get_page_text', 'reocr_page', 'propose_page_repair', 'mark_page_unusable', 'finish_job'],
  scout_variants: ['get_job', 'preview_url', 'propose_text_variant', 'finish_job'],
  scout_judge: ['get_job', 'preview_url', 'propose_source', 'finish_job'],
  librarian_draft: ['get_job', 'get_page_text', 'propose_claim', 'finish_job'],
  terms_judge: ['get_job', 'judge_sentences', 'finish_job'],
  faq_curate: ['get_job', 'list_faq_candidates', 'propose_canonical', 'finish_job'],
  extract_review: ['get_job', 'get_page', 'propose_page_choice', 'finish_job'],
};
/**
 * How long one agent run may take, in minutes. The Librarian reads a whole rulebook page by page with a local model,
 * so it gets hours; the others finish within the sidecar's default 25-minute API timeout.
 */
export const JOB_MINUTES: Record<JobKind, number> = { quality_curate: 25, scout_variants: 25, librarian_draft: 180, terms_judge: 25, scout_judge: 25, faq_curate: 25, extract_review: 25 };

/** The skill (instruction section) an agent follows for a job kind. Today only the Reviewer has skills; the name is the kind. */
export const jobSkill = (kind: JobKind): string | null => (JOB_AGENT[kind] === 'reviewer' ? kind : null);

/**
 * Tool calls are refused unless the job is running, its kind belongs to the calling agent and, when a tool is named, the kind's
 * tool subset (JOB_TOOLS) includes that tool.
 */
export function agentMayActOn(agent: string, job: { kind: string; status: string } | null | undefined, tool?: string): boolean {
  if (!job || job.status !== 'running') return false;
  if (!(JOB_KINDS as readonly string[]).includes(job.kind) || JOB_AGENT[job.kind as JobKind] !== agent) return false;
  return tool === undefined || JOB_TOOLS[job.kind as JobKind].includes(tool);
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
