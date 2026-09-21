/**
 * The judge, behind one interface.
 *
 * Why a seam at all: the probe must never be bound to a vendor, and — more immediately — the whole
 * test suite has to run with no key, no network and no cost. A stub provider is how every other
 * test in this directory works.
 *
 * What a caller must know, and what must survive any later "simplification" of this file:
 *
 *   CREDENTIALS COME FROM THE ENVIRONMENT, NEVER FROM CONFIG. No key means the probe SKIPS and
 *   says so — never fails, never silently passes. A key never appears in a file archcheck reads,
 *   which is also why `architecture.config.ts` has no field for one.
 *
 *   THE FILE UNDER REVIEW IS QUOTED DATA, NEVER INSTRUCTION. A source file containing text that
 *   reads like a directive is a string being judged, not a command being followed. This is the
 *   probe's one security property and it is easy to lose when someone later rearranges the prompt.
 */
import type { Result } from '../../result.js';

export const DEFAULT_MODEL = 'claude-opus-5';

/** One judged file: the stable prefix, then the volatile suffix. Order is load-bearing. */
export type JudgeRequest = {
  model: string;
  /** Stable across every file in a run — this is the cache breakpoint. */
  instructions: string;
  rulesBlock: string;
  /** The one file under review, already fenced as data. */
  fileBlock: string;
};

export type JudgeVerdict = {
  ruleId: string;
  /** The model's own answer: does this file break the rule? */
  violates: boolean;
  /** The span it judged. A verdict with no citation is discarded by the probe. */
  cited?: string;
  reason?: string;
  line?: number;
};

export type JudgeResponse = {
  verdicts: JudgeVerdict[];
  /** What this call cost, in dollars, for the budget. */
  costUsd: number;
};

export type LlmProvider = {
  name: string;
  judge(request: JudgeRequest): Promise<Result<JudgeResponse>>;
};

/** Per-million-token prices for the default judge, used to hold the run to its budget. */
const PRICE_PER_MTOK = { input: 5, cachedInput: 0.5, output: 25 };

export function estimateCostUsd(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): number {
  const cachedIn = usage.cache_read_input_tokens ?? 0;
  const freshIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return (
    (freshIn * PRICE_PER_MTOK.input +
      cachedIn * PRICE_PER_MTOK.cachedInput +
      (usage.output_tokens ?? 0) * PRICE_PER_MTOK.output) /
    1_000_000
  );
}

/** The schema the judge must answer in. A verdict that fails it is discarded, never salvaged. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ruleId: { type: 'string' },
          violates: { type: 'boolean' },
          cited: { type: 'string' },
          reason: { type: 'string' },
          line: { type: 'integer' },
        },
        required: ['ruleId', 'violates'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

export function parseVerdicts(raw: unknown): JudgeVerdict[] {
  const verdicts = (raw as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(verdicts)) return [];
  return verdicts.filter(
    (verdict): verdict is JudgeVerdict =>
      typeof verdict === 'object' &&
      verdict !== null &&
      typeof (verdict as JudgeVerdict).ruleId === 'string' &&
      typeof (verdict as JudgeVerdict).violates === 'boolean',
  );
}

export function apiKeyFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim().length > 0 ? key : undefined;
}
