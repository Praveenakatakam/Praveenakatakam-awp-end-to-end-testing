/**
 * The Bedrock-backed `LlmClient` (T-34 · R-117, R-118, D-55).
 *
 * This is the ONLY place the registry talks to Claude. It is imported solely by
 * the functional-generation worker entrypoint — never by the pure `@registry/
 * functest` core or by any unit test, which inject a stub `LlmClient` instead
 * (NFR-8). Claude is reached through **Amazon Bedrock** using the AWS-native
 * `@aws-sdk/client-bedrock-runtime` `InvokeModel` operation: auth is the Lambda
 * execution role via SigV4 — there is NO API key or SST Secret (D-55, NFR-2).
 * The IAM `bedrock:InvokeModel` grant lives on the worker Function (ApiStack).
 *
 * Structured output uses **forced tool use** (the broadly-supported Bedrock
 * mechanism): a single tool whose `input_schema` IS `PLAN_SCHEMA_V1` (the legacy
 * generator is pinned to the original v1 plan contract), with
 * `tool_choice` pinned to it, so the plan comes back as the tool-use `input`.
 * The core re-validates every response with Ajv (`validatePlanV1`) before trusting
 * it, so drift or a refusal is skipped, never emitted (R-120). `model` (a Bedrock
 * model id / inference-profile id) and `promptVersion` are part of the plan-cache
 * input hash (R-119), so changing either busts the cache.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PLAN_SCHEMA_V1, type LlmClient, type GroundedContext } from '@registry/functest';

/** Prompt registry — the version is pinned in the cache key (R-119). */
const PROMPTS: Record<string, string> = {
  v1: [
    'You are a senior test engineer specifying ONE end-to-end, cross-service functional test.',
    'You are given a single natural-language EARS requirement, the ODCS contract schema for the',
    'entity it concerns, and the live API coordinates for each service that handles that entity.',
    '',
    'Produce a SINGLE test PLAN (never code) for the scenario: the PUBLISHER performs a write that,',
    'via change-data-capture (CDC), propagates to the CONSUMER, with assertions on the affected side(s).',
    '',
    'Rules:',
    '- Ground every field ONLY in the inputs provided. Never invent an entity, source, endpoint, or',
    '  field that was not given. `trigger.entity` MUST be the given entity; `trigger.source` MUST be',
    '  one of the given sources.',
    '- `trigger.path` should be the write endpoint on the publisher for that entity.',
    '- Keep `payloadShape` a description of the request body shape, not a literal payload.',
    '- Assertions describe what a runner must verify after propagation; be specific and grounded.',
    '- Call the `emit_functional_test_plan` tool exactly once with the plan; do not reply with prose.',
  ].join('\n'),
};

function userPrompt(ctx: GroundedContext): string {
  const schema = ctx.schema.map((p) => `  - ${p.name}${p.required ? ' (required)' : ''}: ${p.logicalType ?? 'unknown'}`).join('\n');
  const targets = ctx.apiTargets.map((t) => `  - ${t.source}: ${t.target.path} (records at "${t.target.recordsAt}")`).join('\n');
  return [
    `Requirement ${ctx.requirement.id} (${ctx.requirement.earsType}, §${ctx.requirement.section}) from the ${ctx.requirement.source} service:`,
    `  "${ctx.requirement.text}"`,
    ``,
    `Entity under test: ${ctx.entity}`,
    `Sources that handle this entity (allowed trigger.source values): ${ctx.sources.join(', ')}`,
    ``,
    `Contract schema for ${ctx.entity}:`,
    schema || '  (no properties)',
    ``,
    `Live API targets:`,
    targets,
  ].join('\n');
}

/**
 * Default Bedrock model (US cross-region inference profile); override with
 * BEDROCK_MODEL_ID. Sonnet 4.6 is the account's granted model; Opus 4.8
 * (`us.anthropic.claude-opus-4-8`) is the intended upgrade once its access grant
 * lands — a one-env-var switch, no code change.
 */
export const DEFAULT_BEDROCK_MODEL = 'us.anthropic.claude-sonnet-4-6';

const TOOL_NAME = 'emit_functional_test_plan';

/**
 * Build a Bedrock-backed `LlmClient`. No credential argument — the AWS SDK
 * credential chain (the Lambda role) authenticates via SigV4. `model` is a
 * Bedrock model id / inference-profile id; `region` defaults to the SDK's own
 * resolution when omitted. `model`/`promptVersion` are also part of the cache
 * key upstream (R-119).
 */
export function createBedrockClient(
  model: string = DEFAULT_BEDROCK_MODEL,
  region?: string,
  promptVersion = 'v1',
  systemText?: string
): LlmClient {
  const client = new BedrockRuntimeClient(region ? { region } : {});
  // The registry record's text is authoritative (callers pass it); the code map
  // is only a fallback. Before this, `systemText` was silently dropped and every
  // prompt version ran with the v1 text.
  const system = systemText ?? PROMPTS[promptVersion] ?? PROMPTS.v1;
  return {
    async synthesizePlan(context: GroundedContext): Promise<unknown> {
      const body = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 8192,
        system,
        messages: [{ role: 'user', content: userPrompt(context) }],
        tools: [
          {
            name: TOOL_NAME,
            description: 'Return the single cross-service functional test plan for the given requirement.',
            input_schema: PLAN_SCHEMA_V1,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      };
      const res = await client.send(
        new InvokeModelCommand({
          modelId: model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body),
        })
      );
      const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
        content?: { type: string; input?: unknown }[];
        stop_reason?: string;
      };
      const block = (decoded.content ?? []).find((b) => b.type === 'tool_use');
      if (!block) throw new Error(`no tool_use block in Bedrock response (stop_reason=${decoded.stop_reason})`);
      // The pure core re-validates this against PLAN_SCHEMA_V1 before use (R-120).
      return block.input;
    },
  };
}
