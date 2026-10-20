/**
 * Post-review fixes: adversarial-test-review runs 20261013-1055 and 20261013-1121.
 * Each describe names the finding it closes. Emitted files are executed for real
 * (transpiled, `fetch` stubbed, real Ajv), never just string-matched.
 */
import { describe, it, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { generateArtifacts } from '../src/generate.js';
import { checkCompat } from '../src/compat.js';
import { deriveJsonSchema } from '../src/derive-schema.js';
import type { CatalogContract, CompatTest } from '../src/manifest.js';

const nodeRequire = createRequire(import.meta.url);

// ---- helpers ---------------------------------------------------------------

/** A catalog contract from raw ODCS properties. */
function raw(source: string, entity: string, properties: unknown[]): CatalogContract {
  const d = { version: '1.0.0', apiVersion: 'v3.1.0', kind: 'DataContract', id: `${source}-${entity}`, name: entity, schema: [{ name: entity, properties }] };
  return { source, entity, id: `${source}-${entity}`, declaredVersion: '1.0.0', contentHash: `${source}-hash0000000`, validation: 'valid', rawYaml: yaml.dump(d) };
}

const transpile = (contents: string) =>
  ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** Run an emitted compat file: a recorder stands in for vitest. Returns failing test names. */
function runCompat(contents: string): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  const expectFn = (actual: unknown, msg?: string) => ({
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) throw new Error(`${msg ?? ''}: expected ${String(expected)}, got ${String(actual)}`);
    },
    toBeDefined() {
      if (actual === undefined) throw new Error(`${msg ?? ''}: expected a defined value`);
    },
  });
  const vitest = {
    describe: (_n: string, fn: () => void) => fn(),
    it: (name: string, fn: () => void) => {
      try {
        fn();
        passed.push(name);
      } catch {
        failed.push(name);
      }
    },
    expect: expectFn,
  };
  new Function('require', 'exports', transpile(contents))((m: string) => (m === 'vitest' ? vitest : {}), {});
  return { passed, failed };
}

/** Run an emitted conformance file: stub `fetch`, real Ajv. */
async function runConformance(
  contents: string,
  env: Record<string, string>,
  response: { ok?: boolean; status?: number; body: unknown }
): Promise<{ passed: string[]; failed: { name: string; message: string }[] }> {
  const passed: string[] = [];
  const failed: { name: string; message: string }[] = [];
  const pending: Promise<void>[] = [];
  const expectFn = (actual: unknown, msg?: string) => ({
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) throw new Error(`${msg ?? ''}: expected ${String(expected)}, got ${String(actual)}`);
    },
    toBeGreaterThan(n: number) {
      if (!(typeof actual === 'number' && actual > n)) throw new Error(`${msg ?? ''}: expected > ${n}, got ${String(actual)}`);
    },
  });
  const describeFn = Object.assign((_n: string, fn: () => void) => fn(), {
    skipIf: (skip: boolean) => (_n: string, fn: () => void) => {
      if (!skip) fn();
    },
  });
  const itFn = (name: string, fn: () => unknown) => {
    pending.push(
      Promise.resolve()
        .then(fn)
        .then(
          () => void passed.push(name),
          (err: Error) => void failed.push({ name, message: err.message })
        )
    );
  };
  const saved = { ...process.env };
  Object.assign(process.env, env);
  vi.stubGlobal('fetch', async () => ({ ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.body }));
  try {
    const req = (m: string) =>
      m === 'vitest' ? { describe: describeFn, it: itFn, expect: expectFn } : m === 'ajv' ? nodeRequire('ajv') : m === 'ajv-formats' ? nodeRequire('ajv-formats') : {};
    new Function('require', 'exports', transpile(contents))(req, {});
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

const taskPublished = () =>
  raw('get-ready', 'TaskPublished', [
    { name: 'taskId', logicalType: 'string', required: true, logicalTypeOptions: { format: 'uuid' } },
    { name: 'items', logicalType: 'array', required: true, logicalTypeOptions: { minItems: 1 } },
  ]);
const GR_ENV = { GET_READY_API_URL: 'http://gr.test', GET_READY_TOKEN: 't' };
const GOOD = { taskId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', items: [{ itemId: 'i1' }] };
const grFile = () => generateArtifacts([taskPublished()]).files.find((f) => f.path === 'conformance/get-ready.TaskPublished.generated.test.ts')!.contents;
const compatFile = (a: ReturnType<typeof generateArtifacts>, entity: string) => a.files.find((f) => f.path === `compat/${entity}.generated.test.ts`)!.contents;

// ---- run 1 F-01 / run 2 F-08 ------------------------------------------------

describe('derived schema carries logicalTypeOptions (run 1 F-01, run 2 F-08)', () => {
  it('derives minItems / maxItems / uniqueItems / format / pattern / length / range', () => {
    const schema = deriveJsonSchema({
      schema: [
        {
          name: 'T',
          properties: [
            { name: 'id', logicalType: 'string', logicalTypeOptions: { format: 'uuid', minLength: 36, maxLength: 36, pattern: '^[0-9a-f-]+$' } },
            { name: 'items', logicalType: 'array', logicalTypeOptions: { minItems: 1, maxItems: 5, uniqueItems: true } },
            { name: 'n', logicalType: 'integer', logicalTypeOptions: { minimum: 0, maximum: 10, exclusiveMinimum: -1, exclusiveMaximum: 11 } },
          ],
        },
      ],
    });
    expect(schema.properties.id).toEqual({ type: 'string', format: 'uuid', minLength: 36, maxLength: 36, pattern: '^[0-9a-f-]+$' });
    expect(schema.properties.items).toEqual({ type: 'array', minItems: 1, maxItems: 5, uniqueItems: true });
    expect(schema.properties.n).toEqual({ type: 'integer', minimum: 0, maximum: 10, exclusiveMinimum: -1, exclusiveMaximum: 11 });
  });

  it('ignores options Ajv cannot compile: unknown format, invalid regex, wrong-typed values', () => {
    const schema = deriveJsonSchema({
      schema: [
        {
          name: 'T',
          properties: [
            { name: 'a', logicalType: 'string', logicalTypeOptions: { format: 'not-a-format', pattern: '([unclosed' } },
            { name: 'b', logicalType: 'array', logicalTypeOptions: { minItems: 'one', maxItems: -2 } },
          ],
        },
      ],
    });
    expect(schema.properties.a).toEqual({ type: 'string' });
    expect(schema.properties.b).toEqual({ type: 'array' });
  });

  it('keeps nullability next to the constraints', () => {
    const schema = deriveJsonSchema({
      schema: [{ name: 'T', properties: [{ name: 'a', logicalType: 'string', logicalTypeOptions: { minLength: 1 }, customProperties: [{ property: 'nullable', value: 'true' }] }] }],
    });
    expect(schema.properties.a).toEqual({ type: ['string', 'null'], minLength: 1 });
  });

  it('a date logicalType keeps its own format when the options carry none', () => {
    const schema = deriveJsonSchema({ schema: [{ name: 'T', properties: [{ name: 'd', logicalType: 'date', logicalTypeOptions: {} }] }] });
    expect(schema.properties.d).toEqual({ type: 'string', format: 'date' });
  });

  it('the emitted conformance test rejects a record that breaks the contract constraints', async () => {
    const file = grFile();
    expect((await runConformance(file, GR_ENV, { body: [GOOD] })).failed).toEqual([]);
    for (const bad of [{ ...GOOD, taskId: 'not-a-uuid' }, { ...GOOD, items: [] }]) {
      const r = await runConformance(file, GR_ENV, { body: [bad] });
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0].message).toMatch(/violates the TaskPublished schema/);
    }
  });
});

// ---- run 1 F-02 / run 2 F-03 ------------------------------------------------

describe('emitted conformance test reads the response honestly (run 1 F-02, run 2 F-03)', () => {
  const file = grFile();

  it('fails when the endpoint yields zero records, instead of passing on nothing (R-134h)', async () => {
    const r = await runConformance(file, GR_ENV, { body: [] });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].message).toMatch(/no records/i);
  });

  it('fails when the body is neither an array nor a tRPC envelope', async () => {
    const r = await runConformance(file, GR_ENV, { body: { error: { message: 'bad input' } } });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].message).toMatch(/no records/i);
  });

  it('unwraps a tRPC envelope (result.data) and validates every record in it', async () => {
    expect((await runConformance(file, GR_ENV, { body: { result: { data: [GOOD] } } })).failed).toEqual([]);
    const bad = await runConformance(file, GR_ENV, { body: { result: { data: [GOOD, { ...GOOD, taskId: 'x' }] } } });
    expect(bad.failed).toHaveLength(1);
    expect(bad.failed[0].message).toContain('record #1');
  });

  it('unwraps a superjson tRPC envelope (result.data.json)', async () => {
    expect((await runConformance(file, GR_ENV, { body: { result: { data: { json: [GOOD] } } } })).failed).toEqual([]);
  });

  it('still fails on a non-2xx response', async () => {
    const r = await runConformance(file, GR_ENV, { ok: false, status: 400, body: {} });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].message).toContain('400');
  });

  it('a mapped recordsAt still wins, and zero records under it fails too', async () => {
    const org = (src: string) => raw(src, 'org', [{ name: 'sourcedId', required: true, logicalType: 'string' }]);
    const a = generateArtifacts([org('publisher'), org('consumer')]);
    const file2 = a.files.find((f) => f.path === 'conformance/publisher.org.generated.test.ts')!.contents;
    const env = { PUBLISHER_API_URL: 'http://p.test', PUBLISHER_TOKEN: 't' };
    expect((await runConformance(file2, env, { body: { items: [] } })).failed).toHaveLength(1);
    expect((await runConformance(file2, env, { body: { items: [{ sourcedId: 's' }] } })).failed).toEqual([]);
  });
});

// ---- run 2 F-05 -------------------------------------------------------------

describe('compat does not treat two missing logical types as equal (run 2 F-05)', () => {
  const pub = raw('create', 'Task', [{ name: 'title', required: true }]);
  const con = raw('get-ready', 'Task', [{ name: 'title', required: true }]);
  const flow = { Task: { publisher: 'create', consumer: 'get-ready' } };

  it('checkCompat records a violation when neither side declares a logicalType', () => {
    const result = checkCompat(yaml.load(con.rawYaml), yaml.load(pub.rawYaml));
    expect(result.compatible).toBe(false);
    expect(result.violations).toEqual([{ path: 'Task.title', reason: "type undeclared: neither consumer nor publisher declares a logicalType for 'title'" }]);
  });

  it('the emitted compat test is red for it, not green', () => {
    expect(runCompat(compatFile(generateArtifacts([pub, con], flow), 'Task')).failed).toEqual(["publisher provides consumer-required 'title'"]);
  });

  it('declared and equal types stay compatible', () => {
    const p = raw('create', 'Task', [{ name: 'title', required: true, logicalType: 'string' }]);
    const c = raw('get-ready', 'Task', [{ name: 'title', required: true, logicalType: 'string' }]);
    expect(runCompat(compatFile(generateArtifacts([p, c], flow), 'Task')).failed).toEqual([]);
  });
});

// ---- run 1 F-08 / run 2 F-09 ------------------------------------------------

describe('manifest ordering is locale-independent (run 1 F-08, run 2 F-09, R-88)', () => {
  const codePoint = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const pair = (e: string) => [raw('publisher', e, [{ name: 'k', required: true, logicalType: 'string' }]), raw('consumer', e, [{ name: 'k', required: true, logicalType: 'string' }])];

  it('orders compat tests by code point: uppercase entity first (localeCompare would put b first)', () => {
    const a = generateArtifacts([...pair('b'), ...pair('B')]);
    expect(a.manifest.tests.filter((t): t is CompatTest => t.kind === 'compat').map((t) => t.entity)).toEqual(['B', 'b']);
  });

  it('orders skips and file paths by code point', () => {
    const a = generateArtifacts([...pair('b'), ...pair('B'), raw('onboard', 'a-only', [{ name: 'k' }])]);
    const targets = a.manifest.skipped.map((s) => `${s.kind}.${s.target}`);
    expect(targets).toEqual([...targets].sort(codePoint));
    const paths = a.files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort(codePoint));
  });
});
