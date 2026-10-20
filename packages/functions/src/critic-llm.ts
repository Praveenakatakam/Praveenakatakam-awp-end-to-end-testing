/**
 * The Bedrock-backed adversarial critic (T-45 · R-137, R-138, R-139, D-75, D-81).
 *
 * The second place the registry talks to Claude (the first is `llm.ts`), and,
 * like it, imported only by the functional worker entrypoint — never by a unit
 * test or the pure `@registry/adversary` core, which inject a stub
 * `CriticClient`. Same transport as the synthesiser (D-55): `InvokeModel` with
 * the Lambda role's SigV4 credentials (no key, no secret), structured output by
 * forced tool use — one tool per pass, `tool_choice` pinned to it.
 *
 * The critic runs on a DIFFERENT model from the synthesiser (Opus by default,
 * `CRITIC_MODEL_ID` overrides it) so the two make different mistakes (R-139).
 * Prompts, persona and schemas live in `@registry/adversary` (R-138); this file
 * is transport only. Output is untrusted: `runCritic` posture-lints it (R-140)
 * and isolates any failure (R-141).
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { compareCodePoint } from '@registry/core';
import {
  CRITIC_PROMPTS,
  CRITIC_PROMPT_VERSION,
  CRITIC_BLIND_SCHEMA,
  CRITIC_FINDINGS_SCHEMA,
  type CriticBlindInput,
  type CriticClient,
  type CriticReconcileInput,
} from '@registry/adversary';

/** Opus inference profile (D-81) — distinct from the Sonnet synthesiser (D-55). */
export const DEFAULT_CRITIC_MODEL = 'us.anthropic.claude-opus-4-8';

const BLIND_TOOL = 'emit_expected_behaviours';
const FINDINGS_TOOL = 'emit_findings';

/** The one SDK method we use — injectable so tests mock the boundary, not the network. */
export interface BedrockRuntimeLike {
  send(command: InvokeModelCommand): Promise<{ body: Uint8Array }>;
}

function blindPrompt(i: CriticBlindInput): string {
  const schemas = Object.entries(i.schemasBySource)
    .sort(([a], [b]) => compareCodePoint(a, b))
    .map(
      ([source, props]) =>
        `Contract schema for ${i.entity} in ${source}:\n` +
        (props.map((p) => `  - ${p.name}${p.required ? ' (required)' : ''}: ${p.logicalType ?? 'unknown'}`).join('\n') ||
          '  (no properties)')
    )
    .join('\n\n');
  const targets =
    i.apiTargets.map((t) => `  - ${t.source}: ${t.target.path} (records at "${t.target.recordsAt}")`).join('\n') || '  (none)';
  return [
    `Requirement ${i.requirement.id} (${i.requirement.earsType}, §${i.requirement.section}) from the ${i.requirement.source} service:`,
    `  "${i.requirement.text}"`,
    '',
    `Entity: ${i.entity}`,
    `Services that handle it: ${i.sources.join(', ')}`,
    '',
    schemas,
    '',
    'Live API targets:',
    targets,
  ].join('\n');
}

function reconcilePrompt(i: CriticReconcileInput): string {
  return [
    'EXPECTED BEHAVIOURS (independent blind pass):',
    JSON.stringify(i.blind, null, 2),
    '',
    'TEST PLAN:',
    JSON.stringify(i.plan, null, 2),
    '',
    `EMITTED TEST FILE (${i.file.path}):`,
    i.file.contents,
    '',
    'DETERMINISTIC FINDINGS ALREADY RAISED:',
    JSON.stringify(i.deterministic, null, 2),
  ].join('\n');
}

export function createBedrockCritic(
  opts: { model?: string; region?: string; promptVersion?: string; runtime?: BedrockRuntimeLike } = {}
): CriticClient {
  const modelId = opts.model ?? process.env.CRITIC_MODEL_ID ?? DEFAULT_CRITIC_MODEL;
  const promptVersion = opts.promptVersion ?? CRITIC_PROMPT_VERSION;
  const prompts = CRITIC_PROMPTS[promptVersion] ?? CRITIC_PROMPTS[CRITIC_PROMPT_VERSION];
  const runtime: BedrockRuntimeLike = opts.runtime ?? new BedrockRuntimeClient(opts.region ? { region: opts.region } : {});

  async function invoke(system: string, user: string, tool: string, schema: unknown): Promise<unknown> {
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [{ name: tool, description: `Return the ${tool.replace(/^emit_/, '').replace(/_/g, ' ')}.`, input_schema: schema }],
      tool_choice: { type: 'tool', name: tool },
    };
    const res = await runtime.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: new TextEncoder().encode(JSON.stringify(body)),
      })
    );
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: { type: string; input?: unknown }[];
      stop_reason?: string;
    };
    const block = (decoded.content ?? []).find((b) => b.type === 'tool_use');
    if (!block) throw new Error(`no tool_use block in Bedrock critic response (stop_reason=${decoded.stop_reason})`);
    return block.input;
  }

  return {
    modelId,
    promptVersion,
    blind: (input) => invoke(prompts.blind, blindPrompt(input), BLIND_TOOL, CRITIC_BLIND_SCHEMA),
    reconcile: (input) => invoke(prompts.reconcile, reconcilePrompt(input), FINDINGS_TOOL, CRITIC_FINDINGS_SCHEMA),
  };
}
