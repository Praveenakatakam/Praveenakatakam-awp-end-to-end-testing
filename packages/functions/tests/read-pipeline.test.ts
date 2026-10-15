/**
 * Tests for T-05 read handlers — GET pipeline/prompt endpoints and the lazy
 * lease-expiry check on GET /runs/{runId} (T-05a).
 *
 * Requirements: R-25, R-26-loop, R-35, R-36, R-37
 * Design: Lazy expiry detection, API Surface Changes
 *
 * Uses vi.mock to stub the repository functions that read.ts imports at module
 * scope (module-bound pattern — matching the pipeline-crud.test.ts convention).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

vi.mock('../src/repository.js', () => ({
  // Existing repository singleton (used by pre-existing read handlers)
  repository: {
    listEntries: vi.fn(),
    getEntry: vi.fn(),
    getRaw: vi.fn(),
    getEntityVariants: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    listGenRuns: vi.fn(),
    getLatestGenRun: vi.fn(),
    getArtifacts: vi.fn(),
    getGenRun: vi.fn(),
    listFunctionalJobs: vi.fn(),
    getLatestFunctionalJob: vi.fn(),
    getFunctionalArtifacts: vi.fn(),
    getFunctionalJob: vi.fn(),
    listRequirements: vi.fn(),
    getRequirementsForSource: vi.fn(),
    getRequirement: vi.fn(),
    listExperiments: vi.fn(),
    getExperiment: vi.fn(),
    getExperimentArtifact: vi.fn(),
  },
  // New T-05 pipeline/prompt/prun helpers
  getPipeline: vi.fn(),
  listPipelines: vi.fn(),
  getPrmpt: vi.fn(),
  listPrmpts: vi.fn(),
  listPrmptVers: vi.fn(),
  getPrun: vi.fn(),
  listPrunSteps: vi.fn(),
  updatePrun: vi.fn(),
}));

import {
  getPipelinesHandler,
  getPipelineHandler,
  getPromptsHandler,
  getPromptHandler,
  getPromptVersionsHandler,
  getPipelineRunHandler,
} from '../src/read.js';

import {
  getPipeline,
  listPipelines,
  getPrmpt,
  listPrmpts,
  listPrmptVers,
  getPrun,
  listPrunSteps,
  updatePrun,
} from '../src/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ev(
  pathParameters: Record<string, string> = {},
  queryStringParameters: Record<string, string> = {}
): APIGatewayProxyEventV2 {
  return {
    pathParameters,
    queryStringParameters,
    headers: {},
    body: undefined,
    requestContext: {} as any,
    version: '2.0',
    routeKey: '',
    rawPath: '',
    rawQueryString: '',
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

/** Builds a minimal PipelineRun fixture. */
function runFixture(
  runId: string,
  status: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    pk: `PRUN#${runId}`,
    sk: 'PRUN',
    kind: 'PRUN',
    runId,
    pipelineId: 'pipe-1',
    status,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

/** Builds a minimal step record. */
function stepFixture(
  runId: string,
  stepIndex: number,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    pk: `PRUN#${runId}`,
    sk: `STEP#${String(stepIndex).padStart(2, '0')}`,
    runId,
    stepId: `s${stepIndex}`,
    status: 'completed',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updatePrun).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getPipelinesHandler — GET /pipelines
// ---------------------------------------------------------------------------

describe('getPipelinesHandler (GET /pipelines)', () => {
  it('returns 200 with pipeline list from repository (R-35, R-37)', async () => {
    // GIVEN
    vi.mocked(listPipelines).mockResolvedValue({
      items: [
        { pipelineId: 'pipe-1', name: 'Pipeline A', active: true } as any,
        { pipelineId: 'pipe-2', name: 'Pipeline B', active: true } as any,
      ],
    });

    // WHEN
    const res = await getPipelinesHandler(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].pipelineId).toBe('pipe-1');
  });

  it('passes nextToken query param to the repository (R-37)', async () => {
    // GIVEN
    const cursor = Buffer.from(JSON.stringify({ pk: 'PIPELINE#5' })).toString('base64');
    vi.mocked(listPipelines).mockResolvedValue({ items: [] });

    // WHEN
    await getPipelinesHandler(ev({}, { nextToken: cursor }));

    // THEN
    expect(listPipelines).toHaveBeenCalledWith(expect.anything(), cursor);
  });

  it('forwards nextToken from repository to response body (R-37)', async () => {
    // GIVEN
    const nextToken = Buffer.from(JSON.stringify({ pk: 'PIPELINE#10' })).toString('base64');
    vi.mocked(listPipelines).mockResolvedValue({
      items: [{ pipelineId: 'pipe-1', active: true } as any],
      nextToken,
    });

    // WHEN
    const res = await getPipelinesHandler(ev());

    // THEN
    const body = JSON.parse(res.body!);
    expect(body.nextToken).toBe(nextToken);
  });
});

// ---------------------------------------------------------------------------
// getPipelineHandler — GET /pipelines/{id}
// ---------------------------------------------------------------------------

describe('getPipelineHandler (GET /pipelines/{id})', () => {
  it('returns 200 with the pipeline when found (R-35)', async () => {
    // GIVEN
    vi.mocked(getPipeline).mockResolvedValue({
      pipelineId: 'pipe-1',
      name: 'My Pipeline',
      active: true,
    } as any);

    // WHEN
    const res = await getPipelineHandler(ev({ id: 'pipe-1' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.pipelineId).toBe('pipe-1');
  });

  it('returns 404 when pipeline not found (R-35)', async () => {
    // GIVEN
    vi.mocked(getPipeline).mockResolvedValue(undefined);

    // WHEN
    const res = await getPipelineHandler(ev({ id: 'unknown-pipe' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when path parameter is missing', async () => {
    // WHEN — no id path parameter
    const res = await getPipelineHandler(ev());

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// getPromptsHandler — GET /prompts
// ---------------------------------------------------------------------------

describe('getPromptsHandler (GET /prompts)', () => {
  it('returns 200 with prompt list from repository (R-35, R-37)', async () => {
    // GIVEN
    vi.mocked(listPrmpts).mockResolvedValue({
      items: [
        { promptKey: 'my-prompt', currentVersion: 3, active: true } as any,
      ],
    });

    // WHEN
    const res = await getPromptsHandler(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].promptKey).toBe('my-prompt');
  });

  it('passes nextToken query param to the repository (R-37)', async () => {
    // GIVEN
    const cursor = Buffer.from(JSON.stringify({ pk: 'PRMPT#5' })).toString('base64');
    vi.mocked(listPrmpts).mockResolvedValue({ items: [] });

    // WHEN
    await getPromptsHandler(ev({}, { nextToken: cursor }));

    // THEN
    expect(listPrmpts).toHaveBeenCalledWith(expect.anything(), cursor);
  });
});

// ---------------------------------------------------------------------------
// getPromptHandler — GET /prompts/{key}
// ---------------------------------------------------------------------------

describe('getPromptHandler (GET /prompts/{key})', () => {
  it('returns 200 with prompt when found (R-35)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue({
      promptKey: 'my-prompt',
      currentVersion: 2,
      active: true,
    } as any);

    // WHEN
    const res = await getPromptHandler(ev({ key: 'my-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptKey).toBe('my-prompt');
  });

  it('returns 404 when prompt not found (R-35)', async () => {
    // GIVEN
    vi.mocked(getPrmpt).mockResolvedValue(undefined);

    // WHEN
    const res = await getPromptHandler(ev({ key: 'nonexistent' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when path parameter is missing', async () => {
    // WHEN — no key path parameter
    const res = await getPromptHandler(ev());

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// getPromptVersionsHandler — GET /prompts/{key}/versions
// ---------------------------------------------------------------------------

describe('getPromptVersionsHandler (GET /prompts/{key}/versions)', () => {
  it('returns 200 with version list (R-36)', async () => {
    // GIVEN
    vi.mocked(listPrmptVers).mockResolvedValue([
      { promptKey: 'my-prompt', version: 1, createdAt: '2026-01-01T00:00:00Z' } as any,
      { promptKey: 'my-prompt', version: 2, createdAt: '2026-06-01T00:00:00Z' } as any,
    ]);

    // WHEN
    const res = await getPromptVersionsHandler(ev({ key: 'my-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.versions).toHaveLength(2);
  });

  it('returns 200 with empty versions array when prompt has no versions', async () => {
    // GIVEN
    vi.mocked(listPrmptVers).mockResolvedValue([]);

    // WHEN
    const res = await getPromptVersionsHandler(ev({ key: 'empty-prompt' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.versions).toHaveLength(0);
  });

  it('returns 404 when path parameter is missing', async () => {
    // WHEN — no key path parameter
    const res = await getPromptVersionsHandler(ev());

    // THEN
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// getPipelineRunHandler — GET /runs/{runId} with lazy lease-expiry (T-05a · TS-17)
// ---------------------------------------------------------------------------

describe('getPipelineRunHandler (GET /runs/{runId})', () => {
  it('returns 404 when run not found', async () => {
    // GIVEN
    vi.mocked(getPrun).mockResolvedValue(undefined);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'unknown-run' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when runId path parameter is missing', async () => {
    // WHEN
    const res = await getPipelineRunHandler(ev());

    // THEN
    expect(res.statusCode).toBe(404);
  });

  // TS-17: Non-terminal run with expired lease → timed_out transition
  it('TS-17: non-terminal run with expired step lease → transitions to timed_out, returns updated run (R-25, R-26-loop)', async () => {
    // GIVEN — a running run whose step lease expired 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const runningRun = runFixture('run-1', 'running');
    const timedOutRun = { ...runningRun, status: 'timed_out', completedAt: expect.any(String) };

    vi.mocked(getPrun)
      .mockResolvedValueOnce(runningRun as any)         // first fetch
      .mockResolvedValueOnce({ ...runningRun, status: 'timed_out', completedAt: new Date().toISOString() } as any); // re-fetch after update

    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-1', 0, {
        status: 'running',
        leaseExpiresAt: tenMinutesAgo,
      }) as any,
    ]);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-1' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.run.status).toBe('timed_out');
    // updatePrun must have been called with timed_out transition
    expect(updatePrun).toHaveBeenCalledOnce();
    expect(updatePrun).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ status: 'timed_out' })
    );
  });

  it('non-terminal run with non-expired step lease → no updatePrun called, returns run as-is (R-26-loop)', async () => {
    // GIVEN — a running run whose step lease is still valid (expires in the future)
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60_000).toISOString();
    const runningRun = runFixture('run-2', 'running');

    vi.mocked(getPrun).mockResolvedValue(runningRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-2', 0, {
        status: 'running',
        leaseExpiresAt: fiveMinutesFromNow,
      }) as any,
    ]);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-2' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.run.status).toBe('running');
    expect(updatePrun).not.toHaveBeenCalled();
  });

  it('non-terminal run with step missing leaseExpiresAt → no updatePrun called', async () => {
    // GIVEN — a running run whose step has no lease field at all
    const runningRun = runFixture('run-3', 'running');

    vi.mocked(getPrun).mockResolvedValue(runningRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-3', 0, { status: 'running' }) as any,
    ]);

    // WHEN
    await getPipelineRunHandler(ev({ runId: 'run-3' }));

    // THEN
    expect(updatePrun).not.toHaveBeenCalled();
  });

  // TS-17b: Second fetch of an already-timed-out run → no second conditional update
  it('TS-17b: terminal run → no lease check, no updatePrun called (R-26-loop idempotent)', async () => {
    // GIVEN — run is already timed_out (terminal)
    const timedOutRun = runFixture('run-4', 'timed_out', {
      completedAt: new Date().toISOString(),
    });

    vi.mocked(getPrun).mockResolvedValue(timedOutRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-4', 0, {
        status: 'timed_out',
        leaseExpiresAt: new Date(Date.now() - 10 * 60_000).toISOString(), // expired — but should not matter
      }) as any,
    ]);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-4' }));

    // THEN
    expect(res.statusCode).toBe(200);
    expect(updatePrun).not.toHaveBeenCalled();
    const body = JSON.parse(res.body!);
    expect(body.run.status).toBe('timed_out');
  });

  it('terminal run with status "completed" → no updatePrun, returns run + steps', async () => {
    // GIVEN
    const completedRun = runFixture('run-5', 'completed', {
      completedAt: new Date().toISOString(),
    });

    vi.mocked(getPrun).mockResolvedValue(completedRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-5', 0, { status: 'completed' }) as any,
      stepFixture('run-5', 1, { status: 'completed' }) as any,
    ]);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-5' }));

    // THEN
    expect(res.statusCode).toBe(200);
    expect(updatePrun).not.toHaveBeenCalled();
    const body = JSON.parse(res.body!);
    expect(body.run.status).toBe('completed');
    expect(body.steps).toHaveLength(2);
  });

  it('terminal run with status "failed" → no updatePrun', async () => {
    // GIVEN
    const failedRun = runFixture('run-6', 'failed');
    vi.mocked(getPrun).mockResolvedValue(failedRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([]);

    // WHEN
    await getPipelineRunHandler(ev({ runId: 'run-6' }));

    // THEN
    expect(updatePrun).not.toHaveBeenCalled();
  });

  it('terminal run with status "completed_with_warnings" → no updatePrun', async () => {
    // GIVEN
    const warningRun = runFixture('run-7', 'completed_with_warnings');
    vi.mocked(getPrun).mockResolvedValue(warningRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([]);

    // WHEN
    await getPipelineRunHandler(ev({ runId: 'run-7' }));

    // THEN
    expect(updatePrun).not.toHaveBeenCalled();
  });

  // ConditionalCheckFailedException race condition → silently ignored
  it('ConditionalCheckFailedException on updatePrun → silently ignored, re-fetches run (R-26-loop)', async () => {
    // GIVEN — another path already transitioned the run; DDB throws the conditional error
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const runningRun = runFixture('run-8', 'running');
    const alreadyTimedOut = { ...runningRun, status: 'timed_out', completedAt: new Date().toISOString() };

    vi.mocked(getPrun)
      .mockResolvedValueOnce(runningRun as any)
      .mockResolvedValueOnce(alreadyTimedOut as any); // re-fetch returns already-transitioned state

    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-8', 0, {
        status: 'running',
        leaseExpiresAt: tenMinutesAgo,
      }) as any,
    ]);

    const conditionalErr = Object.assign(new Error('Conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    vi.mocked(updatePrun).mockRejectedValue(conditionalErr);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-8' }));

    // THEN — no throw; returns the re-fetched (already-timed-out) run
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.run.status).toBe('timed_out');
  });

  it('non-ConditionalCheckFailedException from updatePrun propagates', async () => {
    // GIVEN — a real error (not a race condition) should not be swallowed
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const runningRun = runFixture('run-9', 'running');

    vi.mocked(getPrun).mockResolvedValue(runningRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-9', 0, {
        status: 'running',
        leaseExpiresAt: tenMinutesAgo,
      }) as any,
    ]);

    const unexpectedErr = Object.assign(new Error('Service unavailable'), {
      name: 'ServiceUnavailableException',
    });
    vi.mocked(updatePrun).mockRejectedValue(unexpectedErr);

    // WHEN / THEN — the error should propagate
    await expect(getPipelineRunHandler(ev({ runId: 'run-9' }))).rejects.toThrow('Service unavailable');
  });

  it('response includes steps alongside run for non-terminal run', async () => {
    // GIVEN
    const runningRun = runFixture('run-10', 'running');
    const steps = [
      stepFixture('run-10', 0, { status: 'completed' }) as any,
      stepFixture('run-10', 1, { status: 'running' }) as any,
    ];

    vi.mocked(getPrun).mockResolvedValue(runningRun as any);
    vi.mocked(listPrunSteps).mockResolvedValue(steps);

    // WHEN
    const res = await getPipelineRunHandler(ev({ runId: 'run-10' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.steps).toHaveLength(2);
  });

  it('at most one conditional UpdateItem issued per response path (NFR — ≤50 ms budget)', async () => {
    // GIVEN — expired lease on first step; verify updatePrun called exactly once
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const runningRun = runFixture('run-11', 'running');

    vi.mocked(getPrun)
      .mockResolvedValueOnce(runningRun as any)
      .mockResolvedValueOnce({ ...runningRun, status: 'timed_out' } as any);

    // Two expired steps — but only one UpdateItem should be issued
    vi.mocked(listPrunSteps).mockResolvedValue([
      stepFixture('run-11', 0, { status: 'running', leaseExpiresAt: tenMinutesAgo }) as any,
      stepFixture('run-11', 1, { status: 'running', leaseExpiresAt: tenMinutesAgo }) as any,
    ]);

    // WHEN
    await getPipelineRunHandler(ev({ runId: 'run-11' }));

    // THEN
    expect(updatePrun).toHaveBeenCalledOnce();
  });
});
