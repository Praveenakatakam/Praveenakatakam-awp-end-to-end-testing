/**
 * `planSchema: "v1"` pipeline steps reproduce the legacy generator (T-30).
 *
 * Bedrock is intercepted with aws-sdk-client-mock on `BedrockRuntimeClient`
 * (`InvokeModelCommand`) so the request the step worker sends and the request
 * the legacy `createBedrockClient(...).synthesizePlan(ctx)` sends are captured
 * the same way and compared. DDB / S3 / Lambda and the repository module are
 * vi.mocked; grounding and the plan validators/emitter are the real ones.
 *
 * Requirements: R-84, D-32 · Tests: TS-72, TS-73
 */
const mockDdbSend = vi.hoisted(() => vi.fn<any[], Promise<any>>());
const mockS3Send = vi.hoisted(() => vi.fn<any[], Promise<any>>());
const mockLambdaSend = vi.hoisted(() => vi.fn<any[], Promise<any>>());

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: vi.fn(() => ({})) }));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDdbSend })) },
  PutCommand: vi.fn((input: unknown) => ({ _name: 'PutCommand', input })),
  UpdateCommand: vi.fn((input: unknown) => ({ _name: 'UpdateCommand', input })),
  QueryCommand: vi.fn((input: unknown) => ({ _name: 'QueryCommand', input })),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn((input: unknown) => ({ _name: 'GetObjectCommand', input })),
  PutObjectCommand: vi.fn((input: unknown) => ({ _name: 'PutObjectCommand', input })),
}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn((input: unknown) => ({ _name: 'InvokeCommand', input })),
}));
vi.mock('../src/repository.js', () => ({
  getPrun: vi.fn(),
  updatePrun: vi.fn(),
  getPipeline: vi.fn(),
  listPrunSteps: vi.fn(),
  getStepcache: vi.fn(),
  putStepcacheConditional: vi.fn(),
  getSysconfig: vi.fn(),
  getPrmpt: vi.fn(),
  getPrmptVer: vi.fn(),
  stepSk: vi.fn((i: number) => `STEP#${String(i).padStart(2, '0')}`),
  prunPk: vi.fn((runId: string) => ({ pk: `PRUN#${runId}` })),
  repository: {},
}));
vi.mock('../src/functional-gen.js', () => ({ buildFunctionalInputs: vi.fn() }));
vi.mock('../src/log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redact: vi.fn((x: unknown) => x),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { API_MAP } from '@registry/core';
import { ground, emitFunctionalTest, PLAN_SCHEMA_V1, PLAN_SCHEMA_V2 } from '@registry/functest';
import { stepWorker } from '../src/pipeline.js';
import { createBedrockClient } from '../src/llm.js';
import {
  getPrun,
  updatePrun,
  getPipeline,
  listPrunSteps,
  getStepcache,
  putStepcacheConditional,
  getSysconfig,
  getPrmpt,
  getPrmptVer,
} from '../src/repository.js';
import { buildFunctionalInputs } from '../src/functional-gen.js';

const bedrock = mockClient(BedrockRuntimeClient);

// ── Catalog fixture (real grounding) ─────────────────────────────────────────

const MODEL = 'us.anthropic.claude-sonnet-4-6';
const REQUIREMENT = {
  source: 'publisher',
  id: 'R-1',
  text: 'WHEN an org is created THE publisher SHALL emit the org to the consumer',
  earsType: 'event',
  section: '3.1',
};
const ORG_YAML = [
  'version: 1.0.0',
  'apiVersion: v3.1.0',
  'kind: DataContract',
  'id: org-contract',
  'name: org',
  'schema:',
  '  - name: org',
  '    properties:',
  '      - name: sourcedId',
  '        required: true',
  '        logicalType: string',
  '      - name: name',
  '        logicalType: string',
].join('\n');
const CONTRACTS = ['publisher', 'consumer'].map((source) => ({
  source,
  entity: 'org',
  id: 'org-contract',
  contentHash: `${source}-hash`,
  rawYaml: ORG_YAML,
}));
const INPUTS = { requirements: [REQUIREMENT], contracts: CONTRACTS, apiMap: API_MAP, modelId: MODEL, promptVersion: '1' };

/** A valid PLAN_SCHEMA_V1 plan for the fixture. */
function v1Plan(overrides: Record<string, unknown> = {}) {
  return {
    requirementIds: ['R-1'],
    title: 'Org created in publisher reaches consumer',
    setup: [],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payloadShape: '{ sourcedId, name }' },
    propagation: { kind: 'cdc', waitFor: 'consumer org read model updated' },
    assertions: [{ service: 'consumer', assertion: 'GET /orgs includes the new org' }],
    ...overrides,
  };
}

function bedrockReply(input: unknown) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ type: 'tool_use', input }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'tool_use' })
    ) as any,
  };
}

/** The InvokeModel input as sent, with the body decoded to a string. */
function sentRequest(i: number) {
  const input = bedrock.commandCalls(InvokeModelCommand)[i].args[0].input;
  const raw = input.body as string | Uint8Array;
  const bodyText = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  return { ...input, body: bodyText, parsed: JSON.parse(bodyText) };
}

/** The built-in legacy v1 prompt text (what `llm.ts` sends with no override). */
async function legacyV1Text(): Promise<string> {
  bedrock.on(InvokeModelCommand).resolves(bedrockReply(v1Plan()));
  await createBedrockClient(MODEL, 'us-east-1', 'v1').synthesizePlan(groundedCtx());
  const text = sentRequest(0).parsed.system as string;
  bedrock.reset();
  return text;
}

function groundedCtx() {
  const g = ground(REQUIREMENT, CONTRACTS, API_MAP, MODEL, 'v1');
  if (!g.ok) throw new Error(`fixture does not ground: ${g.reason}`);
  return g.context;
}

function setup(stepOverrides: Record<string, unknown>, promptBody: string, steps?: unknown[]) {
  const step = {
    stepId: 'plan',
    label: 'Legacy v1 plan',
    model: MODEL,
    promptKey: 'legacy-v1',
    outputType: 'plan',
    planSchema: 'v1',
    includeContext: false,
    optional: false,
    waitForHuman: false,
    ...stepOverrides,
  };
  vi.mocked(getPrun).mockResolvedValue({
    runId: 'run-1',
    pipelineId: 'baseline-legacy-v1',
    status: 'running',
    startedAt: new Date(Date.now() - 1_000).toISOString(),
    requirementIds: ['publisher/R-1'],
    executedSteps: 0,
    pipelineConfigVersion: 1,
    warnings: [],
  } as any);
  vi.mocked(getPipeline).mockResolvedValue({
    pipelineId: 'baseline-legacy-v1',
    name: 'Baseline (legacy v1)',
    steps: steps ?? [step],
    maxSteps: 10,
    maxAgeMinutes: 60,
    active: true,
    version: 1,
  } as any);
  vi.mocked(getPrmpt).mockResolvedValue({ promptKey: 'legacy-v1', currentVersion: 1, active: true } as any);
  vi.mocked(getPrmptVer).mockResolvedValue({ promptKey: 'legacy-v1', version: 1, body: promptBody } as any);
  vi.mocked(getStepcache).mockResolvedValue(undefined as any);
  vi.mocked(putStepcacheConditional).mockResolvedValue(undefined as any);
  vi.mocked(getSysconfig).mockResolvedValue({ pricing: {} } as any);
  vi.mocked(updatePrun).mockResolvedValue(undefined as any);
  vi.mocked(listPrunSteps).mockResolvedValue([]);
  vi.mocked(buildFunctionalInputs).mockResolvedValue(INPUTS as any);
  mockDdbSend.mockResolvedValue({});
  mockS3Send.mockResolvedValue({});
  mockLambdaSend.mockResolvedValue({});
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'step-worker-fn';
  process.env.AWS_REGION = 'us-east-1';
}

/** Body of the S3 PutObject for a given key suffix. */
function s3PutBody(suffix: string): string | undefined {
  const call = mockS3Send.mock.calls.find((c) => c[0]?._name === 'PutObjectCommand' && String(c[0].input.Key).endsWith(suffix));
  return call?.[0].input.Body;
}

beforeEach(() => {
  vi.clearAllMocks();
  bedrock.reset();
});

// ── TS-72 ─────────────────────────────────────────────────────────────────────

describe('planSchema "v1" step — Bedrock request parity with the legacy generator (R-84, TS-72)', () => {
  it('TS-72: system, messages, tools and tool_choice (indeed the whole request) equal the legacy createBedrockClient request', async () => {
    const promptText = await legacyV1Text();
    setup({}, promptText);
    bedrock.on(InvokeModelCommand).resolves(bedrockReply(v1Plan()));

    // Legacy: exactly as the FJOB / experiment workers call it (registry text passed).
    await createBedrockClient(MODEL, process.env.AWS_REGION, 'v1', promptText).synthesizePlan(groundedCtx());
    // Pipeline: one v1 step, no priors, instructions off, includeContext false.
    await stepWorker({ runId: 'run-1', stepIndex: 0 });

    expect(bedrock.commandCalls(InvokeModelCommand)).toHaveLength(2);
    const legacy = sentRequest(0);
    const pipeline = sentRequest(1);

    for (const k of ['system', 'messages', 'tools', 'tool_choice'] as const) {
      expect(pipeline.parsed[k], k).toEqual(legacy.parsed[k]);
    }
    expect(pipeline.parsed).toEqual(legacy.parsed);
    // Byte-identical body and identical InvokeModel envelope.
    expect(pipeline.body).toBe(legacy.body);
    expect({ ...pipeline, parsed: undefined }).toEqual({ ...legacy, parsed: undefined });
    expect(pipeline.parsed.tools[0].input_schema).toEqual(PLAN_SCHEMA_V1);
  });

  it('the v1 step records a "plan-v1" tool in its input snapshot', async () => {
    setup({}, 'SYSTEM');
    bedrock.on(InvokeModelCommand).resolves(bedrockReply(v1Plan()));
    await stepWorker({ runId: 'run-1', stepIndex: 0 });
    const snapshot = JSON.parse(s3PutBody('00.input.json')!);
    expect(snapshot.tool).toEqual({ name: 'emit_functional_test_plan', schemaVersion: 'plan-v1' });
  });

  it('a plan step without planSchema keeps PLAN_SCHEMA_V2 and "plan-v2"', async () => {
    setup({ planSchema: undefined }, 'SYSTEM');
    bedrock.on(InvokeModelCommand).resolves(bedrockReply({ ...v1Plan(), rationale: 'why' }));
    await stepWorker({ runId: 'run-1', stepIndex: 0 });
    expect(sentRequest(0).parsed.tools[0].input_schema).toEqual(PLAN_SCHEMA_V2);
    expect(JSON.parse(s3PutBody('00.input.json')!).tool.schemaVersion).toBe('plan-v2');
  });

  it('emits the run artifact with the legacy emitter (no apiTargets)', async () => {
    setup({}, 'SYSTEM');
    const plan = v1Plan();
    bedrock.on(InvokeModelCommand).resolves(bedrockReply(plan));
    vi.mocked(listPrunSteps).mockResolvedValue([
      { stepIndex: 0, stepId: 'plan', status: 'completed', outputRef: { inline: JSON.stringify(plan) } },
    ] as any);

    await stepWorker({ runId: 'run-1', stepIndex: 0 });

    const ctx = ground(REQUIREMENT, CONTRACTS, API_MAP, MODEL, '1');
    if (!ctx.ok) throw new Error('no ground');
    const expected = emitFunctionalTest({ ...plan, inputHash: ctx.context.inputHash } as any, 0);
    expect(s3PutBody('test.generated.ts')).toBe(expected);
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ status: 'completed', artifact: expect.objectContaining({ stepId: 'plan' }) })
    );
  });
});

// ── TS-73 ─────────────────────────────────────────────────────────────────────

describe('planSchema "v1" step — v1 validation (R-84, TS-73)', () => {
  it('TS-73: a plan with propagation.kind "eventbridge" fails the step terminally', async () => {
    setup({}, 'SYSTEM');
    bedrock.on(InvokeModelCommand).resolves(
      bedrockReply(v1Plan({ propagation: { kind: 'eventbridge', waitFor: 'event delivered' } }))
    );

    await stepWorker({ runId: 'run-1', stepIndex: 0 });

    // Not retried — validation errors are terminal.
    expect(bedrock.commandCalls(InvokeModelCommand)).toHaveLength(1);
    const stepFail = mockDdbSend.mock.calls.find(
      (c) => c[0]?._name === 'UpdateCommand' && c[0].input.ExpressionAttributeValues?.[':status'] === 'failed'
    );
    expect(stepFail).toBeDefined();
    expect(stepFail![0].input.ExpressionAttributeValues[':em']).toMatch(/malformed plan/);
    expect(updatePrun).toHaveBeenCalledWith(expect.anything(), 'run-1', expect.objectContaining({ status: 'failed' }));
    expect(putStepcacheConditional).not.toHaveBeenCalled();
  });

  it('the same plan is accepted by a default (v2) plan step', async () => {
    setup({ planSchema: undefined }, 'SYSTEM');
    bedrock.on(InvokeModelCommand).resolves(
      bedrockReply(v1Plan({ rationale: 'why', propagation: { kind: 'eventbridge', waitFor: 'event delivered' } }))
    );
    await stepWorker({ runId: 'run-1', stepIndex: 0 });
    expect(updatePrun).not.toHaveBeenCalledWith(expect.anything(), 'run-1', expect.objectContaining({ status: 'failed' }));
    expect(putStepcacheConditional).toHaveBeenCalled();
  });
});
