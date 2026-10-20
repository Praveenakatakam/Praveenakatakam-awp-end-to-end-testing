import { describe, it, expect } from 'vitest';
import {
  handleGenerateFunctional,
  runFunctionalJob,
  buildFunctionalInputs,
  repoPlanCache,
  MODEL_ID,
  PROMPT_VERSION,
  type FunctionalGenRepo,
} from '../src/functional-gen.js';
import type { CatalogEntry, RequirementRecord, FunctionalJobRecord } from '../src/repository.js';
import type { LlmClient } from '@registry/functest';

// ---- Fakes -----------------------------------------------------------------

function contractYaml(entity: string) {
  return [
    'version: 1.0.0',
    'apiVersion: v3.1.0',
    'kind: DataContract',
    `id: ${entity}-contract`,
    `name: ${entity}`,
    'schema:',
    `  - name: ${entity}`,
    '    properties:',
    '      - name: sourcedId',
    '        required: true',
    '        logicalType: string',
  ].join('\n');
}

function entry(source: string, entity: string): CatalogEntry {
  return {
    source,
    id: `${entity}-contract`,
    entity,
    currentVersion: 1,
    currentHash: `${source}-hash`,
    validation: 'valid',
    commitSha: 'sha',
    filePath: 'contracts/x.yaml',
    lastCrawledAt: '2026-07-16T00:00:00Z',
  };
}

function requirement(source: string, id: string, text: string): RequirementRecord {
  return {
    source,
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

/** In-memory FunctionalGenRepo capturing writes. */
function fakeRepo(over: Partial<FunctionalGenRepo> = {}) {
  const jobs: FunctionalJobRecord[] = [];
  const artifacts: Record<string, unknown> = {};
  const planStore = new Map<string, unknown>();
  const repo: FunctionalGenRepo & { jobs: FunctionalJobRecord[]; artifacts: Record<string, unknown>; planStore: Map<string, unknown> } = {
    jobs,
    artifacts,
    planStore,
    async listEntries() {
      return [entry('publisher', 'org'), entry('consumer', 'org')];
    },
    async getRaw(_s, _id) {
      return contractYaml('org');
    },
    async listRequirements() {
      return [requirement('publisher', 'R-10', 'WHEN an org is created it SHALL be published to consumers')];
    },
    async writeFunctionalJob(job) {
      jobs.push(job);
    },
    async putFunctionalArtifacts(jobId, a) {
      artifacts[jobId] = a;
      return `functional-tests/${jobId}/artifacts.json`;
    },
    async getCachedPlan(h) {
      return planStore.get(h);
    },
    async putCachedPlan(h, p) {
      planStore.set(h, p);
    },
    ...over,
  };
  return repo;
}

function orgPlan() {
  return {
    requirementIds: ['R-10'],
    title: 'publisher-created org appears to the consumer',
    setup: [{ description: 'a writer token' }],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'org-001' } },
    propagation: {
      kind: 'cdc',
      waitFor: 'consumer read model updates',
      timeoutSeconds: 30,
      pollIntervalSeconds: 2,
      readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' },
    },
    assertions: [{ service: 'consumer', fieldPath: 'sourcedId', operator: 'exists', clause: 'SHALL be published' }],
  };
}

const stubLlm: LlmClient = {
  async synthesizePlan() {
    return orgPlan();
  },
};
const clock = { now: () => '2026-07-16T12:00:00Z' };

// ---- POST handler (R-115) --------------------------------------------------

describe('handleGenerateFunctional (POST /generate-functional-tests)', () => {
  it('creates a pending job, dispatches the worker, returns 202 (R-115)', async () => {
    const repo = fakeRepo();
    const dispatched: string[] = [];
    const res = await handleGenerateFunctional(repo, async (id) => void dispatched.push(id), 'fj-1', '2026-07-16T00:00:00Z');
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ jobId: 'fj-1', status: 'pending', statusUrl: '/functional-test-jobs/fj-1' });
    expect(repo.jobs[0]).toMatchObject({ jobId: 'fj-1', status: 'pending', modelId: MODEL_ID, promptVersion: PROMPT_VERSION });
    expect(dispatched).toEqual(['fj-1']);
  });
});

// ---- Worker (R-116, R-124) -------------------------------------------------

describe('runFunctionalJob (worker)', () => {
  it('marks running then succeeded, storing artifacts + counts (R-124)', async () => {
    const repo = fakeRepo();
    const result = await runFunctionalJob('fj-1', repo, stubLlm, clock);
    expect(result.status).toBe('succeeded');
    expect(result.planCount).toBe(1);
    expect(result.skipCount).toBe(0);
    expect(result.artifactKey).toBe('functional-tests/fj-1/artifacts.json');
    // Lifecycle: first write running, last write succeeded.
    expect(repo.jobs[0].status).toBe('running');
    expect(repo.jobs.at(-1)?.status).toBe('succeeded');
    // Artifacts contain the manifest + emitted file.
    const arts = repo.artifacts['fj-1'] as any;
    expect(arts.manifest.plans).toHaveLength(1);
    expect(arts.files[0].path).toMatch(/^functional\/.*\.generated\.test\.ts$/);
    // Catalog context is persisted ON the job record, not just in the manifest (R-124).
    expect(result.catalogContext).toEqual({
      contractCount: 2,
      requirementCount: 1,
      contracts: [
        { source: 'publisher', id: 'org-contract', entity: 'org', contentHash: 'publisher-hash' },
        { source: 'consumer', id: 'org-contract', entity: 'org', contentHash: 'consumer-hash' },
      ],
      requirements: [{ source: 'publisher', id: 'R-10' }],
    });
    expect(result.skips).toEqual([]);
  });

  it('persists per-skip reasons on the job record (R-124)', async () => {
    const repo = fakeRepo({
      // A requirement that references no cataloged entity → skipped with a reason.
      async listRequirements() {
        return [requirement('publisher', 'R-99', 'The system SHALL retain audit logs for 90 days')];
      },
    });
    const result = await runFunctionalJob('fj-skip', repo, stubLlm, clock);
    expect(result.status).toBe('succeeded');
    expect(result.skipCount).toBe(1);
    expect(result.skips).toHaveLength(1);
    expect(result.skips?.[0]).toMatchObject({ requirement: 'publisher/R-99' });
    expect(result.skips?.[0].reason).toBeTruthy();
  });

  it('populates the plan cache so a re-run reuses the plan (R-119, D-52)', async () => {
    const repo = fakeRepo();
    await runFunctionalJob('fj-1', repo, stubLlm, clock);
    expect(repo.planStore.size).toBe(1);
    // Second run with an LLM that would throw if called — must hit the cache.
    const throwingLlm: LlmClient = {
      async synthesizePlan() {
        throw new Error('must not call');
      },
    };
    const second = await runFunctionalJob('fj-2', repo, throwingLlm, clock);
    expect(second.status).toBe('succeeded');
    expect(second.planCount).toBe(1);
  });

  it('records a failed job with a redacted reason when the whole job throws (R-124, NFR-2/NFR-4)', async () => {
    const repo = fakeRepo({
      // Simulate a failure whose message carries a credential-shaped substring.
      async listEntries() {
        throw new Error('catalog unavailable (creds ghp_deadbeef00DEADBEEF00deadbeef00DEADBEEF present)');
      },
    });
    const result = await runFunctionalJob('fj-x', repo, stubLlm, clock);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('catalog unavailable');
    // The token-shaped substring must be scrubbed from the persisted reason (NFR-2).
    expect(result.error).not.toContain('ghp_');
    expect(result.error).toContain('[redacted]');
    expect(repo.jobs.at(-1)?.status).toBe('failed');
    expect(repo.jobs.at(-1)?.error).not.toContain('ghp_');
  });

  it('succeeds with zero plans when the catalog is empty (R-116)', async () => {
    const repo = fakeRepo({
      async listEntries() {
        return [];
      },
      async listRequirements() {
        return [];
      },
    });
    const result = await runFunctionalJob('fj-empty', repo, stubLlm, clock);
    expect(result.status).toBe('succeeded');
    expect(result.planCount).toBe(0);
  });
});

// ---- Input assembly --------------------------------------------------------

describe('buildFunctionalInputs / repoPlanCache', () => {
  it('assembles contracts + requirements + api-map from the catalog', async () => {
    const inputs = await buildFunctionalInputs(fakeRepo());
    expect(inputs.contracts.map((c) => `${c.source}/${c.entity}`).sort()).toEqual(['consumer/org', 'publisher/org']);
    expect(inputs.requirements[0].id).toBe('R-10');
    expect(inputs.modelId).toBe(MODEL_ID);
    expect(inputs.apiMap.publisher).toBeDefined();
  });

  it("repoPlanCache round-trips through the repo's plan store", async () => {
    const repo = fakeRepo();
    const cache = repoPlanCache(repo);
    expect(await cache.get('h1')).toBeUndefined();
    await cache.set('h1', { inputHash: 'h1', title: 't' } as any);
    expect((await cache.get('h1')) as any).toMatchObject({ inputHash: 'h1' });
  });
});
