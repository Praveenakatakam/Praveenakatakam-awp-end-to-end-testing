/**
 * v0.6.0 unified experiments — PEXP record + dry run on the pipeline path of
 * `POST /generate-functional-tests` (T-29).
 *
 * [unit] tier — `handleGeneratePipeline` with an injected in-memory repo, plus
 * the Lambda entrypoint with the repository module and Lambda client mocked.
 *
 * Requirements: R-80, R-81 · Tests: TS-68, TS-69
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lambdaSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((args) => args),
}));

const repoMocks = vi.hoisted(() => ({
  getPipeline: vi.fn(),
  putPrun: vi.fn(),
  putPexp: vi.fn(),
  listEntries: vi.fn(),
  getRaw: vi.fn(),
  listRequirements: vi.fn(),
}));
vi.mock('../src/repository.js', () => ({
  repository: {
    listEntries: repoMocks.listEntries,
    getRaw: repoMocks.getRaw,
    listRequirements: repoMocks.listRequirements,
  },
  getPipeline: repoMocks.getPipeline,
  putPrun: repoMocks.putPrun,
  putPexp: repoMocks.putPexp,
}));

import { handleGeneratePipeline, handler, type PipelineDispatchDeps } from '../src/functional-gen.js';
import type { PipelineConfig, PipelineExperiment, PipelineRun } from '@registry/core';
import type { CatalogEntry, RequirementRecord } from '../src/repository.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePipeline(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    pk: 'PIPELINE#pipe-1',
    sk: 'PIPELINE',
    kind: 'PIPELINE',
    pipelineId: 'pipe-1',
    name: 'Baseline',
    steps: [
      {
        stepId: 'plan',
        label: 'Plan',
        model: 'us.anthropic.claude-sonnet-4-6',
        promptKey: 'p1',
        optional: false,
        waitForHuman: false,
        includeContext: false,
      },
    ],
    maxSteps: 10,
    maxAgeMinutes: 60,
    active: true,
    defaultSampling: { strategy: 'all' },
    defaultMode: 'per_requirement',
    version: 4,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Groundable when the text mentions the cross-service `org` entity. */
function req(id: string, text = `WHEN an org ${id} event occurs it SHALL be handled`): RequirementRecord {
  return {
    source: 'publisher',
    id,
    text,
    section: '3.1',
    earsType: 'event',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: false,
    specHash: 'h',
    lastCrawledAt: '2026-07-16T00:00:00Z',
  };
}

function entry(source: string): CatalogEntry {
  return {
    source,
    id: 'org-contract',
    entity: 'org',
    currentVersion: 1,
    currentHash: `${source}-hash`,
    validation: 'valid',
    commitSha: 'sha',
    filePath: 'contracts/x.yaml',
    lastCrawledAt: '2026-07-16T00:00:00Z',
  };
}

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
].join('\n');

/** 3 groundable requirements + 1 that references no cataloged entity. */
const REQUIREMENTS = [req('R-001'), req('R-002'), req('R-003'), req('R-004', 'The system SHALL be fast')];

function fakeDeps(pipeline = makePipeline()) {
  const calls: string[] = [];
  const pexps: PipelineExperiment[] = [];
  const pruns: PipelineRun[] = [];
  const dispatched: string[] = [];
  const deps = {
    async getPipelineConfig() {
      return pipeline;
    },
    async listEntries() {
      return [entry('publisher'), entry('consumer')];
    },
    async getRaw() {
      return ORG_YAML;
    },
    async listRequirements() {
      return REQUIREMENTS;
    },
    async writePexp(p: PipelineExperiment) {
      calls.push('writePexp');
      pexps.push(p);
    },
    async writePrun(r: PipelineRun) {
      calls.push(`writePrun:${r.runId}`);
      pruns.push(r);
    },
  } as unknown as PipelineDispatchDeps;
  const dispatch = async (runId: string) => {
    calls.push(`dispatch:${runId}`);
    dispatched.push(runId);
  };
  return { deps, dispatch, calls, pexps, pruns, dispatched };
}

const clock = { now: () => '2026-10-19T12:00:00.000Z' };
let n = 0;
const runIds = () => `run-${++n}`;
const expId = () => 'exp-1';

beforeEach(() => {
  n = 0;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TS-68 — one PEXP per trigger, written before any PRUN
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — PEXP record (R-80, TS-68)', () => {
  it('TS-68: 3 selected requirements → one PEXP with 3 runs; each PRUN carries experimentId; 202 has experimentId', async () => {
    const { deps, dispatch, pexps, pruns } = fakeDeps();

    const res = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', createdBy: 'writer@demo' },
      runIds,
      clock,
      expId
    );

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.experimentId).toBe('exp-1');
    expect(body.runIds).toEqual(['run-1', 'run-2', 'run-3']);

    expect(pexps).toHaveLength(1);
    const pexp = pexps[0];
    expect(pexp).toEqual({
      pk: 'PEXP#exp-1',
      sk: 'PEXP',
      kind: 'PEXP',
      experimentId: 'exp-1',
      pipelineId: 'pipe-1',
      pipelineName: 'Baseline',
      pipelineConfigVersion: 4,
      sampling: { strategy: 'all' },
      mode: 'per_requirement',
      runs: [
        { runId: 'run-1', requirementIds: ['publisher/R-001'] },
        { runId: 'run-2', requirementIds: ['publisher/R-002'] },
        { runId: 'run-3', requirementIds: ['publisher/R-003'] },
      ],
      skipped: [{ requirement: 'publisher/R-004', reason: expect.any(String) }],
      createdAt: '2026-10-19T12:00:00.000Z',
      startedAt: '2026-10-19T12:00:00.000Z',
      createdBy: 'writer@demo',
    });

    expect(pruns).toHaveLength(3);
    for (const r of pruns) expect(r.experimentId).toBe('exp-1');
  });

  it('writes the PEXP before any PRUN write or dispatch', async () => {
    const { deps, dispatch, calls } = fakeDeps();
    await handleGeneratePipeline(deps, dispatch, { pipelineId: 'pipe-1' }, runIds, clock, expId);
    expect(calls).toEqual([
      'writePexp',
      'writePrun:run-1',
      'dispatch:run-1',
      'writePrun:run-2',
      'dispatch:run-2',
      'writePrun:run-3',
      'dispatch:run-3',
    ]);
  });

  it('batch mode → one PEXP run entry holding every selected requirement; 202 has runId + experimentId', async () => {
    const { deps, dispatch, pexps, pruns } = fakeDeps();
    const res = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', mode: 'batch' },
      runIds,
      clock,
      expId
    );
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ runId: 'run-1', skipped: expect.any(Array), experimentId: 'exp-1' });
    expect(pexps[0].runs).toEqual([
      { runId: 'run-1', requirementIds: ['publisher/R-001', 'publisher/R-002', 'publisher/R-003'] },
    ]);
    expect(pexps[0].mode).toBe('batch');
    expect(pruns[0].experimentId).toBe('exp-1');
  });

  it('writes no PEXP when nothing groundable is selected (R-56)', async () => {
    const { deps, dispatch, pexps, pruns } = fakeDeps();
    const res = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 0 } },
      runIds,
      clock,
      expId
    );
    expect(res.statusCode).toBe(422);
    expect(pexps).toHaveLength(0);
    expect(pruns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TS-69 — dry run
// ---------------------------------------------------------------------------

describe('handleGeneratePipeline — dry run (R-81, TS-69)', () => {
  it('TS-69: dryRun → 200 { selected, skipped }; nothing written or dispatched', async () => {
    const { deps, dispatch, calls } = fakeDeps();
    const res = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 2 }, dryRun: true },
      runIds,
      clock,
      expId
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      selected: ['publisher/R-001', 'publisher/R-002'],
      skipped: [{ requirement: 'publisher/R-004', reason: expect.any(String) }],
    });
    expect(calls).toEqual([]);
  });

  it('dry run selecting nothing → 200 with selected: [] (the 422 applies only to a real trigger)', async () => {
    const { deps, dispatch, calls } = fakeDeps();
    const res = await handleGeneratePipeline(
      deps,
      dispatch,
      { pipelineId: 'pipe-1', sampling: { strategy: 'first_n', n: 0 }, dryRun: true },
      runIds,
      clock,
      expId
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).selected).toEqual([]);
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lambda entrypoint wiring
// ---------------------------------------------------------------------------

describe('functional-gen handler — pipeline path wiring (R-80, R-81)', () => {
  beforeEach(() => {
    repoMocks.getPipeline.mockResolvedValue(makePipeline());
    repoMocks.listEntries.mockResolvedValue([entry('publisher'), entry('consumer')]);
    repoMocks.getRaw.mockResolvedValue(ORG_YAML);
    repoMocks.listRequirements.mockResolvedValue(REQUIREMENTS);
    repoMocks.putPrun.mockResolvedValue(undefined);
    repoMocks.putPexp.mockResolvedValue(undefined);
    process.env.STEP_WORKER_FUNCTION_NAME = 'step-worker';
  });

  it('TS-69: { dryRun: true } → 200, no PutCommand (putPexp/putPrun) and no Lambda invoke', async () => {
    const res = await handler({ body: JSON.stringify({ pipelineId: 'pipe-1', dryRun: true }) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).selected).toEqual(['publisher/R-001', 'publisher/R-002', 'publisher/R-003']);
    expect(repoMocks.putPexp).not.toHaveBeenCalled();
    expect(repoMocks.putPrun).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('real trigger writes the PEXP (createdBy from the authorizer) then PRUNs, and invokes the step worker', async () => {
    const res = await handler({
      body: JSON.stringify({ pipelineId: 'pipe-1' }),
      requestContext: { authorizer: { lambda: { username: 'writer@demo' } } },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(typeof body.experimentId).toBe('string');
    expect(repoMocks.putPexp).toHaveBeenCalledTimes(1);
    const pexp = repoMocks.putPexp.mock.calls[0][1] as PipelineExperiment;
    expect(pexp.experimentId).toBe(body.experimentId);
    expect(pexp.createdBy).toBe('writer@demo');
    expect(repoMocks.putPexp.mock.invocationCallOrder[0]).toBeLessThan(repoMocks.putPrun.mock.invocationCallOrder[0]);
    expect(repoMocks.putPrun).toHaveBeenCalledTimes(3);
    for (const [, prun] of repoMocks.putPrun.mock.calls) expect((prun as PipelineRun).experimentId).toBe(body.experimentId);
    expect(lambdaSend).toHaveBeenCalledTimes(3);
  });
});
