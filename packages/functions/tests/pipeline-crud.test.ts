/**
 * Tests for pipeline CRUD handlers (T-03a).
 *
 * Requirements: R-03, R-04, R-05, R-06, R-07, R-08, R-09, R-10, R-45
 * Design: API Surface Changes
 *
 * Uses vi.mock to stub the repository functions that the pipeline handlers call
 * (module-bound pattern — handlers import the repo helpers at module scope).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

vi.mock('../src/repository.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/repository.js')>();
  return {
    getPipeline: vi.fn(),
    putPipeline: vi.fn(),
    updatePipeline: vi.fn(),
    listPipelines: vi.fn(),
    getPrun: vi.fn(),
    listPrunSteps: vi.fn(),
    getSysconfig: vi.fn(),
    getPrmpt: vi.fn(),
    // Pure key-builder functions — use real implementations (no DDB, no side effects)
    pipelinePk: real.pipelinePk,
    prunPk: real.prunPk,
    stepSk: real.stepSk,
    prmptPk: real.prmptPk,
    sysconfigPk: real.sysconfigPk,
    listActiveRunsByPipelineId: vi.fn(),
  };
});

import {
  createPipeline,
  listPipelines,
  getPipelineHandler,
  updatePipelineHandler,
  updatePipeline,
  deletePipeline,
} from '../src/pipeline.js';

import {
  getPipeline as getPipelineRepo,
  putPipeline,
  updatePipeline as updatePipelineRepo,
  listPipelines as listPipelinesRepo,
  getSysconfig,
  getPrmpt,
  listPrunSteps,
  listActiveRunsByPipelineId,
} from '../src/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(
  body?: object,
  pathParameters: Record<string, string> = {},
  queryStringParameters: Record<string, string> = {}
): APIGatewayProxyEventV2 {
  return {
    body: body !== undefined ? JSON.stringify(body) : undefined,
    pathParameters,
    queryStringParameters,
    headers: {},
    requestContext: {} as any,
    version: '2.0',
    routeKey: '',
    rawPath: '',
    rawQueryString: '',
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function allowlist(models: string[] = ['us.anthropic.claude-sonnet-4-6']) {
  return {
    pk: 'SYSCONFIG',
    sk: 'MODEL_ALLOWLIST',
    allowedModels: models,
    pricing: {
      'us.anthropic.claude-sonnet-4-6': {
        inputPricePerMillionTokens: 3,
        outputPricePerMillionTokens: 15,
      },
    },
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function activePrompt(promptKey: string) {
  return {
    pk: `PRMPT#${promptKey}`,
    sk: 'PRMPT',
    kind: 'PRMPT' as const,
    promptKey,
    currentVersion: 1,
    body: 'You are a helpful assistant.',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function validStep(overrides: Partial<{ model: string; promptKey: string }> = {}) {
  return {
    stepId: 's1',
    label: 'Generate tests',
    model: 'us.anthropic.claude-sonnet-4-6',
    promptKey: 'my-prompt',
    optional: false,
    waitForHuman: false,
    includeContext: true,
    ...overrides,
  };
}

function existingPipeline(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pk: 'PIPELINE#pipe-1',
    sk: 'PIPELINE',
    kind: 'PIPELINE' as const,
    pipelineId: 'pipe-1',
    name: 'Test Pipeline',
    steps: [validStep()],
    maxSteps: 10,
    maxAgeMinutes: 60,
    active: true,
    defaultSampling: { strategy: 'first_n' as const, n: 3 },
    defaultMode: 'per_requirement' as const,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: put/update always succeed
  vi.mocked(putPipeline).mockResolvedValue(undefined);
  vi.mocked(updatePipelineRepo).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// TS-01: valid POST → HTTP 201, item shape has version: 1
// ---------------------------------------------------------------------------

describe('createPipeline (POST /pipelines)', () => {
  it('TS-01: valid payload → HTTP 201, response includes version: 1 (R-05)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    // WHEN
    const res = await createPipeline(ev({ name: 'My Pipeline', steps: [validStep()] }));

    // THEN
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body!);
    expect(body.version).toBe(1);
    expect(body.pipelineId).toBeTruthy();
  });

  it('TS-01: created item written to DDB with version: 1 and active: true', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    // WHEN
    await createPipeline(ev({ name: 'My Pipeline', steps: [validStep()] }));

    // THEN
    expect(putPipeline).toHaveBeenCalledOnce();
    const written = vi.mocked(putPipeline).mock.calls[0][1];
    expect(written.version).toBe(1);
    expect(written.active).toBe(true);
  });

  // TS-27: POST with no defaultSampling or defaultMode → DDB item has defaults applied
  it('TS-27: POST without defaultSampling or defaultMode → defaults applied (R-45)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    // WHEN
    await createPipeline(ev({ name: 'Defaults Test', steps: [validStep()] }));

    // THEN — item written has default sampling and mode per R-45
    const written = vi.mocked(putPipeline).mock.calls[0][1];
    expect(written.defaultSampling).toEqual({ strategy: 'first_n', n: 3 });
    expect(written.defaultMode).toBe('per_requirement');
  });

  it('TS-27: POST without maxSteps → item gets default maxSteps of 10 (R-05)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    // WHEN
    await createPipeline(ev({ name: 'Defaults Test', steps: [validStep()] }));

    // THEN
    const written = vi.mocked(putPipeline).mock.calls[0][1];
    expect(written.maxSteps).toBe(10);
  });

  // TS-02: POST with 6 steps and maxSteps: 5 → HTTP 422
  it('TS-02: steps.length (6) > maxSteps (5) → HTTP 422 (R-03)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    // Each step references a different prompt key; mock all as active
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    const steps = Array.from({ length: 6 }, (_, i) =>
      ({ ...validStep(), stepId: `s${i}`, promptKey: 'my-prompt' })
    );

    // WHEN
    const res = await createPipeline(ev({ name: 'Too Many Steps', steps, maxSteps: 5 }));

    // THEN
    expect(res.statusCode).toBe(422);
  });

  // TS-03: POST with maxSteps: 25 → HTTP 422 with hard cap message
  it('TS-03: maxSteps > 20 → HTTP 422 with hard cap message (R-04)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    // WHEN
    const res = await createPipeline(ev({ name: 'Over Cap', steps: [validStep()], maxSteps: 25 }));

    // THEN
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body!);
    // The error message must reference the hard cap (20) — R-04 / TS-03
    const errorText = JSON.stringify(body);
    expect(errorText).toMatch(/20|hard cap|maximum/i);
  });

  // TS-06: POST with step model not in allowlist → HTTP 422
  it('TS-06: step model not in allowlist → HTTP 422 (R-10)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist(['us.anthropic.claude-sonnet-4-6']));
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));

    const step = validStep({ model: 'us.anthropic.claude-unknown-999' });

    // WHEN
    const res = await createPipeline(ev({ name: 'Bad Model', steps: [step] }));

    // THEN
    expect(res.statusCode).toBe(422);
  });

  // TS-35: POST with step's promptKey pointing to soft-deleted prompt → HTTP 422
  it('TS-35: step promptKey references soft-deleted prompt → HTTP 422 (R-06, R-52)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue({
      ...activePrompt('deleted-prompt'),
      active: false,
    });

    const step = validStep({ promptKey: 'deleted-prompt' });

    // WHEN
    const res = await createPipeline(ev({ name: 'Dead Prompt', steps: [step] }));

    // THEN
    expect(res.statusCode).toBe(422);
  });

  it('TS-35: step promptKey not found → HTTP 422 (R-06)', async () => {
    // GIVEN
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(undefined); // prompt does not exist

    const step = validStep({ promptKey: 'nonexistent-prompt' });

    // WHEN
    const res = await createPipeline(ev({ name: 'Missing Prompt', steps: [step] }));

    // THEN
    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// TS-04 / TS-05: DELETE /pipelines/{id}
// ---------------------------------------------------------------------------

describe('deletePipeline (DELETE /pipelines/{id})', () => {
  // TS-04: DELETE with no active runs → active: false, HTTP 200
  it('TS-04: no active runs → sets active: false, returns HTTP 200 (R-08)', async () => {
    // GIVEN
    vi.mocked(getPipelineRepo).mockResolvedValue(existingPipeline());
    vi.mocked(listActiveRunsByPipelineId).mockResolvedValue([]); // no active runs

    // WHEN
    const res = await deletePipeline(ev(undefined, { id: 'pipe-1' }));

    // THEN
    expect(res.statusCode).toBe(200);
    // The pipeline must be soft-deleted (active: false) — R-08
    expect(updatePipelineRepo).toHaveBeenCalledWith(
      expect.anything(), // DDB client
      'pipe-1',
      expect.objectContaining({ active: false })
    );
  });

  // TS-05: DELETE with a run in 'running' status → HTTP 409
  it('TS-05: pipeline has a run in running status → HTTP 409 (R-09)', async () => {
    // GIVEN
    vi.mocked(getPipelineRepo).mockResolvedValue(existingPipeline());
    vi.mocked(listActiveRunsByPipelineId).mockResolvedValue([
      {
        pk: 'PRUN#run-1',
        sk: 'PRUN',
        runId: 'run-1',
        pipelineId: 'pipe-1',
        status: 'running',
      } as any,
    ]);

    // WHEN
    const res = await deletePipeline(ev(undefined, { id: 'pipe-1' }));

    // THEN
    expect(res.statusCode).toBe(409);
  });

  it('DELETE on non-existent pipeline → HTTP 404', async () => {
    // GIVEN
    vi.mocked(getPipelineRepo).mockResolvedValue(undefined);

    // WHEN
    const res = await deletePipeline(ev(undefined, { id: 'no-such-pipe' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// TS-23: 15 pipeline items → GET /pipelines → response includes nextToken
// ---------------------------------------------------------------------------

describe('listPipelines (GET /pipelines)', () => {
  it('TS-23: repo returns nextToken → response body includes nextToken (R-37)', async () => {
    // GIVEN — the repository returns a page with a nextToken indicating more items
    const fakeNextToken = Buffer.from(
      JSON.stringify({ pk: 'PIPELINE#15', sk: 'PIPELINE' })
    ).toString('base64');

    vi.mocked(listPipelinesRepo).mockResolvedValue({
      items: Array.from({ length: 10 }, (_, i) => ({
        pipelineId: `pipe-${i}`,
        name: `Pipeline ${i}`,
        active: true,
        steps: [],
      })) as any[],
      nextToken: fakeNextToken,
    });

    // WHEN
    const res = await listPipelines(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.nextToken).toBe(fakeNextToken);
    expect(body.items).toHaveLength(10);
  });

  it('single page of results → no nextToken in response', async () => {
    // GIVEN
    vi.mocked(listPipelinesRepo).mockResolvedValue({
      items: [{ pipelineId: 'pipe-1', name: 'Only One', active: true, steps: [] }] as any[],
    });

    // WHEN
    const res = await listPipelines(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.nextToken).toBeUndefined();
  });

  it('forwards nextToken query parameter to the repository', async () => {
    // GIVEN
    const cursor = Buffer.from(JSON.stringify({ pk: 'PIPELINE#5' })).toString('base64');
    vi.mocked(listPipelinesRepo).mockResolvedValue({ items: [] });

    // WHEN
    await listPipelines(ev(undefined, {}, { nextToken: cursor }));

    // THEN — the repo helper is called with the cursor so the second page is fetched
    expect(listPipelinesRepo).toHaveBeenCalledWith(expect.anything(), cursor);
  });
});

// ---------------------------------------------------------------------------
// v0.4.0: step outputType validation (R-59)
// ---------------------------------------------------------------------------

describe('step outputType validation (R-59)', () => {
  beforeEach(() => {
    vi.mocked(getSysconfig).mockResolvedValue(allowlist());
    vi.mocked(getPrmpt).mockResolvedValue(activePrompt('my-prompt'));
  });

  it('POST accepts plan | critique | freeform and an absent outputType', async () => {
    const steps = [
      { ...validStep(), stepId: 's1', outputType: 'plan' },
      { ...validStep(), stepId: 's2', outputType: 'critique' },
      { ...validStep(), stepId: 's3', outputType: 'freeform' },
      { ...validStep(), stepId: 's4' },
    ];
    const res = await createPipeline(ev({ name: 'Typed', steps }));
    expect(res.statusCode).toBe(201);
    const written = vi.mocked(putPipeline).mock.calls[0][1];
    expect(written.steps.map((st) => st.outputType)).toEqual(['plan', 'critique', 'freeform', undefined]);
  });

  it('POST with an unknown outputType → HTTP 422', async () => {
    const res = await createPipeline(ev({ name: 'Bad', steps: [{ ...validStep(), outputType: 'essay' }] }));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body!).error).toMatch(/outputType "essay"/);
    expect(putPipeline).not.toHaveBeenCalled();
  });

  it('PUT with an unknown outputType → HTTP 422', async () => {
    vi.mocked(getPipelineRepo).mockResolvedValue(existingPipeline() as any);
    const res = await updatePipeline(
      ev({ steps: [{ ...validStep(), outputType: 'review' }] }, { id: 'pipe-1' })
    );
    expect(res.statusCode).toBe(422);
    expect(updatePipelineRepo).not.toHaveBeenCalled();
  });

  it('POST accepts outputInstructions true / false / absent and persists it (R-73)', async () => {
    const steps = [
      { ...validStep(), stepId: 's1', outputInstructions: true },
      { ...validStep(), stepId: 's2', outputInstructions: false },
      { ...validStep(), stepId: 's3' },
    ];
    const res = await createPipeline(ev({ name: 'Instr', steps }));
    expect(res.statusCode).toBe(201);
    const written = vi.mocked(putPipeline).mock.calls[0][1];
    expect(written.steps.map((st) => st.outputInstructions)).toEqual([true, false, undefined]);
  });

  it('POST with a non-boolean outputInstructions → HTTP 422', async () => {
    const res = await createPipeline(ev({ name: 'Bad', steps: [{ ...validStep(), outputInstructions: 'yes' }] }));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body!).error).toMatch(/outputInstructions/);
    expect(putPipeline).not.toHaveBeenCalled();
  });

  it('PUT with a non-boolean outputInstructions → HTTP 422', async () => {
    vi.mocked(getPipelineRepo).mockResolvedValue(existingPipeline() as any);
    const res = await updatePipeline(
      ev({ steps: [{ ...validStep(), outputInstructions: 1 }] }, { id: 'pipe-1' })
    );
    expect(res.statusCode).toBe(422);
    expect(updatePipelineRepo).not.toHaveBeenCalled();
  });
});
