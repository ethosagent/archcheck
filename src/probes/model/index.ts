/**
 * The model probe — the non-deterministic tier. Last on purpose: everything before it works with
 * no model, no key and no network.
 *
 * What rule this enforces: SKIPPING IS A FIRST-CLASS OUTCOME. No key, no SDK, offline, or budget
 * spent → the probe returns a Skip with a reason, the run stays green, and the summary says which
 * rules were not judged. Never a failure, never a silent pass. An advisory tier that can fail a
 * build on a bad day is an advisory tier people switch off.
 *
 * Two decisions make it affordable, and both are visible in `judgeFile`:
 *   1. Rules are the CACHED PREFIX and the file is the volatile suffix, so every rule's statement
 *      and examples are paid for once per run rather than once per file.
 *   2. Batching is BY FILE, not by rule: 15 rules against 40 files is 40 calls, not 600.
 */
import { asJudgementParams, judgementApplies } from '../../contracts/judgement.js';
import { ok, type Result } from '../../result.js';
import type { RawFinding, Rule } from '../../types.js';
import type { Probe, RunCtx, Skip } from '../types.js';
import { createAnthropicProvider } from './anthropic.js';
import { type Budget, createBudget, DEFAULT_BUDGET } from './budget.js';
import {
  cacheKey,
  createNullVerdictCache,
  createVerdictCache,
  hashRuleSet,
  type VerdictCache,
} from './cache.js';
import { JUDGE_INSTRUCTIONS, renderFileBlock, renderRulesBlock } from './prompt.js';
import {
  apiKeyFromEnvironment,
  DEFAULT_MODEL,
  type JudgeVerdict,
  type LlmProvider,
} from './provider.js';

export type ModelProbeOptions = {
  /** Injected in tests. Omitted in production, where it is built from the environment. */
  provider?: LlmProvider;
  model?: string;
  budget?: Budget;
  /** 'changed' | 'all'. Never 'all' in a hook. */
  scope?: 'changed' | 'all';
  cache?: boolean;
  env?: NodeJS.ProcessEnv;
};

function judgementRules(rules: readonly Rule[]): Rule[] {
  return rules.filter((rule) => rule.kind === 'judgement' && rule.severity !== 'off');
}

/** A verdict with no citation is DISCARDED. This removes most confident-sounding noise for free. */
function usableVerdicts(
  verdicts: readonly JudgeVerdict[],
  known: ReadonlySet<string>,
): JudgeVerdict[] {
  return verdicts.filter(
    (verdict) =>
      verdict.violates &&
      known.has(verdict.ruleId) &&
      typeof verdict.cited === 'string' &&
      verdict.cited.trim().length > 0,
  );
}

export function createModelProbe(options: ModelProbeOptions = {}): Probe {
  return {
    name: 'judgement',
    handles: ['judgement'],

    async run(ctx: RunCtx): Promise<RawFinding[] | Skip> {
      const rules = judgementRules(ctx.rules);
      if (rules.length === 0) return [];

      const provider: Result<LlmProvider> =
        options.provider === undefined ? buildProvider(options) : ok(options.provider);
      if (!provider.ok) return { skipped: true, reason: provider.error.join('; ') };

      const budget = createBudget(options.budget ?? DEFAULT_BUDGET);
      const cache: VerdictCache =
        options.cache === false ? createNullVerdictCache() : createVerdictCache(ctx.root);

      const rulesBlock = renderRulesBlock(rules);
      const ruleSetHash = hashRuleSet(
        rules.map((rule) => `${rule.id}:${JSON.stringify(rule.params)}`),
      );
      const known = new Set(rules.map((rule) => rule.id));
      const byId = new Map(rules.map((rule) => [rule.id, rule]));

      // 'all' is deliberately not the default: judging an entire repository on every commit is how
      // the bill arrives. A hook should always be scoped.
      const scope = options.scope ?? (ctx.changed === undefined ? 'all' : 'changed');
      const candidates = (
        scope === 'changed' && ctx.changed !== undefined
          ? [...ctx.changed]
          : ctx.fs.glob('**/*.{ts,tsx,js,jsx}')
      ).filter((path) => rules.some((rule) => judgementApplies(asJudgementParams(rule), path)));

      const findings: RawFinding[] = [];
      let unjudged = 0;
      let budgetReason: string | undefined;

      for (const path of candidates) {
        const content = ctx.fs.read(path);
        if (content === undefined) continue;

        const key = cacheKey(ruleSetHash, content);
        const cached = cache.get(key);
        if (cached) {
          findings.push(...toFindings(usableVerdicts(cached, known), path, byId));
          continue;
        }

        // Checked BEFORE the request, never after. Over the ceiling the probe stops and says how
        // much went unjudged; it never silently spends more.
        if (!budget.canSpend()) {
          budgetReason ??= budget.exhaustedReason();
          unjudged += 1;
          continue;
        }

        const response = await provider.value.judge({
          model: options.model ?? DEFAULT_MODEL,
          instructions: JUDGE_INSTRUCTIONS,
          rulesBlock,
          fileBlock: renderFileBlock(path, content),
        });
        if (!response.ok) {
          // One unreachable call does not fail a run, and does not pass one either.
          unjudged += 1;
          continue;
        }

        budget.record(response.value.costUsd);
        const usable = usableVerdicts(response.value.verdicts, known);
        cache.set(key, response.value.verdicts);
        findings.push(...toFindings(usable, path, byId));
      }

      cache.flush();

      if (unjudged > 0 && findings.length === 0 && budgetReason !== undefined) {
        return { skipped: true, reason: `${budgetReason}; ${unjudged} file(s) unjudged` };
      }
      return findings;
    },
  };
}

function toFindings(
  verdicts: readonly JudgeVerdict[],
  path: string,
  byId: ReadonlyMap<string, Rule>,
): RawFinding[] {
  return verdicts.flatMap((verdict) => {
    if (!byId.has(verdict.ruleId)) return [];
    return [
      {
        ruleId: verdict.ruleId,
        file: path,
        ...(verdict.line === undefined ? {} : { line: verdict.line }),
        evidence: {
          file: path,
          // The citation IS the evidence: it is what makes the finding checkable, and it is what
          // the identity hash keys off, so a re-judged file that cites the same span is the same
          // finding rather than a new one.
          cited: verdict.cited ?? '',
          ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        },
        identity: '',
      },
    ];
  });
}

function buildProvider(options: ModelProbeOptions): Result<LlmProvider> {
  const apiKey = apiKeyFromEnvironment(options.env ?? process.env);
  if (apiKey === undefined) {
    return {
      ok: false,
      error: [
        'no ANTHROPIC_API_KEY in the environment — the judgement tier is not running',
        '  → set it locally, or add it as a repository secret in CI. A key never goes in a config file',
      ],
    };
  }
  return ok(createAnthropicProvider({ apiKey, model: options.model ?? DEFAULT_MODEL }));
}

export { createAnthropicProvider } from './anthropic.js';
export { type Budget, createBudget, DEFAULT_BUDGET } from './budget.js';
export {
  cacheKey,
  createNullVerdictCache,
  createVerdictCache,
  hashRuleSet,
  MODEL_CACHE_PATH,
  type VerdictCache,
} from './cache.js';
export { JUDGE_INSTRUCTIONS, renderFileBlock, renderRulesBlock } from './prompt.js';
export {
  apiKeyFromEnvironment,
  DEFAULT_MODEL,
  estimateCostUsd,
  type JudgeRequest,
  type JudgeResponse,
  type JudgeVerdict,
  type LlmProvider,
  parseVerdicts,
  VERDICT_SCHEMA,
} from './provider.js';
