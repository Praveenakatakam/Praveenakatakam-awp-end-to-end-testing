import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  generateFunctionalPlans,
  emitFunctionalTests,
  buildFunctionalArtifacts,
  serializeFunctionalManifest,
  validatePlanV1,
  ground,
  PLAN_SCHEMA_V1,
  type LlmClient,
  type PlanCache,
  type FunctionalGenInputs,
  type FunctionalTestPlan,
  type PlanBody,
  type ContractInput,
  type RequirementInput,
  type GroundedContext,
} from '../src/index.js';
import type { EntityApiTarget } from '@registry/core';

// ---- Fixtures --------------------------------------------------------------

function contractYaml(entity: string, props: { name: string; required?: boolean; logicalType?: string }[]) {
  return [
    'version: 1.0.0',
    'apiVersion: v3.1.0',
    'kind: DataContract',
    `id: ${entity}-contract`,
    `name: ${entity}`,
    'schema:',
    `  - name: ${entity}`,
    '    properties:',
    ...props.flatMap((p) => [
      `      - name: ${p.name}`,
      `        required: ${p.required ?? false}`,
      ...(p.logicalType ? [`        logicalType: ${p.logicalType}`] : []),
    ]),
  ].join('\n');
}

function contract(source: string, entity: string, contentHash: string): ContractInput {
  return {
    source,
    entity,
    id: `${entity}-contract`,
    contentHash,
    rawYaml: contractYaml(entity, [
      { name: 'sourcedId', required: true, logicalType: 'string' },
      { name: 'name', required: true, logicalType: 'string' },
    ]),
  };
}

function req(source: string, id: string, text: string, section = '3.1'): RequirementInput {
  return { source, id, text, earsType: 'ubiquitous', section };
}

const API_MAP = {
  publisher: {
    org: { path: '/orgs', baseUrlEnv: 'PUBLISHER_API_URL', tokenEnv: 'PUBLISHER_TOKEN', recordsAt: 'items' } as EntityApiTarget,
  },
  consumer: {
    org: { path: '/orgs', baseUrlEnv: 'CONSUMER_API_URL', tokenEnv: 'CONSUMER_TOKEN', recordsAt: 'items' } as EntityApiTarget,
  },
};

/** A well-formed plan body the stub LLM returns for the `org` entity. */
function orgPlanBody(): PlanBody {
  return {
    requirementIds: ['R-10'],
    title: 'publisher-created org appears to the consumer',
    setup: [{ description: 'a writer access token for the publisher' }],
    trigger: {
      source: 'publisher',
      entity: 'org',
      method: 'POST',
      path: '/orgs',
      payloadShape: '{ sourcedId: string, name: string }',
    },
    propagation: { kind: 'cdc', waitFor: "the consumer's read model to reflect the new org (≤ 30s)" },
    assertions: [{ service: 'consumer', assertion: 'GET /orgs includes the new org by sourcedId' }],
  };
}

/** LLM stub: returns the given body (or a builder) for every call; counts calls. */
function stubLlm(body: PlanBody | ((c: GroundedContext) => unknown)): LlmClient & { calls: number } {
  return {
    calls: 0,
    async synthesizePlan(context) {
      this.calls++;
      return typeof body === 'function' ? body(context) : body;
    },
  };
}

/** In-memory PlanCache. */
function memCache(seed: Record<string, FunctionalTestPlan> = {}): PlanCache & { store: Map<string, FunctionalTestPlan> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(h) {
      return store.get(h);
    },
    async set(h, p) {
      store.set(h, p);
    },
  };
}

function inputs(over: Partial<FunctionalGenInputs> = {}): FunctionalGenInputs {
  return {
    requirements: [req('publisher', 'R-10', 'WHEN an org is created it SHALL be published')],
    contracts: [contract('publisher', 'org', 'aaa'), contract('consumer', 'org', 'bbb')],
    apiMap: API_MAP,
    modelId: 'claude-opus-4-8',
    promptVersion: 'v1',
    ...over,
  };
}

// ---- Grounding & skips (R-121) --------------------------------------------

describe('ground / skip rules', () => {
  it('grounds a cross-service, mapped entity', () => {
    const g = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v1');
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.context.entity).toBe('org');
      expect(g.context.sources).toEqual(['consumer', 'publisher']);
      expect(g.context.apiTargets.map((t) => t.source).sort()).toEqual(['consumer', 'publisher']);
      expect(g.context.inputHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('skips a requirement that names no cataloged entity', () => {
    const g = ground(req('publisher', 'R-99', 'data at rest SHALL be encrypted'), inputs().contracts, API_MAP, 'm', 'v1');
    expect(g).toEqual({ ok: false, reason: 'references no cataloged entity' });
  });

  it('skips a single-service entity', () => {
    const g = ground(req('consumer', 'R-5', 'the class roster SHALL load'), [contract('consumer', 'class', 'ccc')], API_MAP, 'm', 'v1');
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/single-service entity 'class'/);
  });

  it('skips an entity with no API mapping', () => {
    const g = ground(
      req('publisher', 'R-7', 'each user SHALL have a stable identifier'),
      [contract('publisher', 'user', 'u1'), contract('consumer', 'user', 'u2')],
      API_MAP,
      'm',
      'v1'
    );
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/no API mapping for entity 'user'/);
  });

  it('input hash changes when the contract content hash changes (R-119)', () => {
    const a = ground(
      inputs().requirements[0],
      [contract('publisher', 'org', 'aaa'), contract('consumer', 'org', 'bbb')],
      API_MAP,
      'm',
      'v1'
    );
    const b = ground(
      inputs().requirements[0],
      [contract('publisher', 'org', 'ZZZ'), contract('consumer', 'org', 'bbb')],
      API_MAP,
      'm',
      'v1'
    );
    expect(a.ok && b.ok && a.context.inputHash !== b.context.inputHash).toBe(true);
  });

  it('input hash changes when the model id or prompt version changes (R-119)', () => {
    const base = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm1', 'v1');
    const model = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm2', 'v1');
    const prompt = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm1', 'v2');
    expect(base.ok && model.ok && base.context.inputHash !== model.context.inputHash).toBe(true);
    expect(base.ok && prompt.ok && base.context.inputHash !== prompt.context.inputHash).toBe(true);
  });
});

// ---- Plan validation (R-117, R-120) ---------------------------------------

describe('validatePlanV1', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'] };

  it('accepts a well-formed grounded plan', () => {
    const v = validatePlanV1(orgPlanBody(), grounded);
    expect(v.ok).toBe(true);
  });

  it('rejects a malformed plan (missing required field)', () => {
    const bad = { ...orgPlanBody(), trigger: undefined };
    const v = validatePlanV1(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/malformed plan/);
  });

  it('rejects a hallucinated trigger entity', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, entity: 'widget' } };
    const v = validatePlanV1(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/hallucinated target: trigger entity 'widget'/);
  });

  it('rejects a hallucinated trigger source', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, source: 'attacker' } };
    const v = validatePlanV1(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/hallucinated target: trigger source 'attacker'/);
  });

  it('rejects an unknown enum value for trigger method', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, method: 'GET' } };
    expect(validatePlanV1(bad, grounded).ok).toBe(false);
  });

  it('PLAN_SCHEMA_V1 forbids extra properties', () => {
    const bad = { ...orgPlanBody(), surprise: 1 };
    expect(validatePlanV1(bad, grounded).ok).toBe(false);
  });
});

// ---- Orchestration (R-117…R-120, R-119 cache) -----------------------------

describe('generateFunctionalPlans', () => {
  it('synthesizes, validates, caches, and returns a plan', async () => {
    const llm = stubLlm(orgPlanBody());
    const cache = memCache();
    const { plans, skipped } = await generateFunctionalPlans(inputs(), llm, cache);
    expect(plans).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    expect(llm.calls).toBe(1);
    expect(plans[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
    // The plan was written to the cache under its input hash.
    expect(cache.store.get(plans[0].inputHash)).toEqual(plans[0]);
  });

  it('reuses a cached plan without calling the LLM (R-119, D-52 lockfile)', async () => {
    // First run populates the cache.
    const cache = memCache();
    const first = await generateFunctionalPlans(inputs(), stubLlm(orgPlanBody()), cache);
    // Second run with a fresh LLM stub that would THROW if called.
    const llm2: LlmClient = {
      async synthesizePlan() {
        throw new Error('LLM must not be called on a cache hit');
      },
    };
    const second = await generateFunctionalPlans(inputs(), llm2, cache);
    expect(second.plans).toEqual(first.plans);
  });

  it('legacy path is pinned to PLAN_SCHEMA_V1: a v2-only plan from the LLM is skipped as malformed', async () => {
    const v2 = { ...orgPlanBody(), rationale: 'why' };
    const { plans, skipped } = await generateFunctionalPlans(inputs(), stubLlm(v2 as PlanBody), memCache());
    expect(plans).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/malformed plan/);
  });

  it('legacy path rejects v2-widened values (eventbridge propagation, non publisher/consumer service)', async () => {
    const eb = { ...orgPlanBody(), propagation: { kind: 'eventbridge', waitFor: 'x' } };
    expect((await generateFunctionalPlans(inputs(), stubLlm(eb as PlanBody), memCache())).plans).toHaveLength(0);
    expect(validatePlanV1({ ...orgPlanBody(), assertions: [{ service: 'other', assertion: 'x' }] }, { entity: 'org', sources: ['publisher', 'consumer'] }).ok).toBe(false);
  });

  it('a cache hit that is not a valid v1 plan (v2 plan cached under v0.4.0) is re-synthesized with v1', async () => {
    const cache = memCache();
    const first = await generateFunctionalPlans(inputs(), stubLlm(orgPlanBody()), cache);
    const hash = first.plans[0].inputHash;
    cache.store.set(hash, { ...first.plans[0], rationale: 'v2-era plan' });

    const llm = stubLlm(orgPlanBody());
    const second = await generateFunctionalPlans(inputs(), llm, cache);

    expect(llm.calls).toBe(1);
    expect(second.plans).toEqual(first.plans);
    expect(cache.store.get(hash)).toEqual(first.plans[0]);
  });

  it('PLAN_SCHEMA_V1 is the exact original v1 contract', () => {
    expect(PLAN_SCHEMA_V1.required).toEqual(['requirementIds', 'title', 'setup', 'trigger', 'propagation', 'assertions']);
    expect(PLAN_SCHEMA_V1.properties.propagation.properties.kind).toEqual({ type: 'string', enum: ['cdc'] });
    expect(PLAN_SCHEMA_V1.properties.assertions.items.properties.service).toEqual({
      type: 'string',
      enum: ['publisher', 'consumer'],
    });
    expect(Object.keys(PLAN_SCHEMA_V1.properties.trigger.properties)).not.toContain('examplePayload');
  });

  it('skips (not fails) when the LLM throws — fault isolation (NFR-4, R-120)', async () => {
    const llm: LlmClient = {
      async synthesizePlan() {
        throw new Error('boom');
      },
    };
    const { plans, skipped } = await generateFunctionalPlans(inputs(), llm, memCache());
    expect(plans).toHaveLength(0);
    expect(skipped).toEqual([{ requirement: 'publisher/R-10', reason: 'LLM synthesis failed: boom' }]);
  });

  it('skips (not fails) a malformed plan and continues to the next requirement', async () => {
    const twoReqs = inputs({
      requirements: [
        req('publisher', 'R-10', 'WHEN an org is created it SHALL be published'),
        req('publisher', 'R-11', 'WHEN an org is created it SHALL be logged'),
      ],
    });
    // First call returns junk; second returns a valid plan.
    let n = 0;
    const llm: LlmClient = {
      async synthesizePlan() {
        return n++ === 0 ? { not: 'a plan' } : orgPlanBody();
      },
    };
    const { plans, skipped } = await generateFunctionalPlans(twoReqs, llm, memCache());
    expect(plans).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/malformed plan/);
  });

  it('records reasoned skips for ungroundable requirements', async () => {
    const withInfra = inputs({
      requirements: [
        req('publisher', 'R-10', 'WHEN an org is created it SHALL be published'),
        req('publisher', 'R-99', 'data at rest SHALL be encrypted'),
      ],
    });
    const { plans, skipped } = await generateFunctionalPlans(withInfra, stubLlm(orgPlanBody()), memCache());
    expect(plans).toHaveLength(1);
    expect(skipped).toEqual([{ requirement: 'publisher/R-99', reason: 'references no cataloged entity' }]);
  });
});

// ---- Emit (R-122, R-123, R-119a determinism) ------------------------------

describe('emitFunctionalTests', () => {
  const plan: FunctionalTestPlan = { ...orgPlanBody(), inputHash: 'f'.repeat(64) };

  it('emits one file per plan under functional/', () => {
    const files = emitFunctionalTests([plan]);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('functional/r-10-org.generated.test.ts');
  });

  it('is deterministic — same plan renders byte-identically (R-119a)', () => {
    const a = emitFunctionalTests([plan]);
    const b = emitFunctionalTests([plan]);
    expect(a).toEqual(b);
  });

  it('emitted file is valid TypeScript', () => {
    const { contents } = emitFunctionalTests([plan])[0];
    const diags = ts.transpileModule(contents, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    }).diagnostics;
    expect(diags ?? []).toHaveLength(0);
  });

  it('guards on cross-service credentials and grounds the trigger (R-123)', () => {
    const { contents } = emitFunctionalTests([plan])[0];
    expect(contents).toContain('describe.skipIf(!ready)');
    expect(contents).toContain('POST');
    expect(contents).toContain('/orgs');
    expect(contents).toContain('it.todo');
    expect(contents).toContain('GENERATED — DO NOT EDIT');
  });
});

// ---- Manifest / artifacts --------------------------------------------------

describe('manifest + artifacts', () => {
  it('serializes a stable manifest and builds the artifact set', () => {
    const manifest = {
      manifestVersion: 1 as const,
      generator: '@registry/functest',
      modelId: 'claude-opus-4-8',
      promptVersion: 'v1',
      plans: [{ ...orgPlanBody(), inputHash: 'f'.repeat(64) }],
      skipped: [{ requirement: 'publisher/R-99', reason: 'references no cataloged entity' }],
    };
    const s1 = serializeFunctionalManifest(manifest);
    const s2 = serializeFunctionalManifest(manifest);
    expect(s1).toBe(s2);
    expect(s1.endsWith('\n')).toBe(true);
    const artifacts = buildFunctionalArtifacts(manifest);
    expect(artifacts.files).toHaveLength(1);
    expect(artifacts.manifest).toBe(manifest);
  });
});

// ---- PLAN_SCHEMA_V1 is structured-output-safe --------------------------------

describe('PLAN_SCHEMA_V1', () => {
  it('is a closed object schema (additionalProperties:false) at the top level', () => {
    expect(PLAN_SCHEMA_V1.type).toBe('object');
    expect(PLAN_SCHEMA_V1.additionalProperties).toBe(false);
    expect(PLAN_SCHEMA_V1.required).toContain('trigger');
  });
});
