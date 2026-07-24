import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { performGeneration, type GenRepo } from '../src/generate.js';
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
