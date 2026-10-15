/**
 * Tests for T-06a — stepWorker core logic.
 *
 * Requirements: R-12, R-14, R-15, R-16, R-18, R-19, R-20, R-21a, R-21b, R-22,
 *               R-23, R-28, R-46, R-51
 * Test skeletons: TS-07, TS-08, TS-09, TS-10, TS-11, TS-12, TS-13, TS-14,
 *                 TS-15, TS-15b, TS-16, TS-18, TS-28, TS-32, TS-33
 *
 * All AWS SDK calls are mocked. The module-level DDB and S3 clients are
 * captured via the @aws-sdk/lib-dynamodb and @aws-sdk/client-s3 mocks.
 * Lazy dynamic imports (Bedrock, Lambda, functional-gen) are also intercepted
 * because vi.mock() covers both static and dynamic imports.
 */

// ── Hoisted mock primitives ───────────────────────────────────────────────────
// vi.hoisted callbacks run before vi.mock factories, so these refs are safe to
// use inside the factory closures below.
const mockDdbSend = vi.hoisted(() => vi.fn<any[], Promise<any>>());
const mockS3Send = vi.hoisted(() => vi.fn<any[], Promise<any>>());
const mockBedrockSend = vi.hoisted(() => vi.fn<any[], Promise<any>>());
const mockLambdaSend = vi.hoisted(() => vi.fn<any[], Promise<any>>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDdbSend })),
  },
  PutCommand: vi.fn((input: unknown) => ({ _name: 'PutCommand', input })),
  UpdateCommand: vi.fn((input: unknown) => ({ _name: 'UpdateCommand', input })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: vi.fn((input: unknown) => ({ _name: 'GetObjectCommand', input })),
  PutObjectCommand: vi.fn((input: unknown) => ({ _name: 'PutObjectCommand', input })),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: vi.fn((input: unknown) => ({ _name: 'InvokeModelCommand', input })),
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

vi.mock('../src/functional-gen.js', () => ({
  buildFunctionalInputs: vi.fn(),
}));

vi.mock('@registry/functest', () => ({
  ground: vi.fn(),
  PLAN_SCHEMA: { type: 'object', properties: {} },
}));

vi.mock('../src/log.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  redact: vi.fn((x: unknown) => x),
}));

// ── Imports (must come after vi.mock declarations) ────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepWorker } from '../src/pipeline.js';
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
import { ground } from '@registry/functest';
import { log } from '../src/log.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const RUN_ID = 'run-abc';
const PIPELINE_ID = 'pipe-1';
const REQUIREMENT_ID = 'svc-a/R-01';

/** A run that started 5 seconds ago — well within the 5-minute system cap. */
function freshRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: RUN_ID,
    pipelineId: PIPELINE_ID,
    status: 'running',
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    requirementIds: [REQUIREMENT_ID],
    executedSteps: 0,
    pipelineConfigVersion: 1,
    warnings: [],
    ...overrides,
  };
}

function makeStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stepId: 's0',
    label: 'Generate plan',
    model: 'us.anthropic.claude-sonnet-4-6',
    promptKey: 'test-prompt',
    optional: false,
    waitForHuman: false,
    includeContext: false,
    ...overrides,
  };
}

function makePipeline(
  steps: unknown[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    pipelineId: PIPELINE_ID,
    name: 'Test Pipeline',
    steps,
    maxSteps: 10,
    maxAgeMinutes: 60,
    active: true,
    version: 1,
    ...overrides,
  };
}

const MOCK_REQUIREMENT = {
  source: 'svc-a',
  id: 'R-01',
  text: 'The Order entity shall be tracked across services.',
  earsType: 'ubiquitous',
  section: '3.1',
};

const MOCK_GROUNDED_CTX = {
  requirement: MOCK_REQUIREMENT,
  entity: 'Order',
  sources: ['svc-a', 'svc-b'],
  schema: [{ name: 'orderId', required: true, logicalType: 'string' }],
  apiTargets: [
    { source: 'svc-a', target: { path: '/orders', recordsAt: 'data.items' } },
  ],
  inputHash: 'hash-abc123',
};

function makeBedrockResponseBody(
  inputTokens = 100,
  outputTokens = 50
): Uint8Array {
  const body = {
    content: [{ type: 'tool_use', input: { entity: 'Order', scenarios: [] } }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    stop_reason: 'tool_use',
  };
  return new TextEncoder().encode(JSON.stringify(body));
}

function makeBedrockResponseBodyWithLargeOutput(): Uint8Array {
  const largeInput = 'x'.repeat(65 * 1_024); // 65 KB
  const body = {
    content: [{ type: 'tool_use', input: largeInput }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'tool_use',
  };
  return new TextEncoder().encode(JSON.stringify(body));
}

/**
 * Configure the happy-path default state for a single-step pipeline with a
 * cache miss and a successful Bedrock call.  Individual tests override specific
 * mocks after calling this.
 */
function setupHappyPath(stepOverrides: Record<string, unknown> = {}): void {
  const step = makeStep(stepOverrides);
  const pipeline = makePipeline([step]);

  vi.mocked(getPrun).mockResolvedValue(freshRun() as any);
  vi.mocked(getPipeline).mockResolvedValue(pipeline as any);
  vi.mocked(getPrmpt).mockResolvedValue({
    promptKey: 'test-prompt',
    currentVersion: 1,
    active: true,
  } as any);
  vi.mocked(getPrmptVer).mockResolvedValue({
    promptKey: 'test-prompt',
    version: 1,
    body: 'You are a helpful assistant.',
    s3Ref: undefined,
  } as any);
  vi.mocked(getStepcache).mockResolvedValue(undefined as any);
  vi.mocked(putStepcacheConditional).mockResolvedValue(undefined as any);
  vi.mocked(getSysconfig).mockResolvedValue({
    pricing: {
      'us.anthropic.claude-sonnet-4-6': {
        inputPricePerMillionTokens: 3,
        outputPricePerMillionTokens: 15,
      },
    },
  } as any);
  vi.mocked(updatePrun).mockResolvedValue(undefined as any);
  vi.mocked(listPrunSteps).mockResolvedValue([]);
  vi.mocked(buildFunctionalInputs).mockResolvedValue({
    requirements: [MOCK_REQUIREMENT],
    contracts: [],
    apiMap: {},
  } as any);
  vi.mocked(ground).mockReturnValue({ ok: true, context: MOCK_GROUNDED_CTX } as any);

  mockDdbSend.mockResolvedValue({});
  mockBedrockSend.mockResolvedValue({ body: makeBedrockResponseBody() });
  mockLambdaSend.mockResolvedValue({});
  mockS3Send.mockResolvedValue({});

  process.env.AWS_LAMBDA_FUNCTION_NAME = 'step-worker-fn';
  process.env.AWS_REGION = 'us-east-1';
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── TS-28: System cap check ───────────────────────────────────────────────────

describe('system cap check (R-46, TS-28)', () => {
  it('marks run timed_out immediately when (now - startedAt) > 5 minutes', async () => {
    // GIVEN — run started 6 minutes ago (past the 5-minute system cap)
    vi.mocked(getPrun).mockResolvedValue(
      freshRun({ startedAt: new Date(Date.now() - 6 * 60_000).toISOString() }) as any
    );

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — run is marked timed_out
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'timed_out' })
    );
    // AND — no lease was written (DDB PutCommand never called)
    expect(mockDdbSend).not.toHaveBeenCalled();
    // AND — Bedrock was not invoked
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('proceeds normally when run started less than 5 minutes ago', async () => {
    // GIVEN — run 4 minutes old (within cap)
    setupHappyPath();
    vi.mocked(getPrun).mockResolvedValue(
      freshRun({ startedAt: new Date(Date.now() - 4 * 60_000).toISOString() }) as any
    );

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — Bedrock was called (system cap did not halt execution)
    expect(mockBedrockSend).toHaveBeenCalledOnce();
    expect(updatePrun).not.toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'timed_out' })
    );
  });
});

// ── TS-10: waitForHuman ───────────────────────────────────────────────────────

describe('waitForHuman: true (R-14, TS-10)', () => {
  it('logs a warning and continues execution normally — run is not halted', async () => {
    // GIVEN — step with waitForHuman: true
    setupHappyPath({ waitForHuman: true });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — a warning was logged for waitForHuman
    expect(vi.mocked(log).warn).toHaveBeenCalledWith(
      'step.worker.wait_for_human_noop',
      expect.any(Object)
    );
    // AND — execution continued: Bedrock was still called
    expect(mockBedrockSend).toHaveBeenCalledOnce();
    // AND — run reached completed status (not halted)
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'completed' })
    );
  });
});

// ── TS-07 / TS-08: includeContext ─────────────────────────────────────────────

describe('includeContext (R-12, TS-07, TS-08)', () => {
  it('TS-07: includeContext: true at stepIndex > 0 — Bedrock receives priorOutputs content', async () => {
    // GIVEN — 3-step pipeline; running step index 1 with includeContext: true
    const step0 = makeStep({ stepId: 's0' });
    const step1 = makeStep({ stepId: 's1', includeContext: true });
    const step2 = makeStep({ stepId: 's2' });
    const pipeline = makePipeline([step0, step1, step2]);

    setupHappyPath({ stepId: 's1', includeContext: true });
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);
    vi.mocked(getPrun).mockResolvedValue(freshRun({ executedSteps: 1 }) as any);

    // Prior completed step with inline output
    vi.mocked(listPrunSteps).mockResolvedValue([
      {
        stepId: 's0',
        stepIndex: 0,
        label: 'Step zero output',
        status: 'completed',
        outputRef: { inline: JSON.stringify({ result: 'step0-output-content' }) },
      },
    ] as any);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 1 });

    // THEN — Bedrock received a body containing prior step outputs
    expect(mockBedrockSend).toHaveBeenCalledOnce();
    const bedrockArg = mockBedrockSend.mock.calls[0][0] as any;
    const requestBody = JSON.parse(bedrockArg.input.body);
    const userMessage: string = requestBody.messages[0].content;
    expect(userMessage).toContain('Prior step outputs');
    expect(userMessage).toContain('step0-output-content');
  });

  it('TS-08: includeContext: false — Bedrock body contains no prior step outputs', async () => {
    // GIVEN — step with includeContext: false (default in makeStep)
    setupHappyPath({ includeContext: false });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — Bedrock body has no prior output section
    expect(mockBedrockSend).toHaveBeenCalledOnce();
    const bedrockArg = mockBedrockSend.mock.calls[0][0] as any;
    const requestBody = JSON.parse(bedrockArg.input.body);
    const userMessage: string = requestBody.messages[0].content;
    expect(userMessage).not.toContain('Prior step outputs');
  });

  it('TS-08 extended: includeContext: false at stepIndex > 0 — listPrunSteps not used for context', async () => {
    // GIVEN — 2-step pipeline; step 1 has includeContext: false
    const step0 = makeStep({ stepId: 's0' });
    const step1 = makeStep({ stepId: 's1', includeContext: false });
    const pipeline = makePipeline([step0, step1]);

    setupHappyPath({ stepId: 's1', includeContext: false });
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);
    vi.mocked(getPrun).mockResolvedValue(freshRun({ executedSteps: 1 }) as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      {
        stepId: 's0',
        stepIndex: 0,
        label: 'Step 0',
        status: 'completed',
        outputRef: { inline: 'secret prior output' },
      },
    ] as any);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 1 });

    // THEN — Bedrock does not contain prior step content
    const bedrockArg = mockBedrockSend.mock.calls[0][0] as any;
    const requestBody = JSON.parse(bedrockArg.input.body);
    expect(requestBody.messages[0].content).not.toContain('secret prior output');
  });
});

// ── TS-18: Cache hit ──────────────────────────────────────────────────────────

describe('cache hit (R-28, TS-18)', () => {
  it('skips Bedrock call and marks step as cached', async () => {
    // GIVEN — getStepcache returns a cached entry
    setupHappyPath();
    vi.mocked(getStepcache).mockResolvedValue({
      cacheKey: 'some-sha256-hash',
      outputRef: { inline: '{"entity":"Order","scenarios":[]}' },
    } as any);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — Bedrock was NOT called
    expect(mockBedrockSend).not.toHaveBeenCalled();

    // AND — step record was updated with status: 'cached'
    const updateCalls = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand');
    const statusUpdate = updateCalls.find((c) =>
      c[0]?.input?.ExpressionAttributeValues?.[':status'] !== undefined
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate![0].input.ExpressionAttributeValues[':status']).toBe('cached');
  });
});

// ── TS-13 + TS-32: Lease write order + successful Bedrock call metrics ────────

describe('lease write and step metrics (R-18, R-51, TS-09, TS-13, TS-32)', () => {
  it('TS-13: lease (PutCommand) is written before Bedrock is called', async () => {
    // GIVEN — record call order across DDB and Bedrock mocks
    setupHappyPath();
    const callOrder: string[] = [];
    mockDdbSend.mockImplementation((cmd: any) => {
      callOrder.push(cmd._name);
      return Promise.resolve({});
    });
    mockBedrockSend.mockImplementation(() => {
      callOrder.push('bedrock');
      return Promise.resolve({ body: makeBedrockResponseBody() });
    });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — PutCommand (lease write) appears before the first Bedrock call
    const leaseIdx = callOrder.indexOf('PutCommand');
    const bedrockIdx = callOrder.indexOf('bedrock');
    expect(leaseIdx).toBeGreaterThanOrEqual(0);
    expect(bedrockIdx).toBeGreaterThan(leaseIdx);
  });

  it('TS-32: successful step — all metric fields are numeric in the step record', async () => {
    // GIVEN
    setupHappyPath();
    mockBedrockSend.mockResolvedValue({ body: makeBedrockResponseBody(200, 80) });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — final UpdateCommand contains all required numeric metrics
    const updateCalls = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .map((c) => c[0].input);
    const metricsUpdate = updateCalls.find(
      (u) => u.ExpressionAttributeValues?.[':durationMs'] !== undefined
    );
    expect(metricsUpdate).toBeDefined();
    const vals = metricsUpdate!.ExpressionAttributeValues;

    expect(typeof vals[':durationMs']).toBe('number');
    expect(typeof vals[':bedrockLatencyMs']).toBe('number');
    expect(vals[':inputTokens']).toBe(200);
    expect(vals[':outputTokens']).toBe(80);
    expect(typeof vals[':inputCharacters']).toBe('number');
    expect(typeof vals[':outputCharacters']).toBe('number');
    expect(typeof vals[':contextTokenEstimate']).toBe('number');
    expect(typeof vals[':costEstimateUsd']).toBe('number');
    expect(vals[':status']).toBe('completed');
  });

  it('TS-09: step record has contextTokenEstimate and outputTokens set after completion', async () => {
    // GIVEN
    setupHappyPath();
    mockBedrockSend.mockResolvedValue({ body: makeBedrockResponseBody(150, 60) });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN
    const updateCalls = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .map((c) => c[0].input);
    const metricsUpdate = updateCalls.find(
      (u) => u.ExpressionAttributeValues?.[':contextTokenEstimate'] !== undefined
    );
    expect(metricsUpdate).toBeDefined();
    expect(metricsUpdate!.ExpressionAttributeValues[':contextTokenEstimate']).toBeGreaterThan(0);
    expect(metricsUpdate!.ExpressionAttributeValues[':outputTokens']).toBe(60);
  });
});

// ── TS-15b: Transient error with lease extension ──────────────────────────────

describe('transient error retry (R-21a, TS-15b)', () => {
  it('extends leaseExpiresAt before retry on ThrottlingException; succeeds on second attempt', async () => {
    // GIVEN — first Bedrock call throws ThrottlingException; second succeeds
    setupHappyPath();
    const throttleError = Object.assign(
      new Error('Rate exceeded'),
      { name: 'ThrottlingException' }
    );
    mockBedrockSend
      .mockRejectedValueOnce(throttleError)
      .mockResolvedValue({ body: makeBedrockResponseBody() });

    // Stub sleep so test runs instantly
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any; });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — a lease-extension UpdateCommand was issued before the retry
    const leaseExtensions = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .filter((c) =>
        c[0].input?.UpdateExpression?.includes('leaseExpiresAt = :le')
      );
    expect(leaseExtensions.length).toBeGreaterThanOrEqual(1);

    // AND — Bedrock was called twice (fail + retry)
    expect(mockBedrockSend).toHaveBeenCalledTimes(2);

    // AND — run is NOT marked failed (retry recovered)
    expect(updatePrun).not.toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'failed' })
    );

    vi.unstubAllGlobals();
  });
});

// ── TS-15: Terminal error on non-optional step ────────────────────────────────

describe('terminal error on non-optional step (R-16, TS-15)', () => {
  it('marks step failed, marks run failed, does not dispatch next Lambda', async () => {
    // GIVEN — non-optional step; Bedrock throws a non-transient error on every attempt
    setupHappyPath({ optional: false });
    const fatalError = new Error('Model deployment error — not retryable');
    mockBedrockSend.mockRejectedValue(fatalError);
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any; });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — step record written with status: 'failed'
    const failedStep = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) =>
        c[0].input?.ExpressionAttributeValues?.[':status'] === 'failed'
      );
    expect(failedStep).toBeDefined();

    // AND — run is marked failed with failedAt set
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'failed', failedAt: expect.any(String) })
    );

    // AND — Lambda was NOT dispatched
    expect(mockLambdaSend).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ── TS-11: Terminal error on optional step ────────────────────────────────────

describe('terminal error on optional step (R-15, TS-11)', () => {
  it('marks step warning, appends to PRUN.warnings, dispatches next step', async () => {
    // GIVEN — 2-step pipeline; step 0 is optional and fails terminally
    const step0 = makeStep({ stepId: 's0', optional: true });
    const step1 = makeStep({ stepId: 's1', optional: false });
    const pipeline = makePipeline([step0, step1]);

    setupHappyPath({ optional: true });
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);
    mockBedrockSend.mockRejectedValue(new Error('Optional step exploded'));
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any; });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — step record written with status: 'warning'
    const warningStep = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) =>
        c[0].input?.ExpressionAttributeValues?.[':status'] === 'warning'
      );
    expect(warningStep).toBeDefined();

    // AND — list_append call appended warning to PRUN
    const warningsAppend = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) =>
        c[0].input?.UpdateExpression?.includes('list_append')
      );
    expect(warningsAppend).toBeDefined();

    // AND — run is NOT marked failed
    expect(updatePrun).not.toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'failed' })
    );

    // AND — next step Lambda dispatched with correct payload and InvocationType
    expect(mockLambdaSend).toHaveBeenCalledOnce();
    const lambdaArg = mockLambdaSend.mock.calls[0][0] as any;
    expect(lambdaArg.input.InvocationType).toBe('Event');
    const payload = JSON.parse(Buffer.from(lambdaArg.input.Payload).toString());
    expect(payload).toEqual({ runId: RUN_ID, stepIndex: 1 });

    vi.unstubAllGlobals();
  });
});

// ── TS-12: All optional steps warning → completed_with_warnings ───────────────

describe('completed_with_warnings (TS-12)', () => {
  it('single optional step that warns causes run to end with completed_with_warnings', async () => {
    // GIVEN — single-step pipeline; step is optional; it fails terminally
    const step = makeStep({ stepId: 's0', optional: true });
    const pipeline = makePipeline([step]);

    setupHappyPath({ optional: true });
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);
    // listPrunSteps returns the warning step so the final-step check detects it
    vi.mocked(listPrunSteps).mockResolvedValue([
      { stepId: 's0', stepIndex: 0, status: 'warning', label: 'Generate plan' },
    ] as any);
    mockBedrockSend.mockRejectedValue(new Error('terminal failure'));
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any; });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — run ends with completed_with_warnings (not failed, not completed)
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'completed_with_warnings' })
    );
    expect(updatePrun).not.toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'failed' })
    );

    vi.unstubAllGlobals();
  });
});

// ── TS-16: Age check after step completes ─────────────────────────────────────

describe('max age check after step (R-23, TS-16)', () => {
  it('marks run timed_out and does not dispatch next step when maxAgeMinutes exceeded', async () => {
    // GIVEN — run started 70 seconds ago; maxAgeMinutes: 1 (60 s)
    // System cap is 5 min (300 s) — 70 s < 300 s so system cap passes first check.
    // Age check: 70 s > 60 s → triggers timeout.
    const step0 = makeStep({ stepId: 's0' });
    const step1 = makeStep({ stepId: 's1' });
    const pipeline = makePipeline([step0, step1], { maxAgeMinutes: 1 });

    setupHappyPath();
    vi.mocked(getPrun).mockResolvedValue(
      freshRun({ startedAt: new Date(Date.now() - 70_000).toISOString() }) as any
    );
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — run is marked timed_out
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'timed_out' })
    );

    // AND — next step Lambda was NOT dispatched
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ── TS-14: Last step completes ────────────────────────────────────────────────

describe('last step completion (R-20, TS-14)', () => {
  it('marks run completed and completedAt set; no Lambda dispatched', async () => {
    // GIVEN — single-step pipeline (step 0 is the last step)
    setupHappyPath();
    vi.mocked(listPrunSteps).mockResolvedValue([]);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — run marked completed with completedAt
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      RUN_ID,
      expect.objectContaining({ status: 'completed', completedAt: expect.any(String) })
    );

    // AND — no Lambda dispatched
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ── TS-13: Non-last step dispatches next Lambda ───────────────────────────────

describe('next step dispatch for non-last step (R-17)', () => {
  it('invokes Lambda with InvocationType: Event and stepIndex + 1 in payload', async () => {
    // GIVEN — 2-step pipeline; running step 0
    const step0 = makeStep({ stepId: 's0' });
    const step1 = makeStep({ stepId: 's1' });
    const pipeline = makePipeline([step0, step1]);

    setupHappyPath();
    vi.mocked(getPipeline).mockResolvedValue(pipeline as any);

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — Lambda invoked exactly once with Event type and incremented stepIndex
    expect(mockLambdaSend).toHaveBeenCalledOnce();
    const lambdaArg = mockLambdaSend.mock.calls[0][0] as any;
    expect(lambdaArg.input.InvocationType).toBe('Event');
    expect(lambdaArg.input.FunctionName).toBe('step-worker-fn');
    const payload = JSON.parse(Buffer.from(lambdaArg.input.Payload).toString());
    expect(payload).toEqual({ runId: RUN_ID, stepIndex: 1 });
  });
});

// ── TS-19: Large output written to S3 ────────────────────────────────────────

describe('output size threshold (R-19)', () => {
  it('output > 64 KB is written to S3 with key pipeline-outputs/<runId>/<paddedIndex>.json', async () => {
    // GIVEN — Bedrock returns output that serializes to > 64 KB
    setupHappyPath();
    mockBedrockSend.mockResolvedValue({ body: makeBedrockResponseBodyWithLargeOutput() });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — S3 PutObject called with correct key
    expect(mockS3Send).toHaveBeenCalledOnce();
    const s3Arg = mockS3Send.mock.calls[0][0] as any;
    expect(s3Arg._name).toBe('PutObjectCommand');
    expect(s3Arg.input.Key).toBe(`pipeline-outputs/${RUN_ID}/00.json`);
    expect(s3Arg.input.ContentType).toBe('application/json');

    // AND — step record outputRef is { s3Key: ... } not inline
    const metricsUpdate = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) => c[0].input?.ExpressionAttributeValues?.[':outputRef'] !== undefined);
    expect(metricsUpdate).toBeDefined();
    const outputRef = metricsUpdate![0].input.ExpressionAttributeValues[':outputRef'];
    expect(outputRef).toHaveProperty('s3Key', `pipeline-outputs/${RUN_ID}/00.json`);
    expect(outputRef).not.toHaveProperty('inline');
  });

  it('output <= 64 KB is stored inline — no S3 write', async () => {
    // GIVEN — normal-sized Bedrock output
    setupHappyPath();

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — no S3 PutObject
    expect(mockS3Send).not.toHaveBeenCalled();

    // AND — outputRef uses inline storage
    const metricsUpdate = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) => c[0].input?.ExpressionAttributeValues?.[':outputRef'] !== undefined);
    expect(metricsUpdate).toBeDefined();
    const outputRef = metricsUpdate![0].input.ExpressionAttributeValues[':outputRef'];
    expect(outputRef).toHaveProperty('inline');
    expect(outputRef).not.toHaveProperty('s3Key');
  });
});

// ── TS-33: Error fields redacted ──────────────────────────────────────────────

describe('error redaction (R-51, TS-33)', () => {
  it('errorMessage and errorStack are written to step record on terminal failure', async () => {
    // GIVEN — non-optional step fails terminally with a stack trace
    setupHappyPath({ optional: false });
    const fatalError = new Error('Fatal: connection refused');
    fatalError.stack = 'Error: Fatal: connection refused\n  at stepWorker (pipeline.ts:1)';
    mockBedrockSend.mockRejectedValue(fatalError);
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any; });

    // WHEN
    await stepWorker({ runId: RUN_ID, stepIndex: 0 });

    // THEN — terminal UpdateCommand has both errorMessage (:em) and errorStack (:es)
    const terminalUpdate = mockDdbSend.mock.calls
      .filter((c) => c[0]?._name === 'UpdateCommand')
      .find((c) => {
        const vals = c[0].input?.ExpressionAttributeValues;
        return vals?.[':status'] === 'failed' && vals?.[':em'] !== undefined;
      });
    expect(terminalUpdate).toBeDefined();
    const vals = terminalUpdate![0].input.ExpressionAttributeValues;
    expect(vals[':em']).toBeTruthy();
    expect(vals[':es']).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
