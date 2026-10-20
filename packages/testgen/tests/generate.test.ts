import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import ts from 'typescript';
import { generateArtifacts, serializeManifest } from '../src/generate.js';
import { checkCompat } from '../src/compat.js';
import { deriveJsonSchema } from '../src/derive-schema.js';
import type { CatalogContract, CompatTest, ConformanceTest } from '../src/manifest.js';

// ---- Fixture builders ------------------------------------------------------

type Prop = { name: string; required?: boolean; logicalType?: string; enum?: unknown[] };

function doc(entity: string, props: Prop[]) {
  return {
    version: '1.0.0',
    apiVersion: 'v3.1.0',
    kind: 'DataContract',
    id: `${entity}-id`,
    name: entity,
    schema: [
      {
        name: entity,
        properties: props.map((p) => ({
          name: p.name,
          required: p.required ?? false,
          logicalType: p.logicalType ?? 'string',
          ...(p.enum ? { quality: [{ type: 'library', arguments: { validValues: p.enum } }] } : {}),
        })),
      },
    ],
  };
}

function cc(
  source: string,
  entity: string,
  id: string,
  props: Prop[],
  opts: { validation?: 'valid' | 'invalid'; hash?: string } = {}
): CatalogContract {
  return {
    source,
    entity,
    id,
    declaredVersion: '1.0.0',
    contentHash: opts.hash ?? `${source}-${id}-hash000000`,
    validation: opts.validation ?? 'valid',
    rawYaml: yaml.dump(doc(entity, props)),
  };
}

const orgProps: Prop[] = [
  { name: 'sourcedId', required: true },
  { name: 'name', required: true },
  { name: 'status', required: true, enum: ['active', 'tobedeleted'] },
  { name: 'identifier' },
];
const classProps: Prop[] = [
  { name: 'sourcedId', required: true },
  { name: 'title', required: true },
];

/** Rich catalog exercising every path in the pipeline. */
function fullCatalog(): CatalogContract[] {
  return [
    cc('publisher', 'org', 'org-p', orgProps), // valid + mapped → conformance
    cc('consumer', 'org', 'org-c', orgProps), // valid, unmapped → conf skip; org compat compatible
    cc('publisher', 'user', 'user-p', [
      { name: 'sourcedId', required: true },
      { name: 'email', required: true },
      { name: 'username', required: true },
    ]),
    cc('consumer', 'user', 'user-c', [
      { name: 'sourcedId', required: true },
      { name: 'email', required: true },
      { name: 'givenName', required: true }, // consumer-required, ABSENT in publisher → compat violation
    ]),
    cc('publisher', 'class', 'class-p', classProps), // unmapped → conf skip
    cc('consumer', 'class', 'class-c', classProps), // mapped → conformance
    cc('consumer', 'class-roster', 'roster-c', [{ name: 'classSourcedId', required: true }]), // single source
    cc('publisher', 'enrollment', 'enr-p', [{ name: 'sourcedId', required: true }]),
    cc('consumer', 'enrollment', 'enr-c', [{ name: 'sourcedId', required: true }], { validation: 'invalid' }),
  ];
}

const conformance = (a: ReturnType<typeof generateArtifacts>) =>
  a.manifest.tests.filter((t): t is ConformanceTest => t.kind === 'conformance');
const compat = (a: ReturnType<typeof generateArtifacts>) => a.manifest.tests.filter((t): t is CompatTest => t.kind === 'compat');

// ---- Tests -----------------------------------------------------------------

describe('generateArtifacts (T-19 · R-81…R-88)', () => {
  it('emits conformance only for valid + mapped contracts (AC-83, AC-83b, AC-85)', () => {
    const a = generateArtifacts(fullCatalog());
    const keys = conformance(a)
      .map((t) => `${t.source}/${t.entity}`)
      .sort();
    expect(keys).toEqual(['consumer/class', 'publisher/org']);

    // Unmapped and invalid contracts become recorded conformance skips.
    const confSkips = a.manifest.skipped.filter((s) => s.kind === 'conformance');
    expect(confSkips.find((s) => s.target === 'consumer/enr-c')?.reason).toBe('validation: invalid');
    expect(confSkips.find((s) => s.target === 'publisher/user-p')?.reason).toMatch(/no API mapping/);
    expect(confSkips.map((s) => s.target)).toContain('consumer/org-c');
  });

  it('derives an embedded JSON Schema with required + additionalProperties (AC-83, D-30)', () => {
    const org = conformance(generateArtifacts(fullCatalog())).find((t) => t.entity === 'org')!;
    expect(org.jsonSchema.additionalProperties).toBe(true);
    expect(org.jsonSchema.required.sort()).toEqual(['name', 'sourcedId', 'status']);
    expect(org.jsonSchema.properties.status.enum).toEqual(['active', 'tobedeleted']);
    expect(org.target).toMatchObject({ path: '/orgs', baseUrlEnv: 'PUBLISHER_API_URL', recordsAt: 'items' });
  });

  it('emitted conformance assertion names the offending record + failing rule (R-83)', () => {
    const files = generateArtifacts(fullCatalog()).files;
    const conf = files.find((f) => f.path.startsWith('conformance/'))!;
    // The failure message must surface the offending record's contents and the
    // Ajv rule that failed, not just the raw error list (R-83).
    expect(conf.contents).toContain('${JSON.stringify(rec)}');
    expect(conf.contents).toContain('${JSON.stringify(validate.errors)}');
  });

  it('records contentHash + declaredVersion each test was generated from (AC-82)', () => {
    const a = generateArtifacts(fullCatalog());
    const org = conformance(a).find((t) => t.entity === 'org')!;
    expect(org.contentHash).toBe('publisher-org-p-hash000000');
    expect(org.declaredVersion).toBe('1.0.0');

    // Compat entries record BOTH variants' hash + declared version (R-82/R-86),
    // so a reader can assess either variant's staleness — not just the hash.
    // v0.8.0 (R-84b): the literal `publisher`/`consumer` labels ARE the roles — no alphabetical inversion.
    const orgCompat = compat(a).find((t) => t.entity === 'org')!;
    expect(orgCompat.publisher).toMatchObject({ source: 'publisher', contentHash: 'publisher-org-p-hash000000', declaredVersion: '1.0.0' });
    expect(orgCompat.consumer).toMatchObject({ source: 'consumer', contentHash: 'consumer-org-c-hash000000', declaredVersion: '1.0.0' });
  });

  it('emits compat for shared valid entities with consumer-can-read-publisher facts (AC-84, E-25/E-26)', () => {
    const a = generateArtifacts(fullCatalog());
    expect(compat(a).map((t) => t.entity)).toEqual(['class', 'org', 'user']);

    // v0.8.0 (R-84b): the `consumer` source requires givenName and the `publisher` source lacks it.
    const user = compat(a).find((t) => t.entity === 'user')!;
    expect(user.consumerRequired.map((p) => p.name)).toContain('givenName');
    expect(user.publisherProps.map((p) => p.name)).not.toContain('givenName');
    expect(user.rule).toBe('consumer-can-read-publisher');
  });

  it('skips compat for single-source and invalid-variant entities (AC-85, E-21)', () => {
    const skips = generateArtifacts(fullCatalog()).manifest.skipped.filter((s) => s.kind === 'compat');
    expect(skips.find((s) => s.target === 'class-roster')?.reason).toBe('single-source (consumer only)');
    expect(skips.find((s) => s.target === 'enrollment')?.reason).toMatch(/variant invalid \(consumer\)/);
  });

  it('two-domain entities take roles from the declared flow, never from label order (AC-84b, R-84b)', () => {
    const catalog: CatalogContract[] = [
      cc('create', 'TaskPublished', 'tp-create', [
        { name: 'eventId', required: true },
        { name: 'taskId', required: true },
        { name: 'title', required: true },
        { name: 'extras', required: false },
      ]),
      cc('get-ready', 'TaskPublished', 'tp-gr', [
        { name: 'eventId', required: true },
        { name: 'taskId', required: true },
      ]),
    ];
    const declared = compat(generateArtifacts(catalog, { TaskPublished: { publisher: 'create', consumer: 'get-ready' } }));
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({ entity: 'TaskPublished', rule: 'consumer-can-read-publisher' });
    expect(declared[0].publisher.source).toBe('create');
    expect(declared[0].consumer.source).toBe('get-ready');
    expect(declared[0].consumerRequired.map((p) => p.name).sort()).toEqual(['eventId', 'taskId']);

    // The alphabetically-LATER source as publisher: only a declaration can do this.
    const inverted = compat(generateArtifacts(catalog, { TaskPublished: { publisher: 'get-ready', consumer: 'create' } }));
    expect(inverted[0].publisher.source).toBe('get-ready');
    expect(inverted[0].consumer.source).toBe('create');
  });

  it('skips compat for a domain-labelled pair with no declared flow (E-59, R-85)', () => {
    const catalog: CatalogContract[] = [
      cc('deliver', 'Widget', 'w-1', [{ name: 'id', required: true }]),
      cc('score', 'Widget', 'w-2', [{ name: 'id', required: true }]),
    ];
    const a = generateArtifacts(catalog, {});
    expect(compat(a)).toEqual([]);
    expect(a.manifest.skipped.find((s) => s.kind === 'compat' && s.target === 'Widget')?.reason).toBe(
      'no declared publisher/consumer roles'
    );
  });

  it('three or more sources: one compat test over the declared pair; undeclared → roles skip (R-84b)', () => {
    const catalog: CatalogContract[] = [
      cc('create', 'Event', 'e-1', [{ name: 'id', required: true }]),
      cc('deliver', 'Event', 'e-2', [{ name: 'id', required: true }]),
      cc('score', 'Event', 'e-3', [{ name: 'id', required: true }]),
    ];
    const declared = compat(generateArtifacts(catalog, { Event: { publisher: 'score', consumer: 'create' } }));
    expect(declared.map((t) => `${t.publisher.source}→${t.consumer.source}`)).toEqual(['score→create']);

    const skips = generateArtifacts(catalog, {}).manifest.skipped.filter((s) => s.kind === 'compat');
    expect(skips.find((s) => s.target === 'Event')?.reason).toBe('no declared publisher/consumer roles');
  });

  it('empty catalog → empty artifact set, no crash (AC-81, E-19)', () => {
    const a = generateArtifacts([]);
    expect(a.manifest.tests).toEqual([]);
    expect(a.manifest.skipped).toEqual([]);
    expect(a.files).toEqual([]);
  });

  it('is deterministic — same catalog → byte-identical output (AC-88, R-88)', () => {
    const a = serializeManifest(generateArtifacts(fullCatalog()).manifest);
    const b = serializeManifest(generateArtifacts(fullCatalog()).manifest);
    expect(a).toBe(b);
    const filesA = JSON.stringify(generateArtifacts(fullCatalog()).files);
    const filesB = JSON.stringify(generateArtifacts(fullCatalog()).files);
    expect(filesA).toBe(filesB);
    // No timestamps / run ids / randomness leaked into committed artifacts.
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('uses the stable file layout under generated-tests/ (AC-92, R-92)', () => {
    const paths = generateArtifacts(fullCatalog())
      .files.map((f) => f.path)
      .sort();
    expect(paths).toEqual([
      'compat/class.generated.test.ts',
      'compat/org.generated.test.ts',
      'compat/user.generated.test.ts',
      'conformance/consumer.class.generated.test.ts',
      'conformance/publisher.org.generated.test.ts',
    ]);
  });

  it('emitted files are valid TS with a do-not-edit header + correct guard (AC-87)', () => {
    for (const f of generateArtifacts(fullCatalog()).files) {
      expect(f.contents).toMatch(/GENERATED — DO NOT EDIT/);
      if (f.path.startsWith('conformance/')) {
        expect(f.contents).toMatch(/describe\.skipIf\(!ready\)/); // R-83a env guard
        expect(f.contents).toMatch(/import Ajv from "ajv"/);
      } else {
        expect(f.contents).toMatch(/consumer-can-read-publisher/);
      }
      // Transpiles without syntax errors → valid TypeScript.
      const out = ts.transpileModule(f.contents, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      expect(out.diagnostics ?? []).toHaveLength(0);
    }
  });

  it('manifest enumerates every test + skip with the required shape (AC-86)', () => {
    const m = generateArtifacts(fullCatalog()).manifest;
    expect(m.manifestVersion).toBe(1);
    expect(m.generator).toBe('@registry/testgen');
    for (const s of m.skipped) {
      expect(s.kind).toMatch(/conformance|compat/);
      expect(s.target).toBeTruthy();
      expect(s.reason).toBeTruthy();
    }
  });
});

// ---- v0.8.0: field correspondence + nested properties (T-53a) ---------------

/** A catalog contract from raw ODCS properties (nested allowed). */
function raw(source: string, entity: string, properties: unknown[]): CatalogContract {
  const d = { version: '1.0.0', apiVersion: 'v3.1.0', kind: 'DataContract', id: `${source}-${entity}`, name: entity, schema: [{ name: entity, properties }] };
  return { source, entity, id: `${source}-${entity}`, declaredVersion: '1.0.0', contentHash: `${source}-hash0000000`, validation: 'valid', rawYaml: yaml.dump(d) };
}

/**
 * Run an emitted compat file for real: transpile it, swap the `vitest` import
 * for a tiny recorder, execute it, and return the failing test names.
 */
function runEmitted(contents: string): { passed: string[]; failed: string[] } {
  const js = ts.transpileModule(contents, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const passed: string[] = [];
  const failed: string[] = [];
  const expectFn = (actual: unknown, msg?: string) => ({
    toBe(expected: unknown) {
      if (!Object.is(actual, expected)) throw new Error(`${msg ?? ''}: expected ${String(expected)}, got ${String(actual)}`);
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
  new Function('require', 'exports', js)((m: string) => (m === 'vitest' ? vitest : {}), {});
  return { passed, failed };
}

const compatFile = (a: ReturnType<typeof generateArtifacts>, entity: string) =>
  a.files.find((f) => f.path === `compat/${entity}.generated.test.ts`)!.contents;

describe('compat field correspondence (T-53 · R-84c, AC-84c, E-60, D-85)', () => {
  const pub = (idType = 'string') => raw('create', 'Task', [{ name: 'taskId', logicalType: idType, required: true }, { name: 'title', logicalType: 'string', required: true }]);
  const con = raw('get-ready', 'Task', [{ name: 'id', logicalType: 'string', required: true }, { name: 'title', logicalType: 'string', required: true }]);
  const flow = (fields?: Record<string, string>) => ({ Task: { publisher: 'create', consumer: 'get-ready', ...(fields ? { fields } : {}) } });

  it('checkCompat satisfies a mapped consumer property from the publisher property', () => {
    const p = yaml.load(pub().rawYaml);
    const c = yaml.load(con.rawYaml);
    expect(checkCompat(c, p, { taskId: 'id' }).violations).toEqual([]);
    expect(checkCompat(c, p).violations).toEqual([{ path: 'Task.id', reason: 'required by consumer but absent in publisher' }]);
    expect(checkCompat(c, yaml.load(pub('integer').rawYaml), { taskId: 'id' }).violations[0].reason).toMatch(/type mismatch/);
  });

  it('the manifest records the map (consumer → publisher) and the emitted file applies it — green', () => {
    const a = generateArtifacts([pub(), con], flow({ taskId: 'id' }));
    expect(compat(a)[0].fieldMap).toEqual({ id: 'taskId' });
    expect(runEmitted(compatFile(a, 'Task'))).toEqual({ passed: ["publisher provides consumer-required 'id'", "publisher provides consumer-required 'title'"], failed: [] });
  });

  it('without the map the emitted file is red on id; with a retyped mapped field it is red too', () => {
    expect(runEmitted(compatFile(generateArtifacts([pub(), con], flow()), 'Task')).failed).toEqual(["publisher provides consumer-required 'id'"]);
    expect(runEmitted(compatFile(generateArtifacts([pub('integer'), con], flow({ taskId: 'id' })), 'Task')).failed).toEqual([
      "publisher provides consumer-required 'id'",
    ]);
  });

  it('an entity with no field map keeps the v0.7 manifest shape (no fieldMap key)', () => {
    const org = compat(generateArtifacts(fullCatalog())).find((t) => t.entity === 'org')!;
    expect('fieldMap' in org).toBe(false);
  });
});

describe('nested properties (T-53 · R-84d, R-83c, AC-84d, E-61, D-86)', () => {
  const items = (withItemId: boolean, name = 'items') => ({
    name,
    logicalType: 'array',
    required: true,
    items: {
      logicalType: 'object',
      properties: [...(withItemId ? [{ name: 'itemId', logicalType: 'string', required: true }] : []), { name: 'label', logicalType: 'string' }],
    },
  });
  const flow = { Task: { publisher: 'create', consumer: 'get-ready' } };

  it('compat fails on items[].itemId when the publisher array lacks it, and passes when present', () => {
    const con = raw('get-ready', 'Task', [items(true)]);
    const red = generateArtifacts([raw('create', 'Task', [items(false)]), con], flow);
    expect(compat(red)[0].consumerRequired.map((p) => p.name)).toEqual(['items', 'items[].itemId']);
    expect(runEmitted(compatFile(red, 'Task')).failed).toEqual(["publisher provides consumer-required 'items[].itemId'"]);

    const green = generateArtifacts([raw('create', 'Task', [items(true)]), con], flow);
    expect(runEmitted(compatFile(green, 'Task')).failed).toEqual([]);
  });

  it('a field-map entry on a parent path renames its descendants', () => {
    const a = generateArtifacts([raw('create', 'Task', [items(true, 'items')]), raw('get-ready', 'Task', [items(true, 'tasks')])], {
      Task: { publisher: 'create', consumer: 'get-ready', fields: { items: 'tasks' } },
    });
    expect(compat(a)[0].fieldMap).toEqual({ tasks: 'items', 'tasks[].itemId': 'items[].itemId' });
    expect(runEmitted(compatFile(a, 'Task')).failed).toEqual([]);
  });

  it('the derived conformance schema nests object properties and array items with their required lists', () => {
    const schema = deriveJsonSchema({
      schema: [{ name: 'Task', properties: [items(true), { name: 'meta', logicalType: 'object', properties: [{ name: 'note', logicalType: 'string', required: true }] }] }],
    });
    expect(schema.properties.items).toEqual({
      type: 'array',
      items: { type: 'object', required: ['itemId'], properties: { itemId: { type: 'string' }, label: { type: 'string' } } },
    });
    expect(schema.properties.meta).toEqual({ type: 'object', required: ['note'], properties: { note: { type: 'string' } } });
  });
});

// ---- T-59a: live-review fixes F-06, F-09, F-10 ------------------------------

describe('derived schema + compat fixes (T-59a)', () => {
  it('F-06: a nullable property accepts null in the derived conformance schema (enum included)', () => {
    const schema = deriveJsonSchema({
      schema: [{ name: 'T', properties: [
        { name: 'duration', logicalType: 'integer', customProperties: [{ property: 'nullable', value: 'true' }] },
        { name: 'kind', logicalType: 'string', customProperties: [{ property: 'nullable', value: 'true' }], quality: [{ arguments: { validValues: ['a', 'b'] } }] },
        { name: 'title', logicalType: 'string' },
      ] }],
    });
    expect(schema.properties.duration).toEqual({ type: ['integer', 'null'] });
    expect(schema.properties.kind).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] });
    expect(schema.properties.title).toEqual({ type: 'string' });
  });

  it('F-10: ODCS date → format date; timestamp → date-time', () => {
    const schema = deriveJsonSchema({ schema: [{ name: 'T', properties: [{ name: 'd', logicalType: 'date' }, { name: 'ts', logicalType: 'timestamp' }] }] });
    expect(schema.properties.d).toEqual({ type: 'string', format: 'date' });
    expect(schema.properties.ts).toEqual({ type: 'string', format: 'date-time' });
  });

  it('F-09: compat compares logical types case-insensitively (String vs string)', () => {
    const pub = raw('create', 'Task', [{ name: 'title', logicalType: 'String', required: true }]);
    const con = raw('get-ready', 'Task', [{ name: 'title', logicalType: 'string', required: true }]);
    expect(checkCompat(yaml.load(con.rawYaml), yaml.load(pub.rawYaml)).violations).toEqual([]);
    const a = generateArtifacts([pub, con], { Task: { publisher: 'create', consumer: 'get-ready' } });
    expect(runEmitted(compatFile(a, 'Task')).failed).toEqual([]);
  });
});
