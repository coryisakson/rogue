/**
 * "Review and update this game" (docs/DERIVED_OUTPUTS.md, HANDOFF 0e): one background job per game that brings its
 * knowledge and its setup sheet / player aid up to date. The steps run in a fixed order; each can also run alone. This
 * file holds the pure parts (step selection, progress text, the drafting rule); the database work lives in
 * apps/web/src/lib/game-update.ts.
 */

/** The steps, in the order they always run (a later step builds on the earlier ones). */
export const GAME_UPDATE_STEPS = ['recheck', 'ingest', 'extract', 'draft', 'supersede', 'rebuild'] as const;
export type GameUpdateStep = (typeof GAME_UPDATE_STEPS)[number];

/** Admin-facing label per step (sources page card and progress text). */
export const GAME_UPDATE_STEP_LABELS: Record<GameUpdateStep, string> = {
  recheck: 'Recheck sources',
  ingest: 'Re-ingest sources without text',
  extract: 'Extractor review of unsure PDF pages',
  draft: 'Librarian on undrafted sources',
  supersede: 'Supersede claims of retired sources',
  rebuild: 'Rebuild setup sheet and player aid',
};

export type StepStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'failed';
/** One step of a run as stored in game_updates.steps: its outcome and one line saying what happened. */
export interface StepRecord { step: GameUpdateStep; status: StepStatus; line: string }

const isStep = (v: unknown): v is GameUpdateStep => typeof v === 'string' && (GAME_UPDATE_STEPS as readonly string[]).includes(v);

/**
 * The `steps` form field values ("all" or step names) as steps in run order, without duplicates. Unknown values or no
 * value at all are an error, so a typo never silently runs nothing (or everything).
 */
export function parseUpdateSteps(values: readonly string[]): { ok: true; steps: GameUpdateStep[] } | { ok: false; error: string } {
  const v = values.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return { ok: false, error: 'Pick at least one step.' };
  if (v.includes('all')) return { ok: true, steps: [...GAME_UPDATE_STEPS] };
  const bad = v.find((x) => !isStep(x));
  if (bad) return { ok: false, error: 'Unknown step.' };
  return { ok: true, steps: orderSteps(v as GameUpdateStep[]) };
}

/** Steps sorted into run order, duplicates removed. */
export function orderSteps(steps: readonly GameUpdateStep[]): GameUpdateStep[] {
  return GAME_UPDATE_STEPS.filter((s) => steps.includes(s));
}

/** The stored step list for a new run: every selected step pending. */
export function initialStepRecords(steps: readonly GameUpdateStep[]): StepRecord[] {
  return orderSteps(steps).map((step) => ({ step, status: 'pending', line: '' }));
}

/** Is this jsonb a step list we wrote? (A resumed run refuses anything else instead of guessing.) */
export function isStepRecords(v: unknown): v is StepRecord[] {
  return Array.isArray(v) && v.length > 0 && v.every((r) => !!r && typeof r === 'object' && isStep((r as StepRecord).step)
    && ['pending', 'running', 'ok', 'skipped', 'failed'].includes((r as StepRecord).status) && typeof (r as StepRecord).line === 'string');
}

/**
 * The next step to run: the first not finished. A step left 'running' by a restart runs again (every step is safe to
 * repeat: recheck honours the 24 h rule, ingest/draft only pick sources that still need it, rebuild is idempotent).
 */
export function nextStep(records: readonly StepRecord[]): StepRecord | null {
  return records.find((r) => r.status === 'pending' || r.status === 'running') ?? null;
}

export interface StepCounts { ok: number; skipped: number; failed: number; pending: number }
export function stepCounts(records: readonly StepRecord[]): StepCounts {
  const c: StepCounts = { ok: 0, skipped: 0, failed: 0, pending: 0 };
  for (const r of records) {
    if (r.status === 'ok' || r.status === 'skipped' || r.status === 'failed') c[r.status]++;
    else c.pending++;
  }
  return c;
}

/** One line for the card: "step 3/6 (Extractor review…): <detail>" while running, the totals when finished. */
export function updateProgressText(records: readonly StepRecord[], detail = ''): string {
  const c = stepCounts(records);
  const totals = `${c.ok} ok, ${c.skipped} skipped, ${c.failed} failed`;
  const cur = nextStep(records);
  if (!cur) return `finished: ${totals}`;
  const n = records.indexOf(cur) + 1;
  return `step ${n}/${records.length} (${GAME_UPDATE_STEP_LABELS[cur.step]})${detail ? `: ${detail}` : ''}; ${totals}`.slice(0, 300);
}

/** Final run status: failed when any step failed, else done. (Stopped is set by the admin, not derived.) */
export function finalUpdateStatus(records: readonly StepRecord[]): 'done' | 'failed' {
  return records.some((r) => r.status === 'failed') ? 'failed' : 'done';
}

/** What the drafting rule needs to know about one source of the game. */
export interface DraftCandidate { sourceId: number; kind: string; available: boolean; hasText: boolean; claims: number }

/**
 * Does the Librarian need to run on this source? Only available rulebook or wiki sources with extracted text, and only
 * when no claim cites them yet, unless the admin ticked "redraft" (drafting again on purpose).
 */
export function needsDrafting(s: DraftCandidate, redraft: boolean): boolean {
  if (s.kind !== 'rulebook' && s.kind !== 'wiki') return false;
  if (!s.available || !s.hasText) return false;
  return redraft || s.claims === 0;
}

/** Source ids to draft, ascending (deterministic order for progress and resume). */
export function sourcesToDraft(list: readonly DraftCandidate[], redraft: boolean): number[] {
  return [...new Set(list.filter((s) => needsDrafting(s, redraft)).map((s) => s.sourceId))].sort((a, b) => a - b);
}
