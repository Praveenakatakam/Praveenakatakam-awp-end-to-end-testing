import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repository } from '../src/repository.js';
import * as read from '../src/read.js';

const ev = (pathParameters: any = {}) => ({ pathParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('test-artifacts read handlers (T-22 · R-90)', () => {
  it('GET /test-artifacts lists generation runs (AC-90)', async () => {
    vi.spyOn(repository, 'listGenRuns').mockResolvedValue([{ runId: 'g-2' }, { runId: 'g-1' }] as any);
    const res = await read.testArtifacts(ev());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).runs.map((r: any) => r.runId)).toEqual(['g-2', 'g-1']);
  });

  it('GET /test-artifacts/latest returns the run + inline artifacts (AC-90, D-32)', async () => {
    vi.spyOn(repository, 'getLatestGenRun').mockResolvedValue({ runId: 'g-2', counts: { conformance: 2 } } as any);
    vi.spyOn(repository, 'getArtifacts').mockResolvedValue({ manifest: { tests: [] }, files: [] } as any);
    const res = await read.testArtifactsLatest(ev());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.run.runId).toBe('g-2');
    expect(body.artifacts).toBeTruthy();
  });

  it('GET /test-artifacts/latest → 404 when there are no runs', async () => {
    vi.spyOn(repository, 'getLatestGenRun').mockResolvedValue(undefined);
    expect((await read.testArtifactsLatest(ev())).statusCode).toBe(404);
  });

  it('GET /test-artifacts/{runId} returns run + inline artifacts, 404 when unknown (AC-90)', async () => {
    vi.spyOn(repository, 'getGenRun').mockResolvedValueOnce({ runId: 'g-1' } as any);
    vi.spyOn(repository, 'getArtifacts').mockResolvedValueOnce({ manifest: { tests: [] }, files: [] } as any);
    const ok = await read.testArtifact(ev({ runId: 'g-1' }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).run.runId).toBe('g-1');

    vi.spyOn(repository, 'getGenRun').mockResolvedValueOnce(undefined);
    expect((await read.testArtifact(ev({ runId: 'nope' }))).statusCode).toBe(404);
  });
});

describe('adversarial summary in read responses (T-46a · R-143)', () => {
  const adversarial = { verdict: 'FAIL — review findings', counts: { vacuity: { Critical: 0, Major: 1, Minor: 0 } } };
  const report = { generator: 'testgen', verdict: 'FAIL — review findings' };

  it('GET /test-artifacts/latest and /{runId} lift { verdict, counts, report } to the top level', async () => {
    vi.spyOn(repository, 'getLatestGenRun').mockResolvedValue({ runId: 'g-3', adversarial } as any);
    vi.spyOn(repository, 'getGenRun').mockResolvedValue({ runId: 'g-3', adversarial } as any);
    vi.spyOn(repository, 'getArtifacts').mockResolvedValue({ manifest: { tests: [] }, files: [], report } as any);
    for (const res of [await read.testArtifactsLatest(ev()), await read.testArtifact(ev({ runId: 'g-3' }))]) {
      expect(JSON.parse(res.body!).adversarial).toEqual({ ...adversarial, report });
    }
  });

  it('GET /functional-test-jobs/latest and /{jobId} lift the same shape from the job record', async () => {
    const job = { jobId: 'fj-3', status: 'succeeded', adversarial };
    vi.spyOn(repository, 'getLatestFunctionalJob').mockResolvedValue(job as any);
    vi.spyOn(repository, 'getFunctionalJob').mockResolvedValue(job as any);
    vi.spyOn(repository, 'getFunctionalArtifacts').mockResolvedValue({ manifest: { plans: [] }, files: [], report } as any);
    for (const res of [await read.functionalJobLatest(ev()), await read.functionalJob(ev({ jobId: 'fj-3' }))]) {
      expect(JSON.parse(res.body!).adversarial).toEqual({ ...adversarial, report });
    }
  });

  it('a run/job from before the adversarial stage has no adversarial key (back-compat)', async () => {
    vi.spyOn(repository, 'getLatestGenRun').mockResolvedValue({ runId: 'g-old' } as any);
    vi.spyOn(repository, 'getArtifacts').mockResolvedValue({ manifest: { tests: [] }, files: [] } as any);
    expect(JSON.parse((await read.testArtifactsLatest(ev())).body!).adversarial).toBeUndefined();
  });
});
