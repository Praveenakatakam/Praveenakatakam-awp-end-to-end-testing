/**
 * Tests for the T-08 dual-path dispatch (pipeline vs legacy FJOB) and the
 * per_requirement / batch execution modes.
 *
 * [unit] tier — pure logic with injectable repo; @aws-sdk/client-lambda is
 * mocked as a safety net to prevent any real invocations.
 *
 * Requirements: R-47, R-48, R-49, R-50
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// @aws-sdk/client-lambda is mocked so that dispatchWorker (the real production
// Lambda invocation path) never reaches the network even if an entrypoint
// test accidentally exercises it.
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  InvokeCommand: vi.fn().mockImplementation((args) => args),
}));

import {
  handleGeneratePipeline,
  type PipelineDispatchDeps,
} from '../src/functional-gen.js';
import type { PipelineConfig, PipelineRun, SamplingConfig, ExecutionMode } from '@registry/core';
import type { RequirementRecord } from '../src/repository.js';

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

function makePipeline(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    pk: 'PIPELINE#pipe-1',
    sk: 'PIPELINE',
    kind: 'PIPELINE',
    pipelineId: 'pipe-1',
    name: 'Test Pipeline',
    steps: [
      {
        stepId: 's0',
        label: 'Generate',
        model: 'us.anthropic.claude-sonnet-4-6',
        promptKey: 'functional-test-gen-default',
        optional: false,
        waitForHuman: false,
        includeContext: true,
      },
    ],
    maxSteps: 10,
    maxAgeMinutes: 60,
    active: true,
    defaultSampling: { strategy: 'first_n', n: 3 },
    defaultMode: 'per_requirement',
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRequirement(id: string): RequirementRecord {
  return {
    source: 'publisher',
    id,
    text: `WHEN a ${id} event occurs it SHALL be handled`,
    section: '3.1',
    earsType: 'event',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: false,
    specHash: 'h',
    lastCrawledAt: '2026-07-16T00:00:00Z',
  };
}

/** In-memory PipelineDispatchDeps — captures all PRUN writes and dispatch calls. */
function fakeDeps(pipeline?: PipelineConfig | null, requirementIds: string[] = ['R-001', 'R-002', 'R-003', 'R-004', 'R-005']) {
  const prunWrites: PipelineRun[] = [];
  const dispatchCalls: string[] = [];
  const callOrder: string[] = [];

  const deps: PipelineDispatchDeps = {
    async getPipelineConfig(id) {
      if (pipeline === undefined) return makePipeline({ pipelineId: id });
      return pipeline ?? undefined;
    },
    async listEntries() { return []; },
    async listRequirements() {
      return requirementIds.map(makeRequirement);
    },
    async writePrun(run) {
      callOrder.push('writePrun');
      prunWrites.push(run);
    },
  };

  async function dispatch(runId: string): Promise<void> {
    callOrder.push('dispatch');
    dispatchCalls.push(runId);
  }

  return { deps, dispatch, prunWrites, dispatchCalls, callOrder };
}

const clock = { now: () => '2026-10-14T12:00:00Z' };
let runCounter = 0;
const runIdMaker = () => `run-${++runCounter}`;

beforeEach(() => {
  vi.clearAllMocks();
  runCounter = 0;
});

// ---------------------------------------------------------------------------
// HTTP routing — pipeline path vs legacy FJOB path
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — routing (T-08 · D-13)', () => {
  it('returns HTTP 202 with runIds when pipelineId is provided (new pipeline path)', async () => {
    // GIVEN
    const { deps, dispatch } = fakeDeps();

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body).toHaveProperty('runIds');
  });
});

// ---------------------------------------------------------------------------
// Unknown / inactive pipeline → HTTP 422 (R-48, edge case §5)
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — invalid pipeline guard', () => {
  it('returns HTTP 422 when pipelineId does not exist', async () => {
    // GIVEN pipeline not found (getPipeline returns undefined)
    const { deps, dispatch } = fakeDeps(null);

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'nonexistent' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.body);
    expect(body.error).toBeTruthy();
  });

  it('returns HTTP 422 when pipeline is inactive (active: false)', async () => {
    // GIVEN inactive pipeline
    const { deps, dispatch } = fakeDeps(makePipeline({ active: false }));

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(422);
    const body = JSON.parse(result.body);
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// per_requirement mode (R-48, TS-30)
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — per_requirement mode (R-48)', () => {
  it('TS-30: first_n: 2 with 5 requirements → 2 runIds, 2 PRUN records', async () => {
    // GIVEN pipeline with default mode per_requirement; sampling override first_n: 2
    const { deps, dispatch, prunWrites } = fakeDeps();

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 2 }, mode: 'per_requirement' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body.runIds)).toBe(true);
    expect(body.runIds).toHaveLength(2);
    expect(prunWrites).toHaveLength(2);
  });

  it('each PRUN record has exactly one requirementId in per_requirement mode', async () => {
    // GIVEN
    const { deps, dispatch, prunWrites } = fakeDeps();

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 3 }, mode: 'per_requirement' },
      runIdMaker,
      clock
    );

    // THEN every PRUN has exactly one requirementId
    for (const run of prunWrites) {
      expect(run.requirementIds).toHaveLength(1);
    }
  });

  it('dispatches exactly one step Lambda per PRUN in per_requirement mode', async () => {
    // GIVEN
    const { deps, dispatch, dispatchCalls } = fakeDeps();

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 3 }, mode: 'per_requirement' },
      runIdMaker,
      clock
    );

    // THEN N dispatch calls, one per requirement
    expect(dispatchCalls).toHaveLength(3);
  });

  it('returns { runIds: [] } with no PRUNs created when selection is empty (first_n: 0)', async () => {
    // GIVEN sampling that selects nothing
    const { deps, dispatch, prunWrites, dispatchCalls } = fakeDeps();

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 0 }, mode: 'per_requirement' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    expect(body.runIds).toEqual([]);
    expect(prunWrites).toHaveLength(0);
    expect(dispatchCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// batch mode (R-49, TS-31)
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — batch mode (R-49)', () => {
  it('TS-31: first_n: 2 with 5 requirements → single runId, one PRUN with 2 requirementIds', async () => {
    // GIVEN
    const { deps, dispatch, prunWrites } = fakeDeps();

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 2 }, mode: 'batch' },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(202);
    const body = JSON.parse(result.body);
    // batch mode returns single runId, not array
    expect(typeof body.runId).toBe('string');
    expect(body.runIds).toBeUndefined();
    expect(prunWrites).toHaveLength(1);
    expect(prunWrites[0].requirementIds).toHaveLength(2);
  });

  it('dispatches exactly one step Lambda in batch mode regardless of requirement count', async () => {
    // GIVEN
    const { deps, dispatch, dispatchCalls } = fakeDeps();

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'all' }, mode: 'batch' },
      runIdMaker,
      clock
    );

    // THEN only one Lambda invoked
    expect(dispatchCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PRUN written BEFORE Lambda dispatch (ordering guarantee)
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — write ordering', () => {
  it('putPrun is called before dispatch for every run', async () => {
    // GIVEN
    const { deps, dispatch, callOrder } = fakeDeps();

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 2 }, mode: 'per_requirement' },
      runIdMaker,
      clock
    );

    // THEN each putPrun precedes its paired dispatch call
    // callOrder alternates: putPrun, dispatch, putPrun, dispatch, …
    expect(callOrder.length).toBe(4);
    for (let i = 0; i < callOrder.length; i += 2) {
      expect(callOrder[i]).toBe('writePrun');
      expect(callOrder[i + 1]).toBe('dispatch');
    }
  });

  it('putPrun before dispatch in batch mode', async () => {
    // GIVEN
    const { deps, dispatch, callOrder } = fakeDeps();

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 3 }, mode: 'batch' },
      runIdMaker,
      clock
    );

    // THEN putPrun first, then dispatch
    expect(callOrder[0]).toBe('writePrun');
    expect(callOrder[1]).toBe('dispatch');
  });
});

// ---------------------------------------------------------------------------
// PRUN record content — status, sampling, mode, pipelineConfigVersion
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — PRUN record content (TS-12, TS-29)', () => {
  it('TS-12: PRUN has status: running and startedAt set', async () => {
    // GIVEN
    const { deps, dispatch, prunWrites } = fakeDeps();

    // WHEN
    const result = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 1 } },
      runIdMaker,
      clock
    );

    // THEN
    expect(result.statusCode).toBe(202);
    expect(prunWrites[0].status).toBe('running');
    expect(prunWrites[0].startedAt).toBe(clock.now());
  });

  it('PRUN records the pipelineConfigVersion snapshot from the pipeline', async () => {
    // GIVEN pipeline at version 7
    const { deps, dispatch, prunWrites } = fakeDeps(makePipeline({ version: 7 }));

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 1 } },
      runIdMaker,
      clock
    );

    // THEN
    expect(prunWrites[0].pipelineConfigVersion).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Run-override: sampling and mode overrides (R-47, R-50, TS-29)
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — run-request overrides (R-47, R-50)', () => {
  it('TS-29: sampling override applied — PRUN has sampling.strategy: "all" and mode: "batch"', async () => {
    // GIVEN pipeline with first_n/per_requirement defaults; request overrides both
    const { deps, dispatch, prunWrites } = fakeDeps(
      makePipeline({ defaultSampling: { strategy: 'first_n', n: 1 }, defaultMode: 'per_requirement' })
    );

    // WHEN
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'all' }, mode: 'batch' },
      runIdMaker,
      clock
    );

    // THEN PRUN has the overridden values, not the pipeline defaults
    expect(prunWrites[0].sampling).toEqual({ strategy: 'all' });
    expect(prunWrites[0].mode).toBe('batch');
  });

  it('uses pipeline defaultSampling when no override provided (R-50)', async () => {
    // GIVEN pipeline with defaultSampling first_n: 2
    const { deps, dispatch, prunWrites } = fakeDeps(
      makePipeline({ defaultSampling: { strategy: 'first_n', n: 2 } })
    );

    // WHEN — no sampling override
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1' },
      runIdMaker,
      clock
    );

    // THEN 2 PRUNs (per_requirement default mode, n=2)
    expect(prunWrites).toHaveLength(2);
    for (const run of prunWrites) {
      expect(run.sampling).toEqual({ strategy: 'first_n', n: 2 });
    }
  });

  it('uses pipeline defaultMode when no mode override provided (R-50)', async () => {
    // GIVEN pipeline with defaultMode batch
    const { deps, dispatch, prunWrites } = fakeDeps(
      makePipeline({ defaultMode: 'batch', defaultSampling: { strategy: 'first_n', n: 2 } })
    );

    // WHEN — no mode override
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1' },
      runIdMaker,
      clock
    );

    // THEN single PRUN (batch mode)
    expect(prunWrites).toHaveLength(1);
    expect(prunWrites[0].mode).toBe('batch');
  });

  it('mode override alone (sampling inherits from pipeline default)', async () => {
    // GIVEN pipeline default sampling first_n: 2, mode per_requirement
    const { deps, dispatch, prunWrites } = fakeDeps(
      makePipeline({ defaultSampling: { strategy: 'first_n', n: 2 }, defaultMode: 'per_requirement' })
    );

    // WHEN — override mode only
    await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', mode: 'batch' },
      runIdMaker,
      clock
    );

    // THEN one PRUN (batch), sampling from pipeline default (first_n: 2)
    expect(prunWrites).toHaveLength(1);
    expect(prunWrites[0].mode).toBe('batch');
    expect(prunWrites[0].sampling).toEqual({ strategy: 'first_n', n: 2 });
  });
});
