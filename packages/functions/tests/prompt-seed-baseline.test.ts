/**
 * Seeder additions for v0.6.0 (T-31): the `legacy-v1` prompt and the
 * `baseline-legacy-v1` pipeline, idempotent and never overwriting.
 *
 * An in-memory table behind aws-sdk-client-mock honours the seeder's
 * `attribute_not_exists(PK)` condition and serves its GetCommand.
 *
 * Requirements: R-85, R-78 · Tests: TS-74
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { handler, BASELINE_PIPELINE_ID } from '../src/prompt-seed.js';
import { createBedrockClient } from '../src/llm.js';

const ddb = mockClient(DynamoDBDocumentClient);
let table: Map<string, Record<string, unknown>>;
let writes: string[];

const key = (pk: unknown, sk: unknown) => `${String(pk)}|${String(sk)}`;

beforeEach(() => {
  ddb.reset();
  table = new Map();
  writes = [];
  ddb.on(PutCommand).callsFake((input) => {
    const item = input.Item as Record<string, unknown>;
    const k = key(item.PK, item.SK);
    if (input.ConditionExpression === 'attribute_not_exists(PK)' && table.has(k)) {
      throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
    }
    table.set(k, structuredClone(item));
    writes.push(String(item.PK));
    return {};
  });
  ddb.on(GetCommand).callsFake((input) => ({ Item: table.get(key(input.Key.PK, input.Key.SK)) }));
});

describe('prompt-seed — legacy-v1 prompt + baseline pipeline (R-85, TS-74)', () => {
  it('TS-74: an empty table → creates legacy-v1 (from PROMPT#v1) and baseline-legacy-v1', async () => {
    const res = await handler();
    expect(res.seeded).toBe(true);

    const v1 = table.get('PROMPT#v1|PROMPT')!;
    const header = table.get('PRMPT#legacy-v1|PRMPT')!;
    const ver = table.get('PRMPTVER#legacy-v1#00001|PRMPTVER')!;
    expect(header).toMatchObject({
      pk: 'PRMPT#legacy-v1',
      sk: 'PRMPT',
      kind: 'PRMPT',
      promptKey: 'legacy-v1',
      currentVersion: 1,
      active: true,
      body: v1.text,
    });
    expect(ver).toMatchObject({
      pk: 'PRMPTVER#legacy-v1#00001',
      sk: 'PRMPTVER',
      kind: 'PRMPTVER',
      promptKey: 'legacy-v1',
      version: 1,
      body: v1.text,
    });

    const pipeline = table.get(`PIPELINE#${BASELINE_PIPELINE_ID}|PIPELINE`)!;
    expect(pipeline).toMatchObject({
      kind: 'PIPELINE',
      pipelineId: 'baseline-legacy-v1',
      name: 'Baseline (legacy v1)',
      active: true,
      version: 1,
      defaultSampling: { strategy: 'all' },
      defaultMode: 'per_requirement',
    });
    expect(pipeline.steps).toEqual([
      {
        stepId: 'plan',
        label: 'Legacy v1 plan',
        model: v1.modelId,
        promptKey: 'legacy-v1',
        outputType: 'plan',
        planSchema: 'v1',
        includeContext: false,
        optional: false,
        waitForHuman: false,
      },
    ]);
    expect(v1.modelId).toBe('us.anthropic.claude-sonnet-4-6');
    expect((pipeline.steps as Record<string, unknown>[])[0]).not.toHaveProperty('outputInstructions');
  });

  it('TS-74: seeding twice writes nothing new', async () => {
    await handler();
    const snapshot = structuredClone([...table.entries()]);
    writes = [];
    const res = await handler();
    expect(res.seeded).toBe(false);
    expect(writes).toEqual([]);
    expect([...table.entries()]).toEqual(snapshot);
  });

  it('TS-74: an existing baseline-legacy-v1 is not overwritten', async () => {
    const custom = {
      PK: 'PIPELINE#baseline-legacy-v1',
      SK: 'PIPELINE',
      pipelineId: 'baseline-legacy-v1',
      name: 'Edited by hand',
      version: 7,
    };
    table.set('PIPELINE#baseline-legacy-v1|PIPELINE', structuredClone(custom));
    await handler();
    expect(table.get('PIPELINE#baseline-legacy-v1|PIPELINE')).toEqual(custom);
    expect(writes).not.toContain('PIPELINE#baseline-legacy-v1');
  });

  it('an existing legacy-v1 prompt (e.g. imported via the API) is not overwritten', async () => {
    const imported = { PK: 'PRMPT#legacy-v1', SK: 'PRMPT', promptKey: 'legacy-v1', currentVersion: 3, body: 'edited' };
    table.set('PRMPT#legacy-v1|PRMPT', structuredClone(imported));
    await handler();
    expect(table.get('PRMPT#legacy-v1|PRMPT')).toEqual(imported);
  });

  it('uses an already-present PROMPT#v1 record text and model as the legacy-v1 body / baseline model', async () => {
    table.set('PROMPT#v1|PROMPT', { PK: 'PROMPT#v1', SK: 'PROMPT', kind: 'PROMPT', promptVersion: 'v1', text: 'OLD V1 TEXT', modelId: 'm-legacy' });
    await handler();
    expect(table.get('PRMPT#legacy-v1|PRMPT')!.body).toBe('OLD V1 TEXT');
    expect(table.get('PRMPTVER#legacy-v1#00001|PRMPTVER')!.body).toBe('OLD V1 TEXT');
    expect((table.get('PIPELINE#baseline-legacy-v1|PIPELINE')!.steps as { model: string }[])[0].model).toBe('m-legacy');
    // The existing PROMPT#v1 itself is untouched (R-78).
    expect(table.get('PROMPT#v1|PROMPT')!.text).toBe('OLD V1 TEXT');
  });

  it('existing seeded prompt texts are untouched (R-78): PROMPT#v1 text and the default prompt body', async () => {
    await handler();
    expect(table.get('PROMPT#v1|PROMPT')!.text).toMatch(/^You are a senior test engineer specifying ONE end-to-end/);
    expect(table.get('PRMPT#functional-test-gen-default|PRMPT')!.body).toMatch(/^You are a test engineer\. Given the provided/);
  });

  it('the seeded legacy-v1 body is byte-identical to the legacy generator\'s built-in v1 system prompt (D-32)', async () => {
    const bedrock = mockClient(BedrockRuntimeClient);
    bedrock.on(InvokeModelCommand).resolves({
      body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'tool_use', input: {} }] })) as any,
    });
    await createBedrockClient('m', 'us-east-1', 'v1').synthesizePlan({
      requirement: { source: 'publisher', id: 'R-1', text: 't', earsType: 'event', section: '1' },
      entity: 'org',
      sources: ['publisher'],
      schema: [],
      apiTargets: [],
      inputHash: 'h',
    } as any);
    const raw = bedrock.commandCalls(InvokeModelCommand)[0].args[0].input.body as string;
    bedrock.restore();

    await handler();
    expect(table.get('PRMPTVER#legacy-v1#00001|PRMPTVER')!.body).toBe(JSON.parse(raw).system);
  });
});
