/**
 * T-45a — the Bedrock-backed critic client (R-137, R-138, R-139, D-75, D-81, NFR-2).
 * The SDK is mocked at its boundary: a recording `runtime` stands in for
 * BedrockRuntimeClient, so no network call and no credential is involved.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  PERSONA,
  CRITIC_PROMPTS,
  CRITIC_PROMPT_VERSION,
  CRITIC_BLIND_SCHEMA,
  CRITIC_FINDINGS_SCHEMA,
  type CriticBlindInput,
} from '@registry/adversary';
import { createBedrockCritic, DEFAULT_CRITIC_MODEL, type BedrockRuntimeLike } from '../src/critic-llm.js';

interface Sent {
  modelId: string;
  body: {
    system: string;
    max_tokens: number;
    tools: { name: string; input_schema: unknown }[];
    tool_choice: { type: string; name: string };
    messages: { role: string; content: string }[];
  };
}

function runtime(reply: unknown): BedrockRuntimeLike & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(cmd: unknown) {
      expect(cmd).toBeInstanceOf(InvokeModelCommand);
      const input = (cmd as InvokeModelCommand).input;
      sent.push({ modelId: input.modelId!, body: JSON.parse(new TextDecoder().decode(input.body as Uint8Array)) });
      return { body: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
}

const toolReply = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'x', input }], stop_reason: 'tool_use' });

const BLIND_INPUT: CriticBlindInput = {
  requirement: {
    source: 'create',
    id: 'CRE-R-24',
    text: 'the get-ready service SHALL make the published Task available',
    earsType: 'event',
    section: '3.2',
  },
  entity: 'TaskPublished',
  sources: ['create', 'get-ready'],
  schemasBySource: { 'get-ready': [{ name: 'totalItemCount', required: true, logicalType: 'integer' }] as never },
  apiTargets: [],
};

afterEach(() => {
  delete process.env.CRITIC_MODEL_ID;
});

describe('createBedrockCritic (T-45)', () => {
  it('defaults to the Opus inference profile; CRITIC_MODEL_ID overrides it (D-81)', () => {
    expect(DEFAULT_CRITIC_MODEL).toBe('us.anthropic.claude-opus-4-8');
    expect(createBedrockCritic({ runtime: runtime({}) }).modelId).toBe(DEFAULT_CRITIC_MODEL);
    process.env.CRITIC_MODEL_ID = 'us.anthropic.claude-opus-5-5';
    expect(createBedrockCritic({ runtime: runtime({}) }).modelId).toBe('us.anthropic.claude-opus-5-5');
    expect(createBedrockCritic({ runtime: runtime({}) }).promptVersion).toBe(CRITIC_PROMPT_VERSION);
  });

  it('blind pass: persona-prefixed system prompt, one forced tool with CRITIC_BLIND_SCHEMA, grounded user content', async () => {
    const rt = runtime(toolReply({ behaviours: [] }));
    const out = await createBedrockCritic({ runtime: rt }).blind(BLIND_INPUT);
    expect(out).toEqual({ behaviours: [] });
    const [{ modelId, body }] = rt.sent;
    expect(modelId).toBe(DEFAULT_CRITIC_MODEL);
    expect(body.system).toBe(CRITIC_PROMPTS[CRITIC_PROMPT_VERSION].blind);
    expect(body.system.startsWith(PERSONA)).toBe(true);
    expect(body.tools).toEqual([expect.objectContaining({ name: 'emit_expected_behaviours', input_schema: CRITIC_BLIND_SCHEMA })]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_expected_behaviours' });
    expect(body.max_tokens).toBe(8192);
    expect(body.messages[0].content).toContain('the get-ready service SHALL make the published Task available');
    expect(body.messages[0].content).toContain('totalItemCount');
  });

  it('reconcile pass: emit_findings tool with CRITIC_FINDINGS_SCHEMA; the plan, file and findings are in the user content', async () => {
    const rt = runtime(toolReply({ findings: [] }));
    await createBedrockCritic({ runtime: rt }).reconcile({
      blind: { behaviours: [{ clause: 'SHALL make', observable: 'listed', service: 'consumer' }] },
      plan: { title: 'PLAN-TITLE-MARKER' } as never,
      file: { path: 'functional/x.generated.test.ts', contents: 'FILE-CONTENTS-MARKER' },
      deterministic: [
        {
          attack: 'grounding',
          severity: 'Major',
          rule: 'R-133e',
          target: { kind: 'functional', ref: 'r' },
          defect: 'DET-MARKER',
          failureScenario: 's',
        },
      ],
    });
    const [{ body }] = rt.sent;
    expect(body.system).toBe(CRITIC_PROMPTS[CRITIC_PROMPT_VERSION].reconcile);
    expect(body.tools).toEqual([expect.objectContaining({ name: 'emit_findings', input_schema: CRITIC_FINDINGS_SCHEMA })]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_findings' });
    for (const marker of ['PLAN-TITLE-MARKER', 'FILE-CONTENTS-MARKER', 'DET-MARKER', 'observable']) {
      expect(body.messages[0].content).toContain(marker);
    }
  });

  it('a response with no tool_use block throws (runCritic records it as failed, R-141)', async () => {
    const rt = runtime({ content: [{ type: 'text', text: 'looks fine' }], stop_reason: 'end_turn' });
    await expect(createBedrockCritic({ runtime: rt }).blind(BLIND_INPUT)).rejects.toThrow(/no tool_use block/);
  });

  it('takes no credential: the options carry only model / region / promptVersion / runtime (IAM role, NFR-2)', () => {
    const src = createBedrockCritic.toString();
    expect(src).not.toMatch(/apiKey|api_key|x-api-key|ANTHROPIC_API_KEY|secret/i);
  });
});
