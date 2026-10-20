import { describe, it, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import { performGeneration, type GenRepo } from '../src/generate.js';
import { handler } from '../src/generate.js';
import type { CatalogEntry } from '../src/repository.js';

function raw(entity: string, props: { name: string; required?: boolean }[]): string {
  return yaml.dump({
    id: `${entity}-id`,
    name: entity,
    schema: [{ name: entity, properties: props.map((p) => ({ name: p.name, required: !!p.required, logicalType: 'string' })) }],
  });
}

/** In-memory repo capturing what was persisted. */
function fakeRepo(entries: CatalogEntry[], rawByKey: Record<string, string>) {
  const puts: { runId: string; artifacts: any }[] = [];
  const runs: any[] = [];
  const repo: GenRepo = {
    listEntries: async () => entries,
    getRaw: async (s, id) => rawByKey[`${s}/${id}`],
    putArtifacts: async (runId, artifacts) => {
      puts.push({ runId, artifacts });
      return `test-artifacts/${runId}/artifacts.json`;
    },
    writeGenRun: async (run) => {
      runs.push(run);
    },
  };
  return { repo, puts, runs };
}

const entry = (source: string, entity: string, id: string, validation = 'valid'): CatalogEntry => ({
  source,
  id,
  entity,
  currentVersion: 1,
  currentHash: `${source}-${id}-hash`,
  declaredVersion: '1.0.0',
  validation,
  commitSha: 'c',
  filePath: `contract/${entity}.odcs.yaml`,
  lastCrawledAt: '2026-07-09T00:00:00Z',
});

describe('performGeneration (T-21 · R-80, R-81, R-89)', () => {
  it('generates from the catalog, persists artifacts + a run record, and summarises (AC-80, AC-89)', async () => {
    const entries = [entry('publisher', 'org', 'org-p'), entry('consumer', 'org', 'org-c'), entry('consumer', 'class', 'class-c')];
    const rawByKey = {
      'publisher/org-p': raw('org', [
        { name: 'sourcedId', required: true },
        { name: 'name', required: true },
      ]),
      'consumer/org-c': raw('org', [
        { name: 'sourcedId', required: true },
        { name: 'name', required: true },
      ]),
      'consumer/class-c': raw('class', [{ name: 'sourcedId', required: true }]),
    };
    const { repo, puts, runs } = fakeRepo(entries, rawByKey);

    const summary = await performGeneration(repo, 'run-1', '2026-07-09T00:00:00Z');

    // publisher/org + consumer/class are mapped → 2 conformance; org shared → 1 compat.
    expect(summary.counts.conformance).toBe(2);
    expect(summary.counts.compat).toBe(1);
    expect(summary.runId).toBe('run-1');

    // Persisted exactly once each, with the artifact set + counts.
    expect(puts).toHaveLength(1);
    expect(puts[0].artifacts.manifest.tests.length).toBe(3);
    expect(runs).toHaveLength(1);
    expect(runs[0].counts.conformance).toBe(2);
    expect(runs[0].artifactS3Key).toBe('test-artifacts/run-1/artifacts.json');

    // Run record carries the exact catalog commit context it was generated from
    // (R-89): a per-contract hash / commit SHA / declared version, not a bare count.
    expect(runs[0].catalogContext.count).toBe(3);
    expect(runs[0].catalogContext.contracts).toContainEqual({
      source: 'publisher',
      id: 'org-p',
      contentHash: 'publisher-org-p-hash',
      commitSha: 'c',
      declaredVersion: '1.0.0',
    });
    // endedAt is a real end timestamp, not a copy of startedAt (R-12 parity).
    expect(typeof runs[0].endedAt).toBe('string');
    expect(runs[0].endedAt >= '2026-07-09T00:00:00Z').toBe(true);
  });

  it('empty catalog → empty artifact set, run recorded as success, no crawl (AC-81, E-19)', async () => {
    const { repo, puts, runs } = fakeRepo([], {});
    const summary = await performGeneration(repo, 'run-empty', '2026-07-09T00:00:00Z');
    expect(summary.counts).toEqual({ conformance: 0, compat: 0, skipped: 0 });
    expect(puts[0].artifacts.files).toEqual([]);
    expect(runs[0].counts.skipped).toBe(0);
  });

  it('handler() returns statusCode 200 with application/json body containing the summary (R-80)', async () => {
    // Stub out the live repository that handler() uses internally.
    const repoModule = await import('../src/repository.js');
    const listSpy = vi.spyOn(repoModule.repository, 'listEntries').mockResolvedValue([]);
    const putSpy = vi.spyOn(repoModule.repository, 'putArtifacts').mockResolvedValue('test-artifacts/h-run/artifacts.json');
    const writeSpy = vi.spyOn(repoModule.repository, 'writeGenRun').mockResolvedValue(undefined);
    try {
      const res = await handler();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ runId: expect.any(String), counts: { conformance: 0, compat: 0, skipped: 0 } });
    } finally {
      listSpy.mockRestore();
      putSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });

  it('surfaces skip reasons for invalid / single-source contracts (AC-85, AC-89)', async () => {
    const entries = [
      entry('publisher', 'enrollment', 'enr-p'),
      entry('consumer', 'enrollment', 'enr-c', 'invalid'),
      entry('consumer', 'class-roster', 'roster-c'),
    ];
    const rawByKey = {
      'publisher/enrollment-enr-p': raw('enrollment', [{ name: 'sourcedId', required: true }]),
      'consumer/enrollment-enr-c': raw('enrollment', [{ name: 'sourcedId', required: true }]),
      'consumer/class-roster-roster-c': raw('class-roster', [{ name: 'classSourcedId', required: true }]),
    };
    const { repo, runs } = fakeRepo(entries, rawByKey);
    const summary = await performGeneration(repo, 'run-2', '2026-07-09T00:00:00Z');

    const reasons = summary.skipped.map((s) => `${s.kind}:${s.target}:${s.reason}`);
    expect(reasons.some((r) => r.startsWith('conformance:consumer/enr-c:validation: invalid'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('compat:enrollment:variant invalid'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('compat:class-roster:single-source'))).toBe(true);
    expect(runs[0].skipped.length).toBe(summary.counts.skipped);
  });
});

// ---- Adversarial stage wiring (T-46a · R-127, R-129, R-131, R-143) ---------

describe('performGeneration — adversarial review (T-46a)', () => {
  function orgCatalog() {
    const entries = [entry('publisher', 'org', 'org-p'), entry('consumer', 'org', 'org-c')];
    const rawByKey = {
      'publisher/org-p': raw('org', [
        { name: 'sourcedId', required: true },
        { name: 'name', required: true },
      ]),
      'consumer/org-c': raw('org', [{ name: 'sourcedId', required: true }]),
    };
    return fakeRepo(entries, rawByKey);
  }

  it('reviews BEFORE persisting: the stored manifest already carries the deterministic adversarial block (R-127, R-131)', async () => {
    const { repo, puts } = orgCatalog();
    await performGeneration(repo, 'run-a', '2026-10-07T00:00:00Z');
    const stored = puts[0].artifacts;
    expect(stored.manifest.adversarial).toBeDefined();
    expect(Array.isArray(stored.manifest.adversarial.findings)).toBe(true);
    // the emitted conformance test fails on zero records, so R-134h no longer appears in the committed block
    expect(stored.manifest.adversarial.findings.filter((f: { rule?: string }) => f.rule === 'R-134h')).toEqual([]);
    // the full report rides in the S3 artifact object, not in the manifest
    expect(stored.report).toMatchObject({ generator: 'testgen', verdict: expect.any(String), mutation: { tier: 'manifest' } });
    expect(stored.manifest.report).toBeUndefined();
  });

  it('never withholds §3.9 tests, whatever the findings (R-129)', async () => {
    const { repo, puts } = orgCatalog();
    const summary = await performGeneration(repo, 'run-b', '2026-10-07T00:00:00Z');
    expect(puts[0].artifacts.manifest.tests).toHaveLength(2); // publisher/org conformance + org compat
    expect(summary.counts.conformance + summary.counts.compat).toBe(2);
  });

  it('the run record and the summary carry {verdict, counts}; the summary also inlines the report (R-143)', async () => {
    const { repo, runs } = orgCatalog();
    const summary = await performGeneration(repo, 'run-c', '2026-10-07T00:00:00Z');
    expect(runs[0].adversarial).toEqual({ verdict: expect.any(String), counts: expect.objectContaining({ vacuity: expect.any(Object) }) });
    expect(summary.adversarial).toMatchObject({
      verdict: runs[0].adversarial.verdict,
      counts: runs[0].adversarial.counts,
      report: expect.any(Object),
    });
  });

  it('an unchanged catalog yields a byte-identical stamped manifest (R-88, R-131)', async () => {
    const a = orgCatalog();
    const b = orgCatalog();
    await performGeneration(a.repo, 'run-1', '2026-10-07T00:00:00Z');
    await performGeneration(b.repo, 'run-2', '2026-10-08T00:00:00Z');
    const { serializeManifest } = await import('@registry/testgen');
    expect(serializeManifest(a.puts[0].artifacts.manifest)).toBe(serializeManifest(b.puts[0].artifacts.manifest));
  });
});
