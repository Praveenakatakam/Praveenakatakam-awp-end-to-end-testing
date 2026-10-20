import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { triggerFunctionalGeneration, pollFunctionalJob, writeFunctionalArtifactTree } from '../generate-tests.js';
import type { FunctionalArtifactSet } from '@registry/functest';

// ---- Fixtures --------------------------------------------------------------

function artifactSet(): FunctionalArtifactSet {
  return {
    manifest: {
      manifestVersion: 1,
      generator: '@registry/functest',
      modelId: 'claude-opus-4-8',
      promptVersion: 'v2',
      plans: [
        {
          kind: 'functional',
          requirementIds: ['R-10'],
          title: 'org propagates',
          setup: [{ description: 'writer token' }],
          trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'org-001' } },
          propagation: {
            kind: 'cdc',
            waitFor: 'consumer reflects',
            timeoutSeconds: 30,
            pollIntervalSeconds: 2,
            readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' },
          },
          assertions: [{ service: 'consumer', fieldPath: 'sourcedId', operator: 'exists', clause: 'SHALL be published' }],
          inputHash: 'a'.repeat(64),
          planSchemaVersion: 2,
          targets: [
            {
              role: 'consumer',
              source: 'consumer',
              baseUrlEnv: 'CONSUMER_API_URL',
              tokenEnv: 'CONSUMER_TOKEN',
              recordsAt: 'items',
              mapped: true,
            },
            {
              role: 'publisher',
              source: 'publisher',
              baseUrlEnv: 'PUBLISHER_API_URL',
              tokenEnv: 'PUBLISHER_TOKEN',
              recordsAt: 'items',
              mapped: true,
            },
          ],
        },
      ],
      skipped: [{ requirement: 'publisher/R-99', reason: 'references no cataloged entity' }],
    },
    files: [{ path: 'functional/r-10-org.generated.test.ts', contents: '// test\n' }],
  };
}

/** A fetch stub driven by a scripted queue of responses per URL substring. */
function scriptedFetch(steps: { match: string; status: number; json?: any }[]): typeof fetch {
  let i = 0;
  return (async (url: string) => {
    const step = steps[i++];
    if (!step || !String(url).includes(step.match)) {
      throw new Error(`unexpected fetch #${i} to ${url} (wanted ${step?.match})`);
    }
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      async json() {
        return step.json;
      },
    } as any;
  }) as any;
}

const noSleep = async () => {};

// ---- triggerFunctionalGeneration (R-115) -----------------------------------

describe('triggerFunctionalGeneration', () => {
  it('returns the jobId on a 202', async () => {
    const f = scriptedFetch([{ match: '/generate-functional-tests', status: 202, json: { jobId: 'fj-1', status: 'pending' } }]);
    expect(await triggerFunctionalGeneration(f, 'https://api', 'tok')).toEqual({ jobId: 'fj-1', status: 'pending' });
  });

  it('throws when the status is not 202', async () => {
    const f = scriptedFetch([{ match: '/generate-functional-tests', status: 403 }]);
    await expect(triggerFunctionalGeneration(f, 'https://api', 'tok')).rejects.toThrow(/403/);
  });
});

// ---- pollFunctionalJob (R-125) ---------------------------------------------

describe('pollFunctionalJob', () => {
  it('polls until succeeded and returns job + artifacts', async () => {
    const arts = artifactSet();
    const f = scriptedFetch([
      { match: '/functional-test-jobs/fj-1', status: 200, json: { job: { status: 'running' } } },
      { match: '/functional-test-jobs/fj-1', status: 200, json: { job: { status: 'succeeded', planCount: 1 }, artifacts: arts } },
    ]);
    const { job, artifacts } = await pollFunctionalJob(f, 'https://api', 'tok', 'fj-1', { sleep: noSleep, onProgress: () => {} });
    expect(job.status).toBe('succeeded');
    expect(artifacts.files[0].path).toBe('functional/r-10-org.generated.test.ts');
  });

  it('throws with the recorded reason when the job fails', async () => {
    const f = scriptedFetch([
      {
        match: '/functional-test-jobs/fj-1',
        status: 200,
        json: { job: { status: 'failed', error: 'AccessDeniedException: bedrock:InvokeModel on model us.anthropic.claude-opus-4-8' } },
      },
    ]);
    await expect(pollFunctionalJob(f, 'https://api', 'tok', 'fj-1', { sleep: noSleep, onProgress: () => {} })).rejects.toThrow(
      /AccessDeniedException: bedrock:InvokeModel/
    );
  });

  it('gives up after the attempt budget instead of hanging', async () => {
    const f = scriptedFetch([
      { match: '/functional-test-jobs/fj-1', status: 200, json: { job: { status: 'running' } } },
      { match: '/functional-test-jobs/fj-1', status: 200, json: { job: { status: 'running' } } },
    ]);
    await expect(pollFunctionalJob(f, 'https://api', 'tok', 'fj-1', { attempts: 2, sleep: noSleep, onProgress: () => {} })).rejects.toThrow(
      /did not finish within 2 poll/
    );
  });
});

// ---- failure leaves the committed tree untouched (E-47) --------------------

describe('functional failure leaves the committed tree untouched (E-47)', () => {
  it('does not touch generated-tests/functional when the job fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'functest-e47-'));
    try {
      // A previously-committed functional tree the operator already has in git.
      mkdirSync(join(dir, 'functional'), { recursive: true });
      writeFileSync(join(dir, 'functional', 'manifest.json'), '{"committed":true}');
      writeFileSync(join(dir, 'functional', 'old.generated.test.ts'), '// committed\n');

      // The CLI writes the tree ONLY after a successful poll; a failed job throws
      // out of pollFunctionalJob before writeFunctionalArtifactTree is ever reached.
      const f = scriptedFetch([
        { match: '/functional-test-jobs/fj-1', status: 200, json: { job: { status: 'failed', error: 'AccessDeniedException' } } },
      ]);
      await expect(pollFunctionalJob(f, 'https://api', 'tok', 'fj-1', { sleep: noSleep, onProgress: () => {} })).rejects.toThrow(/failed/);

      // Tree is byte-for-byte intact — nothing was replaced or wiped.
      expect(readFileSync(join(dir, 'functional', 'manifest.json'), 'utf8')).toBe('{"committed":true}');
      expect(existsSync(join(dir, 'functional', 'old.generated.test.ts'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- writeFunctionalArtifactTree (R-123) -----------------------------------

describe('writeFunctionalArtifactTree', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'functest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the functional subtree + manifest and returns sorted paths', () => {
    const written = writeFunctionalArtifactTree(dir, artifactSet());
    expect(written).toEqual(['functional/manifest.json', 'functional/r-10-org.generated.test.ts']);
    expect(existsSync(join(dir, 'functional', 'manifest.json'))).toBe(true);
    expect(readFileSync(join(dir, 'functional', 'r-10-org.generated.test.ts'), 'utf8')).toBe('// test\n');
    const manifest = JSON.parse(readFileSync(join(dir, 'functional', 'manifest.json'), 'utf8'));
    expect(manifest.plans).toHaveLength(1);
  });

  it('replaces the subtree wholesale — stale files disappear (R-123)', () => {
    writeFunctionalArtifactTree(dir, {
      ...artifactSet(),
      files: [{ path: 'functional/stale.generated.test.ts', contents: '// old\n' }],
    });
    expect(existsSync(join(dir, 'functional', 'stale.generated.test.ts'))).toBe(true);
    writeFunctionalArtifactTree(dir, artifactSet());
    expect(existsSync(join(dir, 'functional', 'stale.generated.test.ts'))).toBe(false);
    expect(existsSync(join(dir, 'functional', 'r-10-org.generated.test.ts'))).toBe(true);
  });
});
