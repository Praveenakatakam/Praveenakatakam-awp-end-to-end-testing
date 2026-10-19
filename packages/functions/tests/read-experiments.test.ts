/**
 * v0.6.0 unified experiment read endpoints (T-29):
 * `GET /experiment-index` and `GET /experiment-results/{kind}/{id}`.
 *
 * Module-bound pattern (as read-pipeline.test.ts): the repository functions
 * read.ts imports are vi.mocked; S3 is stubbed.
 *
 * Requirements: R-82, R-83 · Tests: TS-70, TS-71
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const s3Objects = vi.hoisted(() => new Map<string, string>());
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({
    send: vi.fn(async (cmd: { input: { Key: string } }) => {
      const body = s3Objects.get(cmd.input.Key);
      if (body === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: { transformToString: async () => body } };
    }),
  })),
  GetObjectCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock('../src/repository.js', () => ({
  repository: {
    listExperiments: vi.fn(),
    getExperiment: vi.fn(),
    getExperimentArtifact: vi.fn(),
    listRequirements: vi.fn(),
  },
  getPipeline: vi.fn(),
  listPipelines: vi.fn(),
  getPrmpt: vi.fn(),
  listPrmpts: vi.fn(),
  listPrmptVers: vi.fn(),
  getPrun: vi.fn(),
  listPrunSteps: vi.fn(),
  listPruns: vi.fn(),
  updatePrun: vi.fn(),
  getPexp: vi.fn(),
  listPexps: vi.fn(),
  batchGetPruns: vi.fn(),
}));

import { experimentIndex, experimentResults, aggregateExperimentStatus } from '../src/read.js';
import { requiredGroup } from '../src/authorizer.js';
import { repository, getPipeline, listPrunSteps, getPexp, listPexps, batchGetPruns } from '../src/repository.js';
import { emitFunctionalTests } from '@registry/functest';
import type { PipelineExperiment, PipelineRun, StepRecord, ExperimentRecord, PipelineConfig } from '@registry/core';

function ev(pathParameters?: Record<string, string>): APIGatewayProxyEventV2 {
  return { pathParameters } as unknown as APIGatewayProxyEventV2;
}

function pexp(overrides: Partial<PipelineExperiment> = {}): PipelineExperiment {
  return {
    pk: 'PEXP#exp-p',
    sk: 'PEXP',
    kind: 'PEXP',
    experimentId: 'exp-p',
    pipelineId: 'pipe-1',
    pipelineName: 'Baseline (legacy v1)',
    pipelineConfigVersion: 2,
    sampling: { strategy: 'all' },
    mode: 'per_requirement',
    runs: [
      { runId: 'run-1', requirementIds: ['publisher/R-1'] },
      { runId: 'run-2', requirementIds: ['publisher/R-2'] },
    ],
    skipped: [{ requirement: 'publisher/R-9', reason: 'references no cataloged entity' }],
    createdAt: '2026-10-19T12:00:00.000Z',
    startedAt: '2026-10-19T12:00:00.000Z',
    createdBy: 'writer@demo',
    ...overrides,
  };
}

function prun(runId: string, status: PipelineRun['status'], extra: Partial<PipelineRun> = {}): PipelineRun {
  return {
    pk: `PRUN#${runId}`,
    sk: 'PRUN',
    kind: 'PRUN',
    runId,
    pipelineId: 'pipe-1',
    pipelineConfigVersion: 2,
    status,
    startedAt: '2026-10-19T12:00:00.000Z',
    sampling: { strategy: 'all' },
    mode: 'per_requirement',
    requirementIds: [],
    executedSteps: 0,
    warnings: [],
    experimentId: 'exp-p',
    ...extra,
  } as PipelineRun;
}

const legacyRecord: ExperimentRecord = {
  experimentId: 'exp-l',
  kind: 'EXPERIMENT',
  status: 'succeeded',
  promptVersion: 'v1',
  createdAt: '2026-10-18T09:00:00.000Z',
  startedAt: '2026-10-18T09:00:00.000Z',
  createdBy: 'writer@demo',
  planCount: 2,
  skipCount: 1,
  skips: ['publisher/R-9'],
  artifactKey: 'experiments/exp-l/artifacts.json',
};

const v1Plan = (reqId: string, entity: string) => ({
  title: `Plan ${reqId}`,
  requirementIds: [reqId],
  setup: [],
  trigger: { source: 'publisher', entity, method: 'POST', path: `/${entity}`, payloadShape: 'body' },
  propagation: { kind: 'cdc', from: 'publisher', to: 'consumer' },
  assertions: [{ service: 'consumer', description: 'record present' }],
  inputHash: `hash-${reqId}`,
});

const pipelineConfig = {
  pipelineId: 'pipe-1',
  steps: [
    { stepId: 'plan', outputType: 'plan' },
    { stepId: 'critique', outputType: 'critique' },
  ],
} as unknown as PipelineConfig;

beforeEach(() => {
  vi.clearAllMocks();
  s3Objects.clear();
});

// ---------------------------------------------------------------------------
// Status aggregation (R-82)
// ---------------------------------------------------------------------------

describe('aggregateExperimentStatus (R-82)', () => {
  const agg = (...statuses: (PipelineRun['status'] | undefined)[]) => {
    const headers = new Map<string, PipelineRun>();
    statuses.forEach((s, i) => s && headers.set(`r${i}`, prun(`r${i}`, s)));
    return aggregateExperimentStatus(statuses.map((_, i) => `r${i}`), headers);
  };
  it('running if any run is non-terminal (or not yet written)', () => {
    expect(agg('completed', 'running')).toBe('running');
    expect(agg('completed', undefined)).toBe('running');
  });
  it('failed only if every run failed', () => {
    expect(agg('failed', 'failed')).toBe('failed');
    expect(agg('failed', 'timed_out')).toBe('failed');
  });
  it('completed_with_warnings if any run failed or warned', () => {
    expect(agg('completed', 'failed')).toBe('completed_with_warnings');
    expect(agg('completed', 'completed_with_warnings')).toBe('completed_with_warnings');
  });
  it('completed when every run completed', () => {
    expect(agg('completed', 'completed')).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// GET /experiment-index (TS-70)
// ---------------------------------------------------------------------------

describe('experimentIndex (GET /experiment-index)', () => {
  it('TS-70: returns legacy + pipeline experiments newest first; pipeline status aggregated', async () => {
    vi.mocked(listPexps).mockResolvedValue({ items: [pexp()] });
    vi.mocked(repository.listExperiments).mockResolvedValue([legacyRecord]);
    vi.mocked(batchGetPruns).mockResolvedValue(
      new Map([
        ['run-1', prun('run-1', 'completed', { artifact: { stepId: 'plan', s3Key: 'k', path: 'p' } })],
        ['run-2', prun('run-2', 'failed')],
      ])
    );

    const res = await experimentIndex(ev());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({
      experiments: [
        {
          id: 'exp-p',
          kind: 'pipeline',
          label: 'Baseline (legacy v1) v2',
          createdAt: '2026-10-19T12:00:00.000Z',
          status: 'completed_with_warnings',
          requirementCount: 2,
          resultCount: 1,
          skipCount: 1,
        },
        {
          id: 'exp-l',
          kind: 'legacy',
          label: 'v1',
          createdAt: '2026-10-18T09:00:00.000Z',
          status: 'succeeded',
          requirementCount: 3,
          resultCount: 2,
          skipCount: 1,
        },
      ],
    });
    expect(vi.mocked(batchGetPruns).mock.calls[0][1]).toEqual(['run-1', 'run-2']);
  });

  it('follows listPexps pagination and sorts across kinds by createdAt desc', async () => {
    vi.mocked(listPexps)
      .mockResolvedValueOnce({ items: [pexp({ experimentId: 'a', createdAt: '2026-10-10T00:00:00Z', runs: [] })], nextToken: 't' })
      .mockResolvedValueOnce({ items: [pexp({ experimentId: 'b', createdAt: '2026-10-01T00:00:00Z', runs: [] })] });
    vi.mocked(repository.listExperiments).mockResolvedValue([{ ...legacyRecord, createdAt: '2026-10-05T00:00:00Z' }]);
    vi.mocked(batchGetPruns).mockResolvedValue(new Map());

    const body = JSON.parse((await experimentIndex(ev())).body as string);
    expect(body.experiments.map((e: { id: string }) => e.id)).toEqual(['a', 'exp-l', 'b']);
    expect(vi.mocked(listPexps).mock.calls[1][1]).toBe('t');
  });

  it('is a reader route (not in WRITER_ROUTES)', () => {
    expect(requiredGroup('GET /experiment-index')).toBe('reader');
    expect(requiredGroup('GET /experiment-results/{kind}/{id}')).toBe('reader');
  });
});

// ---------------------------------------------------------------------------
// GET /experiment-results/{kind}/{id} (TS-71)
// ---------------------------------------------------------------------------

describe('experimentResults (GET /experiment-results/{kind}/{id})', () => {
  it('TS-71 (pipeline): returns the last completed plan step output and the run artifact', async () => {
    const planA = v1Plan('R-1', 'org');
    const planB = { ...planA, title: 'Revised' };
    vi.mocked(getPexp).mockResolvedValue(pexp({ runs: [{ runId: 'run-1', requirementIds: ['publisher/R-1'] }] }));
    vi.mocked(getPipeline).mockResolvedValue({
      ...pipelineConfig,
      steps: [
        { stepId: 'plan', outputType: 'plan' },
        { stepId: 'critique', outputType: 'critique' },
        { stepId: 'revise', outputType: 'plan' },
      ],
    } as unknown as PipelineConfig);
    vi.mocked(batchGetPruns).mockResolvedValue(
      new Map([
        [
          'run-1',
          prun('run-1', 'completed', {
            artifact: { stepId: 'revise', s3Key: 'pipeline-outputs/run-1/test.generated.ts', path: 'functional/r-1-org.generated.test.ts' },
          }),
        ],
      ])
    );
    vi.mocked(listPrunSteps).mockResolvedValue([
      { stepIndex: 0, stepId: 'plan', status: 'completed', outputRef: { inline: JSON.stringify(planA) } },
      { stepIndex: 1, stepId: 'critique', status: 'completed', outputRef: { inline: '{"verdict":"revise"}' } },
      { stepIndex: 2, stepId: 'revise', status: 'cached', outputRef: { s3Key: 'pipeline-outputs/run-1/02.json' } },
    ] as unknown as StepRecord[]);
    s3Objects.set('pipeline-outputs/run-1/02.json', JSON.stringify(planB));
    s3Objects.set('pipeline-outputs/run-1/test.generated.ts', '// emitted');

    const res = await experimentResults(ev({ kind: 'pipeline', id: 'exp-p' }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.experiment).toMatchObject({ id: 'exp-p', kind: 'pipeline', status: 'completed', resultCount: 1 });
    expect(body.results).toEqual([
      {
        requirementId: 'publisher/R-1',
        runId: 'run-1',
        status: 'completed',
        plan: planB,
        testFile: { path: 'functional/r-1-org.generated.test.ts', content: '// emitted' },
      },
    ]);
    expect(body.skipped).toEqual([{ requirement: 'publisher/R-9', reason: 'references no cataloged entity' }]);
  });

  it('pipeline: a run with no completed plan step and no artifact → plan null, testFile null', async () => {
    vi.mocked(getPexp).mockResolvedValue(pexp({ runs: [{ runId: 'run-2', requirementIds: ['publisher/R-2'] }] }));
    vi.mocked(getPipeline).mockResolvedValue(pipelineConfig);
    vi.mocked(batchGetPruns).mockResolvedValue(new Map([['run-2', prun('run-2', 'failed')]]));
    vi.mocked(listPrunSteps).mockResolvedValue([
      { stepIndex: 0, stepId: 'plan', status: 'failed', errorMessage: 'malformed plan' },
    ] as unknown as StepRecord[]);

    const body = JSON.parse((await experimentResults(ev({ kind: 'pipeline', id: 'exp-p' }))).body as string);
    expect(body.results).toEqual([
      { requirementId: 'publisher/R-2', runId: 'run-2', status: 'failed', plan: null, testFile: null },
    ]);
    expect(body.experiment.status).toBe('failed');
  });

  it('TS-71 (legacy): an artifact with 2 plans → 2 results paired with their files; bare ids qualified', async () => {
    const plans = [v1Plan('R-1', 'org'), v1Plan('R-2', 'course')];
    const files = emitFunctionalTests(plans as never);
    vi.mocked(repository.getExperiment).mockResolvedValue(legacyRecord);
    vi.mocked(repository.getExperimentArtifact).mockResolvedValue({
      manifest: {
        manifestVersion: 1,
        promptVersion: 'v1',
        modelId: 'm',
        plans,
        skipped: [{ requirement: 'publisher/R-9', reason: 'references no cataloged entity' }],
      },
      files,
    });
    // R-1 exists only in publisher → qualified; R-2 exists in two sources → left bare.
    vi.mocked(repository.listRequirements).mockResolvedValue([
      { source: 'publisher', id: 'R-1' },
      { source: 'publisher', id: 'R-2' },
      { source: 'consumer', id: 'R-2' },
    ] as never);

    const res = await experimentResults(ev({ kind: 'legacy', id: 'exp-l' }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.experiment).toEqual({
      id: 'exp-l',
      kind: 'legacy',
      label: 'v1',
      createdAt: '2026-10-18T09:00:00.000Z',
      status: 'succeeded',
      requirementCount: 3,
      resultCount: 2,
      skipCount: 1,
    });
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      requirementId: 'publisher/R-1',
      status: 'completed',
      plan: plans[0],
      testFile: { path: files[0].path, content: files[0].contents },
    });
    expect(body.results[1].requirementId).toBe('R-2');
    expect(body.results[1].testFile).toEqual({ path: files[1].path, content: files[1].contents });
    expect(body.results[0].runId).toBeUndefined();
    expect(body.skipped).toEqual([{ requirement: 'publisher/R-9', reason: 'references no cataloged entity' }]);
  });

  it('legacy experiment not yet succeeded → no results, skipped from the record', async () => {
    vi.mocked(repository.getExperiment).mockResolvedValue({ ...legacyRecord, status: 'running', planCount: undefined, skipCount: undefined, skips: undefined });
    const body = JSON.parse((await experimentResults(ev({ kind: 'legacy', id: 'exp-l' }))).body as string);
    expect(body.results).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(body.experiment.status).toBe('running');
    expect(repository.getExperimentArtifact).not.toHaveBeenCalled();
  });

  it('404 for an unknown kind', async () => {
    expect((await experimentResults(ev({ kind: 'bogus', id: 'x' }))).statusCode).toBe(404);
  });

  it('404 for an unknown id of either kind', async () => {
    vi.mocked(getPexp).mockResolvedValue(undefined);
    vi.mocked(repository.getExperiment).mockResolvedValue(undefined);
    expect((await experimentResults(ev({ kind: 'pipeline', id: 'nope' }))).statusCode).toBe(404);
    expect((await experimentResults(ev({ kind: 'legacy', id: 'nope' }))).statusCode).toBe(404);
  });
});
