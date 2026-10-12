/**
 * Unit tests for the experiments handler and worker (T-09 · R-20…R-34).
 *
 * Covers:
 *   - handlePostExperiment: 202 happy path, 400 unknown version, 500 dispatch failure
 *   - worker: pending→running→succeeded success path, failure with redacted error
 *   - runExperiment: S3 artifact key prefix
 *   - buildExperimentInputs: modelId + promptVersion override from PromptVersionRecord
 *
 * No live AWS — repository, llm, and functest modules are mocked via vi.mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptVersionRecord } from '@registry/core';
import type { LlmClient } from '@registry/functest';

// ---- Module mocks (Vitest hoists vi.mock() calls automatically) -----------

// Repository mock — worker uses it directly via the module binding.
vi.mock('../src/repository.js', () => ({
  repository: {
    getExperiment: vi.fn(),
    updateExperiment: vi.fn(),
    getPromptVersion: vi.fn(),
    putExperiment: vi.fn(),
    listEntries: vi.fn(),
    getRaw: vi.fn(),
    listRequirements: vi.fn(),
    putExperimentArtifact: vi.fn(),
    getCachedPlan: vi.fn(),
    putCachedPlan: vi.fn(),
    writeFunctionalJob: vi.fn(),
    putFunctionalArtifacts: vi.fn(),
  },
}));

// Bedrock client builder — prevent any real AWS calls.
vi.mock('../src/llm.js', () => ({
  createBedrockClient: vi.fn(),
  DEFAULT_BEDROCK_MODEL: 'us.anthropic.claude-sonnet-4-6',
}));

// Functest pipeline — avoid real LLM synthesis.
vi.mock('@registry/functest', () => ({
  generateFunctionalPlans: vi.fn(),
  emitFunctionalTests: vi.fn(),
}));

// Imports must come AFTER vi.mock so they resolve to the mocked versions.
import { handlePostExperiment, runExperiment, buildExperimentInputs, worker } from '../src/experiments.js';
import type { ExperimentRepo } from '../src/experiments.js';
import { repository } from '../src/repository.js';
import { createBedrockClient } from '../src/llm.js';
import { generateFunctionalPlans, emitFunctionalTests } from '@registry/functest';

// ---- Fixtures ---------------------------------------------------------------

function makePromptRecord(over: Partial<PromptVersionRecord> = {}): PromptVersionRecord {
  return {
    promptVersion: 'v1-test',
    text: 'You are a specialist in cross-service contract testing.',
    modelId: 'us.anthropic.claude-opus-4-5',
    createdAt: '2026-10-09T00:00:00Z',
    startedAt: '2026-10-09T00:00:00Z',
    createdBy: 'test-user',
    ...over,
  };
}

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

/** Minimal injectable ExperimentRepo for runExperiment / buildExperimentInputs tests. */
function fakeExperimentRepo(over: Partial<ExperimentRepo> = {}): ExperimentRepo {
  return {
    listEntries: vi.fn().mockResolvedValue([
      {
        source: 'publisher',
        id: 'org-contract',
        entity: 'org',
        currentVersion: 1,
        currentHash: 'hash-abc',
        validation: 'valid',
        commitSha: 'sha1',
        filePath: 'contracts/org.yaml',
        lastCrawledAt: '2026-10-09T00:00:00Z',
      },
    ]),
    getRaw: vi.fn().mockResolvedValue(contractYaml('org')),
    listRequirements: vi.fn().mockResolvedValue([]),
    writeFunctionalJob: vi.fn().mockResolvedValue(undefined),
    putFunctionalArtifacts: vi.fn().mockResolvedValue('functional-tests/j/artifacts.json'),
    getCachedPlan: vi.fn().mockResolvedValue(undefined),
    putCachedPlan: vi.fn().mockResolvedValue(undefined),
    getPromptVersion: vi.fn().mockResolvedValue(undefined),
    putExperiment: vi.fn().mockResolvedValue(undefined),
    updateExperiment: vi.fn().mockResolvedValue(undefined),
    getExperiment: vi.fn().mockResolvedValue(undefined),
    putExperimentArtifact: vi.fn().mockResolvedValue('experiments/test-exp/artifacts.json'),
    ...over,
  };
}

/** Stub LlmClient that returns a well-formed plan and never hits AWS. */
const stubLlm: LlmClient = {
  async synthesizePlan() {
    return {
      requirementIds: ['R-10'],
      title: 'org propagates to consumer',
      setup: [{ description: 'a writer token' }],
      trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payloadShape: '{ sourcedId }' },
      propagation: { kind: 'cdc', waitFor: 'consumer read model updates' },
      assertions: [{ service: 'consumer', assertion: 'GET /orgs includes the new org' }],
    };
  },
};

/** Shared experiment record used by worker tests. */
const expRecord = {
  experimentId: 'exp-w1',
  kind: 'EXPERIMENT' as const,
  status: 'pending' as const,
  promptVersion: 'v1-test',
  createdAt: '2026-10-09T00:00:00Z',
  startedAt: '2026-10-09T00:00:00Z',
  createdBy: 'alice',
};

// Reset all mocks between tests.
beforeEach(() => {
  vi.clearAllMocks();
});

// ---- handlePostExperiment (cases 1–3) --------------------------------------

describe('handlePostExperiment (POST /experiments)', () => {
  it('returns 202 with experimentId and statusUrl, writes pending record, and dispatches worker (R-21)', async () => {
    // GIVEN
    const repo = fakeExperimentRepo({
      getPromptVersion: vi.fn().mockResolvedValue(makePromptRecord()),
    });
    const dispatch = vi.fn().mockResolvedValue(undefined);

    // WHEN
    const res = await handlePostExperiment(
      repo,
      dispatch,
      'exp-abc',
      'v1-test',
      'alice',
      '2026-10-09T00:00:00Z'
    );

    // THEN — 202 with expected body shape
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ experimentId: 'exp-abc', statusUrl: '/experiments/exp-abc' });

    // EXP#{} record written as pending before dispatch
    expect(vi.mocked(repo.putExperiment)).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'exp-abc', status: 'pending', promptVersion: 'v1-test' })
    );

    // Worker dispatched with the experiment id
    expect(dispatch).toHaveBeenCalledWith('exp-abc');
  });

  it('returns 400 and does NOT write a DDB record when promptVersion is unknown (R-21)', async () => {
    // GIVEN — getPromptVersion returns undefined (version does not exist)
    const repo = fakeExperimentRepo({
      getPromptVersion: vi.fn().mockResolvedValue(undefined),
    });
    const dispatch = vi.fn();

    // WHEN
    const res = await handlePostExperiment(
      repo,
      dispatch,
      'exp-xyz',
      'no-such-version',
      'alice',
      '2026-10-09T00:00:00Z'
    );

    // THEN
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('no-such-version');
    expect(vi.mocked(repo.putExperiment)).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns 500 and does NOT call updateExperiment when worker dispatch throws (R-33)', async () => {
    // GIVEN — prompt exists, putExperiment succeeds, dispatch throws
    const repo = fakeExperimentRepo({
      getPromptVersion: vi.fn().mockResolvedValue(makePromptRecord()),
    });
    const dispatch = vi.fn().mockRejectedValue(new Error('Lambda invocation failed'));

    // WHEN
    const res = await handlePostExperiment(
      repo,
      dispatch,
      'exp-500',
      'v1-test',
      'alice',
      '2026-10-09T00:00:00Z'
    );

    // THEN — record was written but left in pending; no status transition attempted
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('dispatch');
    expect(vi.mocked(repo.putExperiment)).toHaveBeenCalledOnce(); // record was written
    expect(vi.mocked(repo.updateExperiment)).not.toHaveBeenCalled(); // stays pending
  });
});

// ---- worker (cases 4–5) ----------------------------------------------------

describe('worker (async Lambda entry)', () => {
  beforeEach(() => {
    // Default happy-path wiring for worker tests.
    vi.mocked(repository.getExperiment).mockResolvedValue(expRecord);
    vi.mocked(repository.updateExperiment).mockResolvedValue(undefined);
    vi.mocked(repository.getPromptVersion).mockResolvedValue(makePromptRecord());
    vi.mocked(repository.listEntries).mockResolvedValue([]);
    vi.mocked(repository.listRequirements).mockResolvedValue([]);
    vi.mocked(repository.getCachedPlan).mockResolvedValue(undefined);
    vi.mocked(repository.putCachedPlan).mockResolvedValue(undefined);
    vi.mocked(repository.putExperimentArtifact).mockResolvedValue('experiments/exp-w1/artifacts.json');
    vi.mocked(generateFunctionalPlans).mockResolvedValue({ plans: [{}], skipped: [] } as any);
    vi.mocked(emitFunctionalTests).mockReturnValue([{ path: 'functional/org.generated.test.ts', content: '// test' }] as any);
    vi.mocked(createBedrockClient).mockReturnValue(stubLlm);
  });

  it('transitions pending → running → completed and persists counts (R-24)', async () => {
    // WHEN
    await worker({ experimentId: 'exp-w1' });

    // THEN — first update sets running, last sets completed with counts
    const calls = vi.mocked(repository.updateExperiment).mock.calls;
    expect(calls[0]).toEqual(['exp-w1', { status: 'running' }]);
    const lastUpdate = calls.at(-1)?.[1];
    expect(lastUpdate).toMatchObject({ status: 'succeeded', planCount: 1, skipCount: 0 });
  });

  it('transitions to failed with a redacted error when Bedrock throws, without throwing (R-33, NFR-4)', async () => {
    // GIVEN — generateFunctionalPlans rejects with a credential-shaped error
    vi.mocked(generateFunctionalPlans).mockRejectedValue(
      new Error('throttled (token ghp_deadbeef00DEADBEEF00deadbeef00DEADBEEF present)')
    );

    // WHEN — worker must NEVER throw; the test itself must not reject
    await expect(worker({ experimentId: 'exp-w1' })).resolves.toBeUndefined();

    // THEN — final status is failed with a redacted message; the raw token is scrubbed
    const calls = vi.mocked(repository.updateExperiment).mock.calls;
    const lastUpdate = calls.at(-1)?.[1];
    expect(lastUpdate).toMatchObject({ status: 'failed' });
    expect(lastUpdate?.error).toContain('[redacted]');
    expect(lastUpdate?.error).not.toContain('ghp_');
  });
});

// ---- runExperiment — S3 artifact key (case 6) ------------------------------

describe('runExperiment (S3 artifact key prefix)', () => {
  it('calls putExperimentArtifact with the experimentId and the returned key starts with experiments/ (R-22)', async () => {
    // GIVEN
    vi.mocked(createBedrockClient).mockReturnValue(stubLlm);
    vi.mocked(generateFunctionalPlans).mockResolvedValue({ plans: [], skipped: [] } as any);
    vi.mocked(emitFunctionalTests).mockReturnValue([] as any);

    const putExperimentArtifact = vi.fn().mockResolvedValue('experiments/run-42/artifacts.json');
    const repo = fakeExperimentRepo({ putExperimentArtifact });

    // WHEN
    const result = await runExperiment('run-42', makePromptRecord(), repo);

    // THEN — putExperimentArtifact called with the experiment id and some artifact payload
    expect(putExperimentArtifact).toHaveBeenCalledWith('run-42', expect.any(Object));

    // The artifact key returned by the repo is passed through and starts with experiments/
    expect(result.artifactKey).toMatch(/^experiments\//);
  });
});

// ---- buildExperimentInputs — prompt record overrides (case 7) --------------

describe('buildExperimentInputs (PromptVersionRecord overrides)', () => {
  it('returns modelId and promptVersion from the PromptVersionRecord, not hardcoded constants (R-20, R-22)', async () => {
    // GIVEN — custom values distinct from any hardcoded defaults
    const customModel = 'us.anthropic.claude-haiku-4-9';
    const customVersion = 'v2-experimental';
    const promptRecord = makePromptRecord({ modelId: customModel, promptVersion: customVersion });
    const repo = fakeExperimentRepo();

    // WHEN
    const inputs = await buildExperimentInputs(repo, promptRecord);

    // THEN — the prompt record's values appear in the assembled inputs
    expect(inputs.modelId).toBe(customModel);
    expect(inputs.promptVersion).toBe(customVersion);
  });

  it('passes rawPromptText (promptRecord.text) to createBedrockClient in runExperiment (R-20)', async () => {
    // GIVEN — a distinctive prompt text we can assert was forwarded
    const customText = 'Only write assertions that can be verified end-to-end.';
    const promptRecord = makePromptRecord({ text: customText });

    vi.mocked(createBedrockClient).mockReturnValue(stubLlm);
    vi.mocked(generateFunctionalPlans).mockResolvedValue({ plans: [], skipped: [] } as any);
    vi.mocked(emitFunctionalTests).mockReturnValue([] as any);

    const repo = fakeExperimentRepo();

    // WHEN
    await runExperiment('run-text', promptRecord, repo);

    // THEN — createBedrockClient was called with the prompt record's text as the fourth argument
    expect(vi.mocked(createBedrockClient)).toHaveBeenCalledWith(
      promptRecord.modelId,
      expect.anything(),
      promptRecord.promptVersion,
      customText
    );
  });
});
