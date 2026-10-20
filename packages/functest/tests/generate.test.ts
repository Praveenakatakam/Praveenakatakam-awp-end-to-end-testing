import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  generateFunctionalPlans,
  emitFunctionalTests,
  buildFunctionalArtifacts,
  serializeFunctionalManifest,
  validatePlan,
  ground,
  stampPlan,
  PLAN_SCHEMA_VERSION,
  PLAN_SCHEMA,
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

/** A well-formed v2 plan body the stub LLM returns for the `org` entity (R-117b). */
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
      payload: { sourcedId: 'org-001', name: 'Adversarial High' },
    },
    propagation: {
      kind: 'cdc',
      waitFor: "the consumer's read model to reflect the new org",
      timeoutSeconds: 30,
      pollIntervalSeconds: 2,
      readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' },
    },
    assertions: [
      {
        service: 'consumer',
        fieldPath: 'name',
        operator: 'equals',
        expected: { from: 'trigger.payload', path: 'name' },
        clause: 'it SHALL be published',
      },
      {
        service: 'consumer',
        fieldPath: 'sourcedId',
        operator: 'matchesType',
        expected: { from: 'literal', value: 'string' },
        clause: 'it SHALL be published',
      },
    ],
  };
}

/** Stamp a body into a stored plan exactly as the core does (inputHash + targets). */
function stamped(body: PlanBody = orgPlanBody()): FunctionalTestPlan {
  const g = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v2');
  if (!g.ok) throw new Error('fixture must ground');
  return stampPlan(body, { ...g.context, inputHash: 'f'.repeat(64) });
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
    promptVersion: 'v2',
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

describe('validatePlan', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'] };

  it('accepts a well-formed grounded plan', () => {
    const v = validatePlan(orgPlanBody(), grounded);
    expect(v.ok).toBe(true);
  });

  it('rejects a malformed plan (missing required field)', () => {
    const bad = { ...orgPlanBody(), trigger: undefined };
    const v = validatePlan(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/malformed plan/);
  });

  it('rejects a hallucinated trigger entity', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, entity: 'widget' } };
    const v = validatePlan(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/hallucinated target: trigger entity 'widget'/);
  });

  it('rejects a hallucinated trigger source', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, source: 'attacker' } };
    const v = validatePlan(bad, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/hallucinated target: trigger source 'attacker'/);
  });

  it('rejects an unknown enum value for trigger method', () => {
    const bad = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, method: 'GET' } };
    expect(validatePlan(bad, grounded).ok).toBe(false);
  });

  it('PLAN_SCHEMA forbids extra properties', () => {
    const bad = { ...orgPlanBody(), surprise: 1 };
    expect(validatePlan(bad, grounded).ok).toBe(false);
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
  const plan: FunctionalTestPlan = stamped();

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
    expect(contents).not.toContain('it.todo');
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
      promptVersion: 'v2',
      plans: [stamped()],
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

// ---- PLAN_SCHEMA is structured-output-safe --------------------------------

describe('PLAN_SCHEMA', () => {
  it('is a closed object schema (additionalProperties:false) at the top level', () => {
    expect(PLAN_SCHEMA.type).toBe('object');
    expect(PLAN_SCHEMA.additionalProperties).toBe(false);
    expect(PLAN_SCHEMA.required).toContain('trigger');
  });
});

// ---- v2 structured plans (T-40a · R-117b, R-119b, D-74) --------------------

describe('v2 structured plans (R-117b)', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'] };

  it('rejects a v1-shaped plan (prose payloadShape, string assertions) as malformed', () => {
    const v1 = {
      ...orgPlanBody(),
      trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payloadShape: '{ sourcedId }' },
      assertions: [{ service: 'consumer', assertion: 'GET /orgs includes it' }],
    };
    const v = validatePlan(v1, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/malformed plan/);
  });

  it('rejects an equals / matchesType assertion with no expected value', () => {
    const body = orgPlanBody();
    const { expected: _drop, ...noExpected } = body.assertions[0];
    const v = validatePlan({ ...body, assertions: [noExpected] }, grounded);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/requires 'expected'/);
  });

  it('accepts an exists assertion without expected', () => {
    const exists = { service: 'consumer', fieldPath: 'name', operator: 'exists', clause: 'it SHALL be published' };
    expect(validatePlan({ ...orgPlanBody(), assertions: [exists] }, grounded).ok).toBe(true);
  });

  it('rejects a propagation step with no read-back', () => {
    const body = orgPlanBody();
    const { readBack: _drop, ...noReadBack } = body.propagation;
    expect(validatePlan({ ...body, propagation: noReadBack }, grounded).ok).toBe(false);
  });

  it('stamps per-role env targets from the API mapping onto the plan', () => {
    const plan = stamped();
    expect(plan.targets).toEqual([
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
    ]);
    expect(plan.planSchemaVersion).toBe(PLAN_SCHEMA_VERSION);
  });

  it('emits a request WITH a JSON body, a bounded read-back poll, and one expect per assertion', () => {
    const { contents } = emitFunctionalTests([stamped()])[0];
    expect(contents).toContain('body: JSON.stringify(payload)');
    expect(contents).toContain('"sourcedId": "org-001"');
    expect(contents).not.toMatch(/\/\/\s*body:/);
    expect(contents).toMatch(/pollUntil\(/);
    expect(contents).toContain('timeoutSeconds: 30');
    expect(contents.match(/\/\/ assertion #\d+/g) ?? []).toHaveLength(2);
    expect(contents).toContain('it SHALL be published');
  });

  it("reads base-URL/token env names from each service's API mapping, not fixed names", () => {
    const contracts = [contract('create', 'TaskPublished', 'c1'), contract('get-ready', 'TaskPublished', 'g1')];
    const apiMap = {
      'get-ready': {
        TaskPublished: {
          path: '/api/grdy/assignments/getTasks',
          baseUrlEnv: 'GET_READY_API_URL',
          tokenEnv: 'GET_READY_TOKEN',
          recordsAt: '',
        } as EntityApiTarget,
      },
    };
    const r = req('create', 'CRE-R-24', 'WHEN approved the TaskPublished event SHALL be published');
    const g = ground(r, contracts, apiMap, 'm', 'v2');
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const body: PlanBody = {
      ...orgPlanBody(),
      requirementIds: ['CRE-R-24'],
      trigger: { source: 'create', entity: 'TaskPublished', method: 'POST', path: '/api/review/advance', payload: { sourcedId: 't-1', name: 'T' } },
      propagation: {
        ...orgPlanBody().propagation,
        readBack: { service: 'consumer', path: '/api/grdy/assignments/getTasks', matchOn: 'sourcedId' },
      },
    };
    const plan = stampPlan(body, g.context);
    const { contents } = emitFunctionalTests([plan])[0];
    expect(contents).toContain('process.env.GET_READY_API_URL');
    expect(contents).toContain('process.env.GET_READY_TOKEN');
    expect(contents).not.toContain('CONSUMER_API_URL');
    // The unmapped trigger source gets a conventional env name and is marked unmapped (OQ-15).
    expect(plan.targets.find((t) => t.role === 'publisher')).toMatchObject({
      source: 'create',
      baseUrlEnv: 'CREATE_API_URL',
      tokenEnv: 'CREATE_TOKEN',
      mapped: false,
    });
  });

  it('correlates the read-back on a renamed field via matchFrom (publisher taskId → consumer id)', () => {
    const body = orgPlanBody();
    body.propagation.readBack = { service: 'consumer', path: '/orgs', matchOn: 'id', matchFrom: 'taskId' };
    body.trigger.payload = { taskId: 't-1', name: 'x' };
    expect(validatePlan(body, grounded).ok).toBe(true);
    const { contents } = emitFunctionalTests([stamped(body)])[0];
    expect(contents).toContain('matchOn: "id"');
    expect(contents).toContain('value: at(payload, "taskId")');
  });

  it('emitted v2 file is valid TypeScript and renders byte-identically (R-119a)', () => {
    const a = emitFunctionalTests([stamped()]);
    const b = emitFunctionalTests([stamped()]);
    expect(a).toEqual(b);
    const diags = ts.transpileModule(a[0].contents, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    }).diagnostics;
    expect(diags ?? []).toHaveLength(0);
  });

  it('exposes per-source schemas in the grounded context (for R-133a)', () => {
    const g = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v2');
    expect(g.ok && Object.keys(g.context.schemasBySource).sort()).toEqual(['consumer', 'publisher']);
  });

  it('returns the grounded contexts keyed by input hash', async () => {
    const { plans, contexts } = await generateFunctionalPlans(inputs(), stubLlm(orgPlanBody()), memCache());
    expect(contexts.get(plans[0].inputHash)?.entity).toBe('org');
  });
});

describe('plan-schema version in the cache key (R-119b)', () => {
  it('input hash changes when the plan-schema version changes', () => {
    const v1 = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v2', 1);
    const v2 = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v2', 2);
    expect(v1.ok && v2.ok && v1.context.inputHash !== v2.context.inputHash).toBe(true);
  });

  it('a plan cached under an older schema version is never reused', async () => {
    const old = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'claude-opus-4-8', 'v2', 1);
    if (!old.ok) throw new Error('fixture must ground');
    const cache = memCache({ [old.context.inputHash]: { stale: true } as unknown as FunctionalTestPlan });
    const llm = stubLlm(orgPlanBody());
    const { plans } = await generateFunctionalPlans(inputs(), llm, cache);
    expect(llm.calls).toBe(1);
    expect((plans[0] as unknown as { stale?: boolean }).stale).toBeUndefined();
  });
});

// ---- v0.8.0: declared roles, field map, canonical ids (T-54a · R-117c, R-117d, R-119c) ----

describe('declared roles in grounding (AC-117c, R-117c, R-119c, D-84)', () => {
  const tpContracts = () => [contract('create', 'TaskPublished', 'c1'), contract('get-ready', 'TaskPublished', 'g1')];
  const tpMap = {
    'get-ready': {
      TaskPublished: { path: '/api/grdy/assignments/getTasks', baseUrlEnv: 'GET_READY_API_URL', tokenEnv: 'GET_READY_TOKEN', recordsAt: '' } as EntityApiTarget,
    },
  };
  const tpReq = req('awp-app-plane', 'CRE-R-24', 'WHEN approved the TaskPublished event SHALL be published');
  const flows = (fields?: Record<string, string>) => ({ TaskPublished: { publisher: 'create', consumer: 'get-ready', ...(fields ? { fields } : {}) } });
  const groundTp = (f: ReturnType<typeof flows> | Record<string, never>, contracts = tpContracts()) =>
    ground(tpReq, contracts, tpMap, 'm', 'v3', PLAN_SCHEMA_VERSION, f);

  it('carries the roles and field map, and the canonical schema is the PUBLISHER variant', () => {
    const contracts = [
      { ...contract('create', 'TaskPublished', 'c1'), rawYaml: contractYaml('TaskPublished', [{ name: 'taskId', required: true, logicalType: 'string' }]) },
      { ...contract('get-ready', 'TaskPublished', 'g1'), rawYaml: contractYaml('TaskPublished', [{ name: 'id', required: true, logicalType: 'string' }]) },
    ];
    const g = groundTp(flows({ taskId: 'id' }), contracts);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.context.roles).toEqual({ publisher: 'create', consumer: 'get-ready' });
    expect(g.context.fieldMap).toEqual({ taskId: 'id' });
    expect(g.context.schema.map((p) => p.name)).toEqual(['taskId']);
  });

  it('the canonical schema follows a declared publisher that sorts LAST', () => {
    const contracts = [
      { ...contract('alpha', 'TaskPublished', 'a1'), rawYaml: contractYaml('TaskPublished', [{ name: 'consumerOnly', required: true }]) },
      { ...contract('zulu', 'TaskPublished', 'z1'), rawYaml: contractYaml('TaskPublished', [{ name: 'publisherOnly', required: true }]) },
    ];
    const map = { alpha: { TaskPublished: tpMap['get-ready'].TaskPublished } };
    const g = ground(tpReq, contracts, map, 'm', 'v3', PLAN_SCHEMA_VERSION, { TaskPublished: { publisher: 'zulu', consumer: 'alpha' } });
    expect(g.ok && g.context.schema.map((p) => p.name)).toEqual(['publisherOnly']);
  });

  it('changing the declared roles or field map changes the input hash', () => {
    const base = groundTp(flows());
    const mapped = groundTp(flows({ taskId: 'id' }));
    const inverted = ground(tpReq, tpContracts(), tpMap, 'm', 'v3', PLAN_SCHEMA_VERSION, { TaskPublished: { publisher: 'get-ready', consumer: 'create' } });
    expect(base.ok && mapped.ok && base.context.inputHash !== mapped.context.inputHash).toBe(true);
    expect(base.ok && inverted.ok && base.context.inputHash !== inverted.context.inputHash).toBe(true);
  });

  it('skips an entity with no resolvable roles (R-121, E-59)', () => {
    expect(groundTp({})).toEqual({ ok: false, reason: "no declared publisher/consumer roles for entity 'TaskPublished'" });
  });

  it('literal publisher/consumer labels still ground with no declaration (D-60)', () => {
    const g = ground(inputs().requirements[0], inputs().contracts, API_MAP, 'm', 'v3', PLAN_SCHEMA_VERSION, {});
    expect(g.ok && g.context.roles).toEqual({ publisher: 'publisher', consumer: 'consumer' });
  });

  it('validatePlan rejects a plan triggered on the declared consumer (E-62)', () => {
    const v = validatePlan(orgPlanBody(), { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'consumer' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/role inversion/);
  });

  it('generateFunctionalPlans skips a role-inverted plan with that reason', async () => {
    const inverted = { ...orgPlanBody(), trigger: { ...orgPlanBody().trigger, source: 'consumer' } };
    const { plans, skipped } = await generateFunctionalPlans(inputs(), stubLlm(inverted), memCache());
    expect(plans).toEqual([]);
    expect(skipped[0]).toMatchObject({ requirement: 'publisher/R-10' });
    expect(skipped[0].reason).toMatch(/role inversion/);
  });

  it('stampPlan takes the consumer from the declared roles even when a third source sorts first', () => {
    const contracts = [contract('aaa-audit', 'TaskPublished', 'x1'), ...tpContracts()];
    const g = ground(tpReq, contracts, tpMap, 'm', 'v3', PLAN_SCHEMA_VERSION, flows());
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const body: PlanBody = {
      ...orgPlanBody(),
      trigger: { source: 'create', entity: 'TaskPublished', method: 'POST', path: '/api/review/advance', payload: { sourcedId: 't-1' } },
      propagation: { ...orgPlanBody().propagation, readBack: { service: 'consumer', path: '/api/grdy/assignments/getTasks', matchOn: 'sourcedId' } },
    };
    expect(stampPlan(body, g.context).targets.find((t) => t.role === 'consumer')?.source).toBe('get-ready');
  });
});

describe('canonical requirement identity (AC-117d, R-117d, D-87)', () => {
  it('stamps requirementIds as {source}/{id}, replacing the LLM value; the file name keeps the bare id', async () => {
    const r = req('awp-app-plane', 'CRE-R-24', 'WHEN an org is created it SHALL be published');
    const body = { ...orgPlanBody(), requirementIds: ['CRE-R-24'] };
    const { plans } = await generateFunctionalPlans(inputs({ requirements: [r] }), stubLlm(body), memCache());
    expect(plans[0].requirementIds).toEqual(['awp-app-plane/CRE-R-24']);
    expect(emitFunctionalTests(plans)[0].path).toBe('functional/cre-r-24-org.generated.test.ts');
  });

  it('an LLM that names the wrong requirement cannot mislabel the plan', async () => {
    const body = { ...orgPlanBody(), requirementIds: ['XCT-R-99', 'R-10'] };
    const { plans } = await generateFunctionalPlans(inputs(), stubLlm(body), memCache());
    expect(plans[0].requirementIds).toEqual(['publisher/R-10']);
  });
});

// ---- T-58a: a stray `expected` on an `exists` assertion is dropped, not fatal (live T-49 finding) ----

describe('exists assertions ignore a stray expected (T-58a · R-117b, R-120)', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'publisher' };
  const strayExists = { service: 'consumer', fieldPath: 'name', operator: 'exists', expected: { from: 'literal' }, clause: 'it SHALL be published' };

  it('accepts an exists assertion carrying {from: "literal"} with no value, and strips expected from the body', () => {
    const v = validatePlan({ ...orgPlanBody(), assertions: [...orgPlanBody().assertions, strayExists] }, grounded);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const last = v.body.assertions[v.body.assertions.length - 1];
      expect(last).toEqual({ service: 'consumer', fieldPath: 'name', operator: 'exists', clause: 'it SHALL be published' });
    }
  });

  it('still rejects equals / matchesType with a literal that has no value', () => {
    for (const operator of ['equals', 'matchesType']) {
      const bad = { ...strayExists, operator };
      const v = validatePlan({ ...orgPlanBody(), assertions: [bad] }, grounded);
      expect(v.ok, operator).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/expected.from 'literal' requires 'value'/);
    }
  });

  it('the live failure shape now yields a plan instead of a skip', async () => {
    // Raw LLM output, deliberately not a valid PlanBody (stray `expected` on `exists`).
    const body = { ...orgPlanBody(), assertions: [...orgPlanBody().assertions, strayExists] } as unknown as PlanBody;
    const { plans, skipped } = await generateFunctionalPlans(inputs(), stubLlm(body), memCache());
    expect(skipped).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0].assertions.every((a) => a.operator !== 'exists' || a.expected === undefined)).toBe(true);
  });
});

// ---- T-59a: live-review fixes F-01…F-05, F-08 -------------------------------

describe('plan validation + emitter fixes (T-59a)', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'publisher' };
  const reason = (body: unknown) => {
    const v = validatePlan(body, grounded);
    return v.ok ? 'ok' : v.reason;
  };

  it('F-01: consumer assertions require the read-back on the consumer', () => {
    const body = orgPlanBody();
    body.propagation.readBack = { ...body.propagation.readBack, service: 'publisher' };
    expect(reason(body)).toMatch(/consumer assertions require readBack\.service 'consumer'/);
  });

  it('F-03: the read-back correlation value must come from a payload key', () => {
    const body = orgPlanBody();
    body.propagation.readBack = { service: 'consumer', path: '/orgs', matchOn: 'id', matchFrom: 'id' };
    expect(reason(body)).toMatch(/readBack\.matchFrom 'id' is not a trigger\.payload key/);
    body.propagation.readBack = { service: 'consumer', path: '/orgs', matchOn: 'nope' };
    expect(reason(body)).toMatch(/readBack\.matchFrom 'nope' is not a trigger\.payload key/);
  });

  it('F-05: matchesType must take a literal logicalType', () => {
    const body = orgPlanBody();
    body.assertions[1] = { ...body.assertions[1], expected: { from: 'trigger.payload', path: 'sourcedId' } };
    expect(reason(body)).toMatch(/operator 'matchesType' requires expected\.from 'literal'/);
  });

  it('F-08: poll interval and timeout are bounded', () => {
    for (const [poll, timeout] of [[0, 30], [-1, 30], [2, 0], [40, 30]]) {
      const body = orgPlanBody();
      body.propagation = { ...body.propagation, pollIntervalSeconds: poll, timeoutSeconds: timeout };
      expect(reason(body), `${poll}/${timeout}`).toMatch(/pollIntervalSeconds|timeoutSeconds/);
    }
    expect(reason(orgPlanBody())).toBe('ok');
  });

  it('F-04: a cache hit is re-stamped with the CURRENT requirement id (identical texts do not collide)', async () => {
    const text = 'WHEN an org is created it SHALL be published';
    const two = inputs({ requirements: [req('publisher', 'R-10', text), req('publisher', 'R-12', text)] });
    const { plans } = await generateFunctionalPlans(two, stubLlm(orgPlanBody()), memCache());
    expect(plans.map((p) => p.requirementIds[0])).toEqual(['publisher/R-10', 'publisher/R-12']);
    expect(new Set(emitFunctionalTests(plans).map((f) => f.path)).size).toBe(2);
  });

  it('F-02: emitted type checks accept integers for number and null only where the contract marks the field nullable', () => {
    const nullableYaml = contractYaml('org', [
      { name: 'sourcedId', required: true, logicalType: 'string' },
      { name: 'name', required: true, logicalType: 'string' },
    ]).replace('      - name: name\n', '      - name: name\n        customProperties:\n          - property: nullable\n            value: "true"\n');
    const ctx = inputs({ contracts: [contract('publisher', 'org', 'aaa'), { ...contract('consumer', 'org', 'bbb'), rawYaml: nullableYaml }] });
    const g = ground(ctx.requirements[0], ctx.contracts, API_MAP, 'm', 'v3');
    if (!g.ok) throw new Error('fixture must ground');
    const body = orgPlanBody();
    body.assertions = [
      { service: 'consumer', fieldPath: 'name', operator: 'matchesType', expected: { from: 'literal', value: 'string' }, clause: 'it SHALL be published' },
      { service: 'consumer', fieldPath: 'sourcedId', operator: 'matchesType', expected: { from: 'literal', value: 'string' }, clause: 'it SHALL be published' },
    ];
    const plan = stampPlan(body, g.context);
    expect(plan.nullable).toEqual(['consumer:name']);
    const { contents } = emitFunctionalTests([plan])[0];
    // Run the emitted helpers for real.
    const src = contents.slice(contents.indexOf('function logicalTypeOf'), contents.indexOf('/** Poll'));
    const typeMatches = new Function(`${ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return typeMatches;`)();
    expect(typeMatches(5, 'number', false)).toBe(true);
    expect(typeMatches(5.5, 'integer', false)).toBe(false);
    expect(typeMatches(null, 'string', true)).toBe(true);
    expect(typeMatches(null, 'string', false)).toBe(false);
    expect(typeMatches([], 'array', false)).toBe(true);
    expect(contents).toContain('typeMatches(at(readBackRecord, "name"), "string", true)');
    expect(contents).toContain('typeMatches(at(readBackRecord, "sourcedId"), "string", false)');
  });
});
