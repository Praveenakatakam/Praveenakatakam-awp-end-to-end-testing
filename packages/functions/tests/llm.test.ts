/**
 * Unit tests for createBedrockClient (T-06 · R-08, R-34, D-7).
 *
 * The Bedrock SDK is mocked via aws-sdk-client-mock so these run offline
 * without any AWS credentials.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockClient, DEFAULT_BEDROCK_MODEL } from '../src/llm.js';
import type { GroundedContext } from '@registry/functest';

const bedrock = mockClient(BedrockRuntimeClient);

beforeEach(() => {
  bedrock.reset();
});

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------

function minimalContext(): GroundedContext {
  return {
    requirement: {
      id: 'R-10',
      text: 'WHEN an org is created it SHALL be published to consumers',
      source: 'publisher',
      section: '3.1',
      earsType: 'event',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: false,
      specHash: 'h',
      lastCrawledAt: '2026-07-16T00:00:00Z',
    },
    entity: 'org',
    sources: ['publisher'],
    schema: [{ name: 'sourcedId', required: true, logicalType: 'string' }],
    apiTargets: [
      {
        source: 'publisher',
        target: { path: '/orgs', recordsAt: 'orgs', method: 'GET', params: [] },
      },
    ],
  };
}

function bedrockToolUseResponse(plan: unknown): Uint8Array {
  const payload = {
    content: [{ type: 'tool_use', input: plan }],
    stop_reason: 'tool_use',
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

function minimalPlan() {
  return {
    requirementIds: ['R-10'],
    title: 'publisher-created org appears to the consumer',
    setup: [{ description: 'a writer token' }],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payloadShape: '{ sourcedId }' },
    propagation: { kind: 'cdc', waitFor: 'consumer read model updates' },
    assertions: [{ service: 'consumer', assertion: 'GET /orgs includes the new org' }],
  };
}

// ---------------------------------------------------------------------------
// createBedrockClient — signature and basic invocation
// ---------------------------------------------------------------------------

describe('createBedrockClient (T-06 · R-08, R-34)', () => {
  it('returns an LlmClient whose synthesizePlan calls InvokeModel and returns the tool-use input', async () => {
    // GIVEN
    const plan = minimalPlan();
    bedrock.on(InvokeModelCommand).resolves({ body: bedrockToolUseResponse(plan) });

    // WHEN
    const client = createBedrockClient(DEFAULT_BEDROCK_MODEL, undefined, 'v1', 'You are a test generator.');
    const result = await client.synthesizePlan(minimalContext());

    // THEN
    expect(result).toEqual(plan);
    expect(bedrock.commandCalls(InvokeModelCommand)).toHaveLength(1);
  });

  it('forwards rawPromptText verbatim into the Bedrock invocation payload as the system field (R-08, R-34)', async () => {
    // GIVEN — a distinctive prompt string so we can assert exact forwarding
    const rawPromptText = 'You are a specialist in cross-service contract testing. Use explicit assertions.';
    bedrock.on(InvokeModelCommand).resolves({ body: bedrockToolUseResponse(minimalPlan()) });

    // WHEN
    const client = createBedrockClient(DEFAULT_BEDROCK_MODEL, undefined, 'v1', rawPromptText);
    await client.synthesizePlan(minimalContext());

    // THEN — the body sent to Bedrock must contain `system === rawPromptText`, no implicit fallback.
    // The SDK mock captures the body as-is (a JSON string), so parse it directly.
    const call = bedrock.commandCalls(InvokeModelCommand)[0];
    const rawBody = call.args[0].input.body as string;
    const sentBody = JSON.parse(rawBody) as { system: string };
    expect(sentBody.system).toBe(rawPromptText);
  });

  it('uses the model id supplied to createBedrockClient as the InvokeModel modelId', async () => {
    // GIVEN
    const customModel = 'us.anthropic.claude-opus-4-8';
    bedrock.on(InvokeModelCommand).resolves({ body: bedrockToolUseResponse(minimalPlan()) });

    // WHEN
    const client = createBedrockClient(customModel, undefined, 'v1', 'system prompt');
    await client.synthesizePlan(minimalContext());

    // THEN
    const call = bedrock.commandCalls(InvokeModelCommand)[0];
    expect(call.args[0].input.modelId).toBe(customModel);
  });

  it('throws when Bedrock returns no tool_use block in the response', async () => {
    // GIVEN — a response with only a text block (refusal-shaped)
    const noToolPayload = new TextEncoder().encode(
      JSON.stringify({ content: [{ type: 'text', text: 'I cannot help.' }], stop_reason: 'end_turn' })
    );
    bedrock.on(InvokeModelCommand).resolves({ body: noToolPayload });

    // WHEN / THEN
    const client = createBedrockClient(DEFAULT_BEDROCK_MODEL, undefined, 'v1', 'system prompt');
    await expect(client.synthesizePlan(minimalContext())).rejects.toThrow('no tool_use block');
  });

  it('propagates Bedrock SDK errors to the caller', async () => {
    // GIVEN
    bedrock.on(InvokeModelCommand).rejects(new Error('ThrottlingException'));

    // WHEN / THEN
    const client = createBedrockClient(DEFAULT_BEDROCK_MODEL, undefined, 'v1', 'system prompt');
    await expect(client.synthesizePlan(minimalContext())).rejects.toThrow('ThrottlingException');
  });
});
