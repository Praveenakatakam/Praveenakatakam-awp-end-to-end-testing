import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockClient } from '../src/llm.js';

const bedrock = mockClient(BedrockRuntimeClient);
const ctx = {
  requirement: { source: 'publisher', id: 'R-1', text: 'org is created', earsType: 'event', section: '1' },
  entity: 'org',
  sources: ['consumer', 'publisher'],
  schema: [],
  apiTargets: [],
  inputHash: 'h',
} as any;

function respond() {
  bedrock.on(InvokeModelCommand).resolves({
    body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'tool_use', input: { ok: true } }] })) as any,
  });
}
const sentSystem = () => {
  const b = bedrock.commandCalls(InvokeModelCommand)[0].args[0].input.body as string | Uint8Array;
  return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b)).system;
};

beforeEach(() => bedrock.reset());

describe('createBedrockClient system prompt', () => {
  it('uses the registry text passed by the caller for a non-v1 prompt version', async () => {
    respond();
    await createBedrockClient('m', 'us-east-1', 'v2-experiment', 'CUSTOM PROMPT TEXT').synthesizePlan(ctx);
    expect(sentSystem()).toBe('CUSTOM PROMPT TEXT');
  });

  it('falls back to the built-in v1 text when no text is passed', async () => {
    respond();
    await createBedrockClient('m', 'us-east-1', 'v1').synthesizePlan(ctx);
    expect(sentSystem()).toMatch(/^You are a senior test engineer/);
  });
});
