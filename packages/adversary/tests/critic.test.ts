/**
 * T-44a — the report-only critic: blind → reconcile isolation (R-137), posture
 * lint applied (R-140), failure isolation (R-141), cache (R-142), independence
 * (R-139). The Bedrock client is never loaded; a recording stub stands in.
 */
import { describe, it, expect } from 'vitest';
import {
  runCritic,
  criticCacheKey,
  criticIndependence,
  CRITIC_PROMPT_VERSION,
  type CriticCache,
  type CriticClient,
  type CriticPlanResult,
  type DraftFinding,
  type FunctionalUnderReview,
} from '../src/index.js';
import { loadFunctionalSeed } from './calibration.js';

function seed(path = 'functional/S09-semantic-swap'): FunctionalUnderReview {
  const s = loadFunctionalSeed(path);
  return { plan: s.plan, context: s.context, file: s.file };
}

const DETERMINISTIC: DraftFinding[] = [
  {
    attack: 'grounding',
    severity: 'Major',
    rule: 'R-133e',
    target: { kind: 'functional', ref: 'create/CRE-R-24' },
    defect: 'trigger path is in no API mapping',
    failureScenario: 'the write endpoint may not exist',
    evidence: '/api/review/advance',
  },
];

const SWAP_FINDING = {
  severity: 'Critical',
  defect: 'The consumer description is asserted equal to the payload tenantId.',
  failureScenario: 'A correct get-ready stores the task description, so the test fails on a working system.',
  evidence: 'assertion #4',
};

interface Recording extends CriticClient {
  blindInputs: unknown[];
  reconcileInputs: unknown[];
}

function stubClient(over: Partial<CriticClient> = {}, findings: unknown = { findings: [SWAP_FINDING] }): Recording {
  const rec: Recording = {
    modelId: 'us.anthropic.claude-opus-4-8',
    promptVersion: CRITIC_PROMPT_VERSION,
    blindInputs: [],
    reconcileInputs: [],
    async blind(input) {
      rec.blindInputs.push(input);
      return { behaviours: [{ clause: 'SHALL make the published Task available', observable: 'task listed', service: 'consumer' }] };
    },
    async reconcile(input) {
      rec.reconcileInputs.push(input);
      return findings;
    },
    ...over,
  };
  return rec;
}

function memCache(): CriticCache & { store: Map<string, CriticPlanResult>; sets: number } {
  const store = new Map<string, CriticPlanResult>();
  const c = {
    store,
    sets: 0,
    async get(k: string) {
      return store.get(k);
    },
    async set(k: string, v: CriticPlanResult) {
      c.sets++;
      store.set(k, v);
    },
  };
  return c;
}

describe('runCritic — blind → reconcile (R-137)', () => {
  it('Pass 1 sees only the requirement + grounded context — never the plan, file or findings', async () => {
    const u = seed();
    const client = stubClient();
    await runCritic(u, DETERMINISTIC, client, memCache());
    expect(client.blindInputs).toHaveLength(1);
    const blind = JSON.stringify(client.blindInputs[0]);
    expect(blind).toContain(u.context.requirement.text);
    expect(blind).toContain('totalItemCount'); // the consumer schema is grounded context
    expect(blind).not.toContain(u.plan.title);
    expect(blind).not.toContain('pollUntil'); // nothing from the emitted file
    expect(blind).not.toContain('R-133e'); // nothing from the deterministic findings
    expect(blind).not.toContain(u.plan.inputHash);
    expect(Object.keys(client.blindInputs[0] as object).sort()).toEqual([
      'apiTargets',
      'entity',
      'requirement',
      'schemasBySource',
      'sources',
    ]);
  });

  it('Pass 2 gets the Pass 1 output + plan + file + deterministic findings', async () => {
    const u = seed();
    const client = stubClient();
    await runCritic(u, DETERMINISTIC, client, memCache());
    const input = client.reconcileInputs[0] as { blind: unknown; plan: unknown; file: unknown; deterministic: unknown };
    expect(input.blind).toEqual({ behaviours: [expect.objectContaining({ observable: 'task listed' })] });
    expect(input.plan).toBe(u.plan);
    expect(input.file).toBe(u.file);
    expect(input.deterministic).toEqual(DETERMINISTIC);
  });

  it('returns posture-linted critic findings targeting the plan', async () => {
    const praise = { severity: 'Minor', defect: 'Nicely structured test, looks good.', failureScenario: 'n/a' };
    const r = await runCritic(seed(), DETERMINISTIC, stubClient({}, { findings: [SWAP_FINDING, praise] }), memCache());
    expect(r.status).toBe('ok');
    expect(r.droppedByPostureLint).toBe(1);
    expect(r.findings).toEqual([
      expect.objectContaining({ attack: 'critic', severity: 'Critical', target: expect.objectContaining({ ref: 'create/CRE-R-24' }) }),
    ]);
  });
});

describe('runCritic — failure isolation (R-141, E-56)', () => {
  it('a throwing critic → failed, with a reason, never thrown', async () => {
    const r = await runCritic(
      seed(),
      DETERMINISTIC,
      stubClient({
        reconcile: async () => {
          throw new Error('ThrottlingException: slow down');
        },
      }),
      memCache()
    );
    expect(r).toMatchObject({ status: 'failed', findings: [] });
    expect(r.reason).toMatch(/ThrottlingException/);
  });

  it('Bedrock AccessDenied / model not enabled → unavailable', async () => {
    const denied = Object.assign(new Error('You don’t have access to the model with the specified model ID.'), {
      name: 'AccessDeniedException',
    });
    const r = await runCritic(
      seed(),
      DETERMINISTIC,
      stubClient({
        blind: async () => {
          throw denied;
        },
      }),
      memCache()
    );
    expect(r.status).toBe('unavailable');
  });

  it('malformed reconcile output → failed (not a crash, not silently ok)', async () => {
    const r = await runCritic(seed(), DETERMINISTIC, stubClient({}, 'I think the test is fine'), memCache());
    expect(r.status).toBe('failed');
    expect(r.malformed).toBe(1);
  });
});

describe('runCritic — cache (R-142)', () => {
  it('a cache hit does not call the client; changing any key component does', async () => {
    const u = seed();
    const cache = memCache();
    await runCritic(u, DETERMINISTIC, stubClient(), cache);
    const again = stubClient();
    const hit = await runCritic(u, DETERMINISTIC, again, cache);
    expect(again.blindInputs).toHaveLength(0);
    expect(hit.findings).toHaveLength(1);

    const newFindings = stubClient();
    await runCritic(u, [], newFindings, cache);
    expect(newFindings.blindInputs).toHaveLength(1);

    const newModel = stubClient({ modelId: 'another-model' });
    await runCritic(u, DETERMINISTIC, newModel, cache);
    expect(newModel.blindInputs).toHaveLength(1);
  });

  it('failed / unavailable results are not cached', async () => {
    const cache = memCache();
    await runCritic(
      seed(),
      DETERMINISTIC,
      stubClient({
        reconcile: async () => {
          throw new Error('boom');
        },
      }),
      cache
    );
    expect(cache.sets).toBe(0);
  });

  it('the key covers plan hash, file, findings, model and prompt version', () => {
    const base = { planInputHash: 'a', fileContents: 'f', deterministic: DETERMINISTIC, modelId: 'm', promptVersion: 'v1' };
    const k = criticCacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    for (const change of [
      { planInputHash: 'b' },
      { fileContents: 'g' },
      { deterministic: [] },
      { modelId: 'n' },
      { promptVersion: 'v2' },
    ]) {
      expect(criticCacheKey({ ...base, ...change })).not.toBe(k);
    }
    expect(criticCacheKey({ ...base })).toBe(k);
  });
});

describe('criticIndependence (R-139, E-57)', () => {
  it('degraded when the critic model equals the synthesiser model', () => {
    expect(criticIndependence('us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-sonnet-4-6')).toBe('degraded');
    expect(criticIndependence('us.anthropic.claude-opus-4-8', 'us.anthropic.claude-sonnet-4-6')).toBe('ok');
  });
});
