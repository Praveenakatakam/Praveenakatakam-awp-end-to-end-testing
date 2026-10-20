/**
 * Post-review fixes: adversarial-test-review runs 20261013-1055 and 20261013-1121.
 * Each describe names the finding it closes. Emitted functional tests are
 * executed for real (transpiled, `fetch` stubbed), never just string-matched.
 */
import { describe, it, expect, vi } from 'vitest';
import ts from 'typescript';
import {
  generateFunctionalPlans,
  validatePlan,
  emitFunctionalTests,
  ground,
  stampPlan,
  PLAN_SCHEMA_VERSION,
  type LlmClient,
  type PlanCache,
  type FunctionalGenInputs,
  type FunctionalTestPlan,
  type PlanBody,
  type ContractInput,
  type RequirementInput,
} from '../src/index.js';
import type { EntityApiTarget } from '@registry/core';

// ---- fixtures --------------------------------------------------------------

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
    ...props.flatMap((p) => [`      - name: ${p.name}`, `        required: ${p.required ?? false}`, ...(p.logicalType ? [`        logicalType: ${p.logicalType}`] : [])]),
  ].join('\n');
}
type Prop = { name: string; required?: boolean; logicalType?: string };
const contract = (
  source: string,
  entity: string,
  contentHash: string,
  props: Prop[] = [
    { name: 'sourcedId', required: true, logicalType: 'string' },
    { name: 'name', required: true, logicalType: 'string' },
  ]
): ContractInput => ({
  source,
  entity,
  id: `${entity}-contract`,
  contentHash,
  rawYaml: contractYaml(entity, props),
});
const req = (source: string, id: string, text: string): RequirementInput => ({ source, id, text, earsType: 'ubiquitous', section: '3.1' });

const target = (prefix: string, recordsAt: string): EntityApiTarget => ({ path: '/orgs', baseUrlEnv: `${prefix}_API_URL`, tokenEnv: `${prefix}_TOKEN`, recordsAt });
const API_MAP = { publisher: { org: target('PUBLISHER', 'items') }, consumer: { org: target('CONSUMER', 'items') } };
const TEXT = 'WHEN an org is created it SHALL be published';

function body(over: Partial<PlanBody> = {}): PlanBody {
  return {
    requirementIds: ['R-10'],
    title: 'publisher-created org appears to the consumer',
    setup: [],
    trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs', payload: { sourcedId: 'org-001', name: 'Adversarial High' } },
    propagation: { kind: 'cdc', waitFor: 'consumer reflects', timeoutSeconds: 30, pollIntervalSeconds: 2, readBack: { service: 'consumer', path: '/orgs', matchOn: 'sourcedId' } },
    assertions: [{ service: 'consumer', fieldPath: 'name', operator: 'exists', clause: 'it SHALL be published' }],
    ...over,
  };
}

function inputs(over: Partial<FunctionalGenInputs> = {}): FunctionalGenInputs {
  return {
    requirements: [req('publisher', 'R-10', TEXT)],
    contracts: [contract('publisher', 'org', 'aaa'), contract('consumer', 'org', 'bbb')],
    apiMap: API_MAP,
    modelId: 'm',
    promptVersion: 'v1',
    ...over,
  };
}

function plan(b: PlanBody = body(), apiMap = API_MAP): FunctionalTestPlan {
  const i = inputs({ apiMap });
  const g = ground(i.requirements[0], i.contracts, i.apiMap, 'm', 'v1');
  if (!g.ok) throw new Error('fixture must ground');
  return stampPlan(b, g.context);
}

const stubLlm = (b: PlanBody): LlmClient & { calls: number } => ({
  calls: 0,
  async synthesizePlan() {
    this.calls++;
    return b;
  },
});
const memCache = (seed: Record<string, FunctionalTestPlan> = {}): PlanCache & { store: Map<string, FunctionalTestPlan> } => {
  const store = new Map(Object.entries(seed));
  return { store, get: async (h) => store.get(h), set: async (h, p) => void store.set(h, p) };
};

/** Run the emitted functional file with a routed `fetch`; returns failing assertion messages. */
async function runFunctional(
  contents: string,
  env: Record<string, string>,
  http: { trigger: { ok?: boolean; json?: unknown }; readBack: unknown }
): Promise<{ passed: number; failed: string[] }> {
  const failed: string[] = [];
  let passed = 0;
  const pending: Promise<void>[] = [];
  const matchers = (actual: unknown, msg: string | undefined, negate: boolean) => {
    const check = (ok: boolean, what: string) => {
      if (ok === negate) throw new Error(`${msg ?? ''}: expected ${negate ? 'not ' : ''}${what}, got ${JSON.stringify(actual)}`);
    };
    return {
      toBe: (e: unknown) => check(Object.is(actual, e), `toBe(${JSON.stringify(e)})`),
      toEqual: (e: unknown) => check(JSON.stringify(actual) === JSON.stringify(e), `toEqual(${JSON.stringify(e)})`),
      toBeDefined: () => check(actual !== undefined, 'toBeDefined'),
      toBeNull: () => check(actual === null, 'toBeNull'),
    };
  };
  const expectFn = Object.assign((actual: unknown, msg?: string) => ({ ...matchers(actual, msg, false), not: matchers(actual, msg, true) }), {});
  const describeFn = Object.assign((_n: string, fn: () => void) => fn(), { skipIf: (skip: boolean) => (_n: string, fn: () => void) => void (skip || fn()) });
  const itFn = (_name: string, fn: () => unknown) => {
    pending.push(
      Promise.resolve()
        .then(fn)
        .then(
          () => void passed++,
          (err: Error) => void failed.push(err.message)
        )
    );
  };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  vi.stubGlobal('fetch', async (_url: string, init?: { method?: string }) => {
    const isTrigger = init?.method === 'POST';
    return { ok: isTrigger ? (http.trigger.ok ?? true) : true, status: 200, json: async () => (isTrigger ? http.trigger.json : http.readBack) };
  });
  try {
    const js = ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'exports', js)((m: string) => (m === 'vitest' ? { describe: describeFn, it: itFn, expect: expectFn } : {}), {});
    await Promise.all(pending);
  } finally {
    vi.unstubAllGlobals();
    for (const k of Object.keys(env)) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
  return { passed, failed };
}
const ENV = { PUBLISHER_API_URL: 'http://p.test', PUBLISHER_TOKEN: 't', CONSUMER_API_URL: 'http://c.test', CONSUMER_TOKEN: 't' };
const file = (p: FunctionalTestPlan) => emitFunctionalTests([p])[0].contents;
const REC = { sourcedId: 'org-001', name: 'Adversarial High' };

// ---- run 2 F-04 -------------------------------------------------------------

describe('exists means present and not null (run 2 F-04)', () => {
  it('fails when the consumer nulls a non-nullable field', async () => {
    const r = await runFunctional(file(plan()), ENV, { trigger: { json: {} }, readBack: { items: [{ ...REC, name: null }] } });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatch(/\[consumer\] name/);
  });

  it('fails when the field is absent, and passes when it is set', async () => {
    expect((await runFunctional(file(plan()), ENV, { trigger: { json: {} }, readBack: { items: [{ sourcedId: 'org-001' }] } })).failed).toHaveLength(1);
    expect((await runFunctional(file(plan()), ENV, { trigger: { json: {} }, readBack: { items: [REC] } })).failed).toEqual([]);
  });

  it('accepts null only where the contract marks the field nullable', async () => {
    const p = { ...plan(), nullable: ['consumer:name'] };
    expect((await runFunctional(file(p), ENV, { trigger: { json: {} }, readBack: { items: [{ ...REC, name: null }] } })).failed).toEqual([]);
    expect((await runFunctional(file(p), ENV, { trigger: { json: {} }, readBack: { items: [{ sourcedId: 'org-001' }] } })).failed).toHaveLength(1);
  });
});

// ---- run 1 F-03 -------------------------------------------------------------

describe('publisher assertions read the record the publisher accepted (run 1 F-03)', () => {
  const pubExists = body({ assertions: [{ service: 'publisher', fieldPath: 'name', operator: 'exists', clause: 'it SHALL be published' }] });
  const pubEquals = body({
    assertions: [{ service: 'publisher', fieldPath: 'sourcedId', operator: 'equals', expected: { from: 'trigger.payload', path: 'sourcedId' }, clause: 'it SHALL be published' }],
  });

  it('a bare acknowledgement response does not turn a correct publisher red', async () => {
    for (const json of [{}, undefined, null, 'ok', [1, 2]]) {
      const r = await runFunctional(file(plan(pubExists)), ENV, { trigger: { json }, readBack: { items: [REC] } });
      expect(r.failed, JSON.stringify(json)).toEqual([]);
    }
  });

  it('what the publisher returned overrides what was sent, so a mutated echo is caught', async () => {
    const r = await runFunctional(file(plan(pubEquals)), ENV, { trigger: { json: { sourcedId: 'someone-else' } }, readBack: { items: [REC] } });
    expect(r.failed).toHaveLength(1);
    expect((await runFunctional(file(plan(pubEquals)), ENV, { trigger: { json: { sourcedId: 'org-001' } }, readBack: { items: [REC] } })).failed).toEqual([]);
  });

  it('a server-supplied field in the response is visible to publisher assertions', async () => {
    const p = body({ assertions: [{ service: 'publisher', fieldPath: 'status', operator: 'exists', clause: 'it SHALL be published' }] });
    expect((await runFunctional(file(plan(p)), ENV, { trigger: { json: { status: 'active' } }, readBack: { items: [REC] } })).failed).toEqual([]);
    expect((await runFunctional(file(plan(p)), ENV, { trigger: { json: {} }, readBack: { items: [REC] } })).failed).toHaveLength(1);
  });
});

// ---- tRPC envelope (run 1 F-02 / run 2 F-03, functional half) ---------------

describe('the read-back unwraps a tRPC envelope when recordsAt is empty', () => {
  const trpcMap = { publisher: API_MAP.publisher, consumer: { org: target('CONSUMER', '') } };

  it('finds the record in result.data and in result.data.json', async () => {
    const f = file(plan(body(), trpcMap));
    expect((await runFunctional(f, ENV, { trigger: { json: {} }, readBack: { result: { data: [REC] } } })).failed).toEqual([]);
    expect((await runFunctional(f, ENV, { trigger: { json: {} }, readBack: { result: { data: { json: [REC] } } } })).failed).toEqual([]);
  });

  it('still reads a bare array', async () => {
    expect((await runFunctional(file(plan(body(), trpcMap)), ENV, { trigger: { json: {} }, readBack: [REC] })).failed).toEqual([]);
  });
});

// ---- run 1 F-07 -------------------------------------------------------------

describe('a stored plan carries its kind (run 1 F-07, R-122)', () => {
  it('stampPlan stamps kind "functional"', () => {
    expect(plan().kind).toBe('functional');
  });

  it('bumps the plan-schema version, because the stored plan shape changed (R-119b)', () => {
    expect(PLAN_SCHEMA_VERSION).toBe(3);
    expect(plan().planSchemaVersion).toBe(3);
  });

  it('a cache hit keeps kind and takes the current requirement id', async () => {
    const i = inputs();
    const g = ground(i.requirements[0], i.contracts, i.apiMap, 'm', 'v1');
    if (!g.ok) throw new Error('fixture must ground');
    const { plans } = await generateFunctionalPlans(i, stubLlm(body()), memCache({ [g.context.inputHash]: stampPlan(body(), g.context) }));
    expect(plans[0].kind).toBe('functional');
    expect(plans[0].requirementIds).toEqual(['publisher/R-10']);
  });
});

// ---- run 2 F-05 -------------------------------------------------------------

describe('a cache hit is re-validated (run 2 F-05)', () => {
  const key = () => {
    const i = inputs();
    const g = ground(i.requirements[0], i.contracts, i.apiMap, 'm', 'v1');
    if (!g.ok) throw new Error('fixture must ground');
    return g.context;
  };

  it('re-synthesizes when the cached plan fails today\'s cross-field rules, and overwrites the cache', async () => {
    const ctx = key();
    // Consumer assertion with the read-back on the publisher: rejected by validatePlan since T-59.
    const stale = stampPlan(body({ propagation: { ...body().propagation, readBack: { service: 'publisher', path: '/orgs', matchOn: 'sourcedId' } } }), ctx);
    const cache = memCache({ [ctx.inputHash]: stale });
    const llm = stubLlm(body());
    const { plans, skipped } = await generateFunctionalPlans(inputs(), llm, cache);
    expect(llm.calls).toBe(1);
    expect(skipped).toEqual([]);
    expect(plans[0].propagation.readBack.service).toBe('consumer');
    expect(cache.store.get(ctx.inputHash)?.propagation.readBack.service).toBe('consumer');
  });

  it('skips with the validation reason when the fresh synthesis is also invalid', async () => {
    const ctx = key();
    const bad = body({ propagation: { ...body().propagation, readBack: { service: 'publisher', path: '/orgs', matchOn: 'sourcedId' } } });
    const { plans, skipped } = await generateFunctionalPlans(inputs(), stubLlm(bad), memCache({ [ctx.inputHash]: stampPlan(bad, ctx) }));
    expect(plans).toEqual([]);
    expect(skipped[0].reason).toMatch(/consumer assertions require readBack\.service 'consumer'/);
  });

  it('still reuses a valid cached plan without calling the LLM (R-119)', async () => {
    const ctx = key();
    const llm = stubLlm(body());
    const { plans } = await generateFunctionalPlans(inputs(), llm, memCache({ [ctx.inputHash]: stampPlan(body(), ctx) }));
    expect(llm.calls).toBe(0);
    expect(plans).toHaveLength(1);
  });
});

// ---- run 1 F-04 -------------------------------------------------------------

describe('identical requirement texts keep separate grounded contexts (run 1 F-04)', () => {
  it('keys each context by its requirement as well as its input hash', async () => {
    const two = inputs({ requirements: [req('publisher', 'R-10', TEXT), req('jira', 'BAWP-1', TEXT)] });
    const { plans, contexts } = await generateFunctionalPlans(two, stubLlm(body()), memCache());
    expect(plans.map((p) => p.requirementIds[0])).toEqual(['jira/BAWP-1', 'publisher/R-10']);
    expect(contexts.get('publisher/R-10')?.requirement.id).toBe('R-10');
    expect(contexts.get('jira/BAWP-1')?.requirement.id).toBe('BAWP-1');
    // The input-hash key remains, for callers that look a plan up by hash.
    expect(contexts.get(plans[0].inputHash)).toBeDefined();
  });
});

// ---- run 1 F-08 / run 2 F-09 ------------------------------------------------

describe('functest ordering is locale-independent (run 1 F-08, run 2 F-09, R-88)', () => {
  it('orders skips by code point: uppercase source first', async () => {
    const none = inputs({ requirements: [req('b', 'R-1', 'nothing relevant'), req('B', 'R-1', 'nothing relevant')] });
    const { skipped } = await generateFunctionalPlans(none, stubLlm(body()), memCache());
    expect(skipped.map((s) => s.requirement)).toEqual(['B/R-1', 'b/R-1']);
  });

  it('orders the grounded schema by property name in code-point order', () => {
    const props = [{ name: 'b', logicalType: 'string' }, { name: 'B', logicalType: 'string' }];
    const i = inputs({ contracts: [contract('publisher', 'org', 'a', props), contract('consumer', 'org', 'b', props)] });
    const g = ground(i.requirements[0], i.contracts, i.apiMap, 'm', 'v1');
    expect(g.ok && g.context.schema.map((p) => p.name)).toEqual(['B', 'b']);
  });
});

// ---- run 2 F-01 (Critical) --------------------------------------------------

describe('equals must compare against a value that exists (run 2 F-01)', () => {
  const equalsFrom = (path: string) => ({
    service: 'consumer' as const,
    fieldPath: 'name',
    operator: 'equals' as const,
    expected: { from: 'trigger.payload' as const, path },
    clause: 'it SHALL be published',
  });
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'publisher' };

  it('validatePlan rejects an equals whose expected.path is not a trigger.payload key', () => {
    const v = validatePlan(body({ assertions: [equalsFrom('displayName')] }), grounded);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/assertion #0: expected\.path 'displayName' is not a trigger\.payload key/);
  });

  it('accepts a payload key, including a nested one', () => {
    expect(validatePlan(body({ assertions: [equalsFrom('name')] }), grounded).ok).toBe(true);
    const nested = body({ assertions: [equalsFrom('owner.id')] });
    nested.trigger.payload = { sourcedId: 'o1', name: 'N', owner: { id: 'u1' } };
    expect(validatePlan(nested, grounded).ok).toBe(true);
  });

  it('a payload key whose value is null is still a key', () => {
    const b = body({ assertions: [equalsFrom('name')] });
    b.trigger.payload = { sourcedId: 'o1', name: null };
    expect(validatePlan(b, grounded).ok).toBe(true);
  });

  it('a cached plan with such an assertion is re-synthesized, never rendered as toEqual(undefined)', async () => {
    const i = inputs();
    const g = ground(i.requirements[0], i.contracts, i.apiMap, 'm', 'v1');
    if (!g.ok) throw new Error('fixture must ground');
    const stale = stampPlan(body({ assertions: [equalsFrom('displayName')] }), g.context);
    const llm = stubLlm(body({ assertions: [equalsFrom('name')] }));
    const { plans } = await generateFunctionalPlans(i, llm, memCache({ [g.context.inputHash]: stale }));
    expect(llm.calls).toBe(1);
    expect(emitFunctionalTests(plans)[0].contents).not.toContain('toEqual(undefined)');
  });

  it('the emitter refuses to render an unresolved payload path instead of emitting toEqual(undefined)', () => {
    const p = { ...plan(), assertions: [equalsFrom('displayName')] };
    expect(() => emitFunctionalTests([p])).toThrow(/expected\.path 'displayName' is not a trigger\.payload key/);
  });
});

// ---- code review F-07 -------------------------------------------------------

describe('paths are validated and emitted as data, never as template text (code review F-07)', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'publisher' };
  const BACKSLASH = String.fromCharCode(92);
  const withPaths = (trigger: string, readBack = '/orgs') => {
    const b = body({});
    b.trigger.path = trigger;
    b.propagation.readBack.path = readBack;
    return b;
  };

  it.each([
    ['a backtick', '/o`x'],
    ['a template placeholder', '/o${process.exit(1)}'],
    ['a double quote', '/o"x'],
    ['a single quote', "/o'x"],
    ['a backslash', '/o' + BACKSLASH + 'x'],
    ['whitespace', '/o x'],
    ['no leading slash', 'orgs'],
    ['a newline', '/o\nx'],
  ])('rejects a trigger path with %s', (_what, path) => {
    const v = validatePlan(withPaths(path), grounded);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/trigger\.path [\s\S]* is not a plain URL path/);
  });

  it('rejects the same in the read-back path', () => {
    const v = validatePlan(withPaths('/orgs', '/o`x'), grounded);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/readBack\.path .* is not a plain URL path/);
  });

  it('accepts ordinary paths: segments, braces, query strings', () => {
    for (const p of ['/orgs', '/api/review/advance', '/orgs/{id}', '/api/grdy/assignments/getTasks', '/me/classes?limit=10&sort=name']) {
      expect(validatePlan(withPaths(p, p), grounded).ok, p).toBe(true);
    }
  });

  it('a plan that bypassed validation still renders a file that compiles, with the path as a string literal', () => {
    const evil = '/o${x}`y';
    const p = plan();
    const hostile = { ...p, trigger: { ...p.trigger, path: evil }, propagation: { ...p.propagation, readBack: { ...p.propagation.readBack, path: evil } } };
    const { contents } = emitFunctionalTests([hostile])[0];
    const out = ts.transpileModule(contents, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    expect(out.diagnostics ?? []).toHaveLength(0);
    expect(contents).toContain(JSON.stringify(evil));
    expect(contents).not.toContain('`${publisherBase}' + evil);
  });

  it('the emitted test still reaches the right URLs', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return { ok: true, status: 200, json: async () => (init?.method === 'POST' ? {} : { items: [REC] }) };
    });
    const saved = { ...process.env };
    Object.assign(process.env, ENV);
    try {
      new Function('require', 'exports', ts.transpileModule(file(plan()), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
        (m: string) => (m === 'vitest' ? { describe: Object.assign((_n: string, f: () => void) => f(), { skipIf: () => (_n: string, f: () => void) => f() }), it: (_n: string, f: () => Promise<void>) => f(), expect: () => ({ toBe() {}, toBeDefined() {}, toEqual() {}, not: { toBeNull() {} } }) } : {}),
        {}
      );
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      vi.unstubAllGlobals();
      Object.assign(process.env, saved);
    }
    expect(calls[0]).toBe('POST http://p.test/orgs');
    expect(calls[1]).toBe('GET http://c.test/orgs');
  });
});

// ---- test review F-01 / F-02 -------------------------------------------------

describe('bracket notation is the same path as dotted notation (test review F-01, F-02, R-133a)', () => {
  const grounded = { entity: 'org', sources: ['consumer', 'publisher'], publisher: 'publisher' };
  const withTags = (assertions: PlanBody['assertions'], matchFrom?: string) => {
    const b = body({ assertions });
    b.trigger.payload = { sourcedId: 'o1', name: 'N', tags: [{ tagId: 't1' }] };
    if (matchFrom) b.propagation.readBack = { ...b.propagation.readBack, matchFrom };
    return b;
  };
  const equalsFrom = (fieldPath: string, path: string) => ({
    service: 'consumer' as const,
    fieldPath,
    operator: 'equals' as const,
    expected: { from: 'trigger.payload' as const, path },
    clause: 'it SHALL be published',
  });

  it('validatePlan accepts items[0].x for expected.path and matchFrom, as it accepts items.0.x', () => {
    expect(validatePlan(withTags([equalsFrom('name', 'tags[0].tagId')]), grounded).ok).toBe(true);
    expect(validatePlan(withTags([equalsFrom('name', 'tags.0.tagId')]), grounded).ok).toBe(true);
    expect(validatePlan(withTags([equalsFrom('name', 'name')], 'tags[0].tagId'), grounded).ok).toBe(true);
  });

  it('still rejects a bracket path that is not in the payload', () => {
    const v = validatePlan(withTags([equalsFrom('name', 'tags[3].tagId')]), grounded);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.reason).toMatch(/expected\.path 'tags\[3\]\.tagId' is not a trigger\.payload key/);
  });

  it('the emitted at() reads a bracket fieldPath and a bracket expected.path', async () => {
    const p = plan(withTags([equalsFrom('tags[0].tagId', 'tags[0].tagId'), { service: 'consumer', fieldPath: 'tags[0].tagId', operator: 'exists', clause: 'it SHALL be published' }]));
    const rec = { sourcedId: 'o1', name: 'N', tags: [{ tagId: 't1' }] };
    expect((await runFunctional(file(p), ENV, { trigger: { json: {} }, readBack: { items: [rec] } })).failed).toEqual([]);
    const wrong = { sourcedId: 'o1', name: 'N', tags: [{ tagId: 'other' }] };
    expect((await runFunctional(file(p), ENV, { trigger: { json: {} }, readBack: { items: [wrong] } })).failed).toHaveLength(1);
  });
});
