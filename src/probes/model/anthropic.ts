/**
 * The one shipped LlmProvider, on the Anthropic SDK.
 *
 * The SDK is an OPTIONAL peer dependency: a consumer with no judgement rules installs nothing, and
 * one who has them but has not installed it gets a clean skip with the install command in the
 * reason. That is why the import is dynamic and why this file never appears in a code path that a
 * key-less run reaches.
 *
 * Prompt layout, and the reason for the order (LLD §9.3):
 *
 *   [ system: judge instructions      ]  stable
 *   [ all judgement rules + examples  ]  stable  ← cache breakpoint
 *   [ the one file under review       ]  volatile
 *
 * Every judgement rule's statement and examples are identical across every file, so they cache
 * once and are re-read at a fraction of the price. Batching by file makes it 40 calls for 40
 * changed files rather than 600.
 */
import { err, ok, type Result } from '../../result.js';
import {
  estimateCostUsd,
  type JudgeRequest,
  type JudgeResponse,
  type LlmProvider,
  parseVerdicts,
  VERDICT_SCHEMA,
} from './provider.js';

/** As much of the SDK's reply as this file reads. */
type JudgeMessage = {
  content: { type: string; text?: string }[];
  usage?: Record<string, number>;
  stop_reason?: string;
};

type AnthropicClient = {
  messages: {
    create(body: Record<string, unknown>): Promise<JudgeMessage>;
  };
};

/**
 * Did the judge ANSWER at all? A refusal, or a reply this file cannot read, is a NON-ANSWER, and a
 * non-answer is an error — never `ok({ verdicts: [] })`, which the caller cannot tell from
 * "answered: no violations". The probe's `!response.ok` branch in index.ts is what makes a
 * non-answer count as unjudged and keeps it out of the verdict cache, so one transient refusal
 * cannot become a permanent "clean" for that file. Both halves are pinned by model.test.ts:
 * 'a non-answer is not a clean bill of health' and 'a non-answer is not cached'.
 *
 * A non-answer reports no cost, because there is no verdict to attribute it to. What bounds a
 * refusing or failing endpoint is the call cap: index.ts charges every ISSUED call to the budget.
 */
export function readJudgeAnswer(message: JudgeMessage): Result<JudgeResponse> {
  if (message.stop_reason === 'refusal') {
    return err(['the judge refused to answer — the file was not judged']);
  }

  const text = message.content.find((block) => block.type === 'text')?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err(["the judge's answer was not JSON — the file was not judged"]);
  }

  const answered = (parsed as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(answered)) {
    return err(["the judge's answer did not match the verdict schema — the file was not judged"]);
  }

  // Schema-invalid output is DISCARDED, never salvaged by guessing: a judge that half-parses is a
  // judge that invents findings. But an answer where nothing at all survived is a non-answer, not
  // a clean file.
  const verdicts = parseVerdicts(parsed);
  if (answered.length > 0 && verdicts.length === 0) {
    return err(["no verdict in the judge's answer was usable — the file was not judged"]);
  }

  return ok({ verdicts, costUsd: estimateCostUsd(message.usage ?? {}) });
}

async function loadClient(apiKey: string): Promise<Result<AnthropicClient>> {
  try {
    const module = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (options: { apiKey: string }) => AnthropicClient;
    };
    return ok(new module.default({ apiKey }));
  } catch {
    return err([
      '@anthropic-ai/sdk is not installed — it is an optional peer dependency',
      '  → install it to turn the judgement tier on: npm install -D @anthropic-ai/sdk',
    ]);
  }
}

export function createAnthropicProvider(options: { apiKey: string; model: string }): LlmProvider {
  return {
    name: 'anthropic',

    async judge(request: JudgeRequest): Promise<Result<JudgeResponse>> {
      const client = await loadClient(options.apiKey);
      if (!client.ok) return client;

      try {
        const response = await client.value.messages.create({
          model: request.model,
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: VERDICT_SCHEMA },
          },
          system: [
            { type: 'text', text: request.instructions },
            // The breakpoint: everything above here is identical for every file in the run.
            { type: 'text', text: request.rulesBlock, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: request.fileBlock }],
        });

        return readJudgeAnswer(response);
      } catch (error) {
        return err([`the judge could not be reached: ${(error as Error).message}`]);
      }
    },
  };
}
