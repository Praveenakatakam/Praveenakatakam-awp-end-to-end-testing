import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { GroundedContext } from '@registry/functest';
import { convertToEars, createBedrockClient, ConversionError, ConversionTimeoutError } from '../src/llm.js';

const bedrock = mockClient(BedrockRuntimeClient);

beforeEach(() => {
  bedrock.reset();
});

function encode(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

function groundedContext(): GroundedContext {
  return {
    requirement: { source: 'jira', id: 'R-1', text: 'WHEN x THE system SHALL y', earsType: 'event', section: '1' },
    entity: 'org',
    sources: ['publisher'],
    schema: [],
    apiTargets: [],
    inputHash: 'hash',
  };
}

describe('convertToEars (JR-20, NFR-J3)', () => {
  it('resolves with the converted EARS sentence from a free-form text response', async () => {
    bedrock.on(InvokeModelCommand).resolves({
      body: encode({ content: [{ type: 'text', text: 'WHEN x THE system SHALL y' }] }),
    } as any);

    await expect(convertToEars('some raw AC text', { timeoutMs: 10_000 })).resolves.toBe('WHEN x THE system SHALL y');
  });

  it('does not use forced tool-use and wires up the jira-ears-v1 prompt', async () => {
    bedrock.on(InvokeModelCommand).resolves({
      body: encode({ content: [{ type: 'text', text: 'WHEN x THE system SHALL y' }] }),
    } as any);

    await convertToEars('some raw AC text', { timeoutMs: 10_000 });

    const call = bedrock.commandCalls(InvokeModelCommand)[0];
    const body = JSON.parse((call.args[0].input as any).body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.system).toContain('EARS-format');
  });

  it('throws ConversionTimeoutError when the Bedrock call times out', async () => {
    bedrock.on(InvokeModelCommand).rejects(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));

    await expect(convertToEars('some raw AC text', { timeoutMs: 10_000 })).rejects.toBeInstanceOf(ConversionTimeoutError);
  });

  it('throws ConversionError for other Bedrock failures', async () => {
    bedrock.on(InvokeModelCommand).rejects(new Error('service unavailable'));

    await expect(convertToEars('some raw AC text', { timeoutMs: 10_000 })).rejects.toBeInstanceOf(ConversionError);
  });

  it('throws ConversionError when the response has no text content', async () => {
    bedrock.on(InvokeModelCommand).resolves({ body: encode({ content: [] }) } as any);

    await expect(convertToEars('some raw AC text', { timeoutMs: 10_000 })).rejects.toBeInstanceOf(ConversionError);
  });

  it('regression: createBedrockClient/synthesizePlan still works with forced tool-use', async () => {
    bedrock.on(InvokeModelCommand).resolves({
      body: encode({ content: [{ type: 'tool_use', input: { some: 'plan' } }] }),
    } as any);

    const client = createBedrockClient();
    await expect(client.synthesizePlan(groundedContext())).resolves.toEqual({ some: 'plan' });
  });
});
