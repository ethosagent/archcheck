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

type AnthropicClient = {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      content: { type: string; text?: string }[];
      usage?: Record<string, number>;
      stop_reason?: string;
    }>;
  };
};

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

        // A refusal is not a verdict. Returning nothing is correct: the tier is advisory, and an
        // empty answer degrades to "not judged" rather than to "clean".
        if (response.stop_reason === 'refusal') {
          return ok({ verdicts: [], costUsd: estimateCostUsd(response.usage ?? {}) });
        }

        const text = response.content.find((block) => block.type === 'text')?.text ?? '';
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Schema-invalid output is DISCARDED, never salvaged by guessing. A judge that
          // half-parses is a judge that invents findings.
          return ok({ verdicts: [], costUsd: estimateCostUsd(response.usage ?? {}) });
        }

        return ok({
          verdicts: parseVerdicts(parsed),
          costUsd: estimateCostUsd(response.usage ?? {}),
        });
      } catch (error) {
        return err([`the judge could not be reached: ${(error as Error).message}`]);
      }
    },
  };
}
