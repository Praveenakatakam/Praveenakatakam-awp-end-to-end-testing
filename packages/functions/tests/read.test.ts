import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repository } from '../src/repository.js';
import * as read from '../src/read.js';

const ev = (pathParameters: any = {}, queryStringParameters: any = {}) => ({ pathParameters, queryStringParameters }) as any;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('read API handlers (T-13 · R-50..R-55)', () => {
  it('GET /contracts returns the catalog and forwards filters (AC-50)', async () => {
    const spy = vi.spyOn(repository, 'listEntries').mockResolvedValue([{ source: 'publisher', id: 'org-1', entity: 'org' } as any]);
    const res = await read.contracts(ev({}, { entity: 'org' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).items).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ source: undefined, entity: 'org', validation: undefined });
  });

  it('GET /contracts/{source}/{id} returns entry + history, 404 when missing (AC-51, AC-54)', async () => {
    vi.spyOn(repository, 'getEntry').mockResolvedValueOnce({ entry: { id: 'org-1' } as any, versions: [{ versionNumber: 1 }] });
    const ok = await read.contract(ev({ source: 'publisher', id: 'org-1' }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body!).versions).toHaveLength(1);

    vi.spyOn(repository, 'getEntry').mockResolvedValueOnce(undefined);
    const missing = await read.contract(ev({ source: 'publisher', id: 'nope' }));
    expect(missing.statusCode).toBe(404);
  });

  it('GET /contracts/{source}/{id}/raw serves YAML, 404 when missing (AC-52, AC-54)', async () => {
    vi.spyOn(repository, 'getRaw').mockResolvedValueOnce('version: 1.0.0\nkind: DataContract\n');
    const res = await read.raw(ev({ source: 'publisher', id: 'org-1' }, { version: '1' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers!['content-type']).toBe('application/yaml');
    expect(res.body).toContain('DataContract');

    vi.spyOn(repository, 'getRaw').mockResolvedValueOnce(undefined);
    expect((await read.raw(ev({ source: 'publisher', id: 'x' }))).statusCode).toBe(404);
  });

  it('GET /entities/{entity} returns variants + divergent + diff for two variants (AC-53)', async () => {
    vi.spyOn(repository, 'getEntityVariants').mockResolvedValue({
      entity: 'user',
      variants: [
        { source: 'publisher', id: 'user-1', currentHash: 'hA' },
        { source: 'consumer', id: 'user-1', currentHash: 'hB' },
      ],
      divergent: true,
    });
    vi.spyOn(repository, 'getRaw')
      .mockResolvedValueOnce('schema:\n  - name: user\n    properties:\n      - name: a\n        required: true\n')
      .mockResolvedValueOnce('schema:\n  - name: user\n    properties:\n      - name: a\n        required: false\n      - name: b\n');
    const res = await read.entity(ev({ entity: 'user' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.divergent).toBe(true);
    expect(body.diff).toBeTruthy();
    expect(body.diff.onlyInB.map((p: any) => p.path)).toContain('user.b');
  });

  it('orders the diff publisher-first regardless of storage order (R-53; A=publisher)', async () => {
    // Real DynamoDB byEntity GSI returns source-ASCENDING → consumer BEFORE publisher.
    vi.spyOn(repository, 'getEntityVariants').mockResolvedValue({
      entity: 'user',
      variants: [
        { source: 'consumer', id: 'user-1', currentHash: 'hB' },
        { source: 'publisher', id: 'user-1', currentHash: 'hA' },
      ],
      divergent: true,
    } as any);
    // Resolve raw by source (not call order) so the assertion pins direction, not luck.
    vi.spyOn(repository, 'getRaw').mockImplementation((async (source: string) =>
      source === 'publisher'
        ? 'schema:\n  - name: user\n    properties:\n      - name: pubOnly\n        required: true\n'
        : 'schema:\n  - name: user\n    properties:\n      - name: conOnly\n        required: true\n') as any);
    const res = await read.entity(ev({ entity: 'user' }));
    const body = JSON.parse(res.body!);
    // A = publisher: publisher-only prop is onlyInA, consumer-only is onlyInB.
    expect(body.diff.onlyInA.map((p: any) => p.path)).toContain('user.pubOnly');
    expect(body.diff.onlyInB.map((p: any) => p.path)).toContain('user.conOnly');
    // Variants are returned publisher-first too (matches the SPA's labels).
    expect(body.variants[0].source).toBe('publisher');
  });

  it('divergent is false when consumer is a pure projection (onlyInA only, no onlyInB, no changed)', async () => {
    vi.spyOn(repository, 'getEntityVariants').mockResolvedValue({
      entity: 'user',
      variants: [
        { source: 'publisher', id: 'user-1', currentHash: 'hA' },
        { source: 'consumer', id: 'user-1', currentHash: 'hB' },
      ],
      divergent: true,
    });
    vi.spyOn(repository, 'getRaw')
      .mockResolvedValueOnce('schema:\n  - name: user\n    properties:\n      - name: a\n        required: true\n      - name: envelope\n        required: true\n')
      .mockResolvedValueOnce('schema:\n  - name: user\n    properties:\n      - name: a\n        required: true\n');
    const res = await read.entity(ev({ entity: 'user' }));
    const body = JSON.parse(res.body!);
    expect(body.divergent).toBe(false);
    expect(body.diff.onlyInA.map((p: any) => p.path)).toContain('user.envelope');
    expect(body.diff.onlyInB).toHaveLength(0);
    expect(body.diff.changed).toHaveLength(0);
  });

  it('GET /entities/{entity} 404 when the entity is unknown (AC-54)', async () => {
    vi.spyOn(repository, 'getEntityVariants').mockResolvedValue({ entity: 'ghost', variants: [], divergent: false });
    expect((await read.entity(ev({ entity: 'ghost' }))).statusCode).toBe(404);
  });

  it('GET /crawls and /crawls/{runId} (AC-55)', async () => {
    vi.spyOn(repository, 'listRuns').mockResolvedValue([{ runId: 'r1' }]);
    expect((await read.crawls(ev())).statusCode).toBe(200);
    vi.spyOn(repository, 'getRun').mockResolvedValueOnce({ runId: 'r1' });
    expect((await read.crawl(ev({ runId: 'r1' }))).statusCode).toBe(200);
    vi.spyOn(repository, 'getRun').mockResolvedValueOnce(undefined);
    expect((await read.crawl(ev({ runId: 'z' }))).statusCode).toBe(404);
  });

  it('GET /crawls/{runId} body includes per-source requirements counts (R-55 / R-108)', async () => {
    const runRecord = {
      runId: 'r-req',
      startedAt: '2026-07-28T00:00:00Z',
      endedAt: '2026-07-28T00:00:10Z',
      sources: [
        {
          label: 'awp-app-plane',
          outcome: 'success',
          valid: 2,
          invalid: 0,
          unchanged: 0,
          newVersion: 0,
          requirements: { discovered: 5, conforming: 4, nonConforming: 1, changed: 1, removed: 0 },
        },
      ],
    };
    vi.spyOn(repository, 'getRun').mockResolvedValueOnce(runRecord);
    const res = await read.crawl(ev({ runId: 'r-req' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.sources[0].requirements).toMatchObject({ discovered: 5, conforming: 4, nonConforming: 1 });
  });
});

// ---- Prompt versions + experiments (T-10a · prompt-versioning-experiments) ----

describe('prompt-version and experiment read handlers (T-10a)', () => {
  it('GET /prompt-versions delegates to handleListPromptVersions and omits text (R-08)', async () => {
    // GIVEN
    vi.spyOn(repository, 'listPromptVersions').mockResolvedValueOnce([
      { promptVersion: 'v1.0.0', text: 'secret prompt', modelId: 'claude-sonnet-4-6', createdAt: '2026-10-01T00:00:00Z', startedAt: '2026-10-01T00:00:00Z', createdBy: 'user' },
      { promptVersion: 'v1.1.0', text: 'another secret', modelId: 'claude-sonnet-4-6', createdAt: '2026-10-02T00:00:00Z', startedAt: '2026-10-02T00:00:00Z', createdBy: 'user' },
    ]);

    // WHEN
    const res = await read.promptVersions(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptVersions).toHaveLength(2);
    for (const item of body.promptVersions) {
      expect(item).not.toHaveProperty('text');
      expect(item.promptVersion).toBeTruthy();
    }
  });

  it('GET /prompt-versions/{pv} returns 200 with full record including text', async () => {
    // GIVEN
    const record = {
      promptVersion: 'v1.0.0',
      text: 'You are a contract test generator.',
      modelId: 'claude-sonnet-4-6',
      createdAt: '2026-10-01T00:00:00Z',
      startedAt: '2026-10-01T00:00:00Z',
      createdBy: 'test-user',
    };
    vi.spyOn(repository, 'getPromptVersion').mockResolvedValueOnce(record);

    // WHEN
    const res = await read.promptVersion(ev({ promptVersion: 'v1.0.0' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.promptVersion).toBe('v1.0.0');
    expect(body.text).toBe(record.text);
  });

  it('GET /prompt-versions/{pv} returns 404 for an unknown version', async () => {
    // GIVEN
    vi.spyOn(repository, 'getPromptVersion').mockResolvedValueOnce(undefined);

    // WHEN
    const res = await read.promptVersion(ev({ promptVersion: 'does-not-exist' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('GET /experiments returns 200 with experiments array', async () => {
    // GIVEN
    vi.spyOn(repository, 'listExperiments').mockResolvedValueOnce([
      { experimentId: 'exp-1', promptVersion: 'v1.0.0', status: 'succeeded' } as any,
      { experimentId: 'exp-2', promptVersion: 'v1.1.0', status: 'pending' } as any,
    ]);

    // WHEN
    const res = await read.experiments(ev());

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.experiments).toHaveLength(2);
    expect(body.experiments[0].experimentId).toBe('exp-1');
  });

  it('GET /experiments/{experimentId} returns 200 with the experiment record', async () => {
    // GIVEN
    const record = { experimentId: 'exp-1', promptVersion: 'v1.0.0', status: 'succeeded', planCount: 3, skipCount: 0 };
    vi.spyOn(repository, 'getExperiment').mockResolvedValueOnce(record as any);

    // WHEN
    const res = await read.experiment(ev({ experimentId: 'exp-1' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.experimentId).toBe('exp-1');
    expect(body.promptVersion).toBe('v1.0.0');
  });

  it('GET /experiments/{experimentId} returns 404 for an unknown experiment id', async () => {
    // GIVEN
    vi.spyOn(repository, 'getExperiment').mockResolvedValueOnce(undefined);

    // WHEN
    const res = await read.experiment(ev({ experimentId: 'ghost' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('GET /experiments/{experimentId}/artifact returns 200 with artifact when experiment is succeeded', async () => {
    // GIVEN
    const record = { experimentId: 'exp-1', promptVersion: 'v1.0.0', status: 'succeeded', planCount: 5, skipCount: 1 };
    const artifact = { tests: [{ name: 'test-1' }] };
    vi.spyOn(repository, 'getExperiment').mockResolvedValueOnce(record as any);
    vi.spyOn(repository, 'getExperimentArtifact').mockResolvedValueOnce(artifact as any);

    // WHEN
    const res = await read.experimentArtifact(ev({ experimentId: 'exp-1' }));

    // THEN
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.experimentId).toBe('exp-1');
    expect(body.promptVersion).toBe('v1.0.0');
    expect(body.status).toBe('succeeded');
    expect(body.planCount).toBe(5);
    expect(body.skipCount).toBe(1);
    expect(body.artifact).toEqual(artifact);
  });

  it('GET /experiments/{experimentId}/artifact returns 404 when experiment not found', async () => {
    // GIVEN
    vi.spyOn(repository, 'getExperiment').mockResolvedValueOnce(undefined);

    // WHEN
    const res = await read.experimentArtifact(ev({ experimentId: 'missing' }));

    // THEN
    expect(res.statusCode).toBe(404);
  });

  it('GET /experiments/{experimentId}/artifact returns 404 when experiment status is pending (not succeeded)', async () => {
    // GIVEN — experiment exists but has not finished running yet
    const record = { experimentId: 'exp-pending', promptVersion: 'v1.0.0', status: 'pending', planCount: 0, skipCount: 0 };
    vi.spyOn(repository, 'getExperiment').mockResolvedValueOnce(record as any);

    // WHEN
    const res = await read.experimentArtifact(ev({ experimentId: 'exp-pending' }));

    // THEN — artifact endpoint must only serve succeeded experiments
    expect(res.statusCode).toBe(404);
  });
});
