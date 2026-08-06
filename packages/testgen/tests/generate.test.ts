import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import ts from 'typescript';
import { generateArtifacts, serializeManifest } from '../src/generate.js';
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
    // 'consumer' < 'publisher' alphabetically → consumer source is treated as publisher.
    const orgCompat = compat(a).find((t) => t.entity === 'org')!;
    expect(orgCompat.publisher).toMatchObject({ contentHash: 'consumer-org-c-hash000000', declaredVersion: '1.0.0' });
    expect(orgCompat.consumer).toMatchObject({ contentHash: 'publisher-org-p-hash000000', declaredVersion: '1.0.0' });
  });

  it('emits compat for shared valid entities with consumer-can-read-publisher facts (AC-84, E-25/E-26)', () => {
    const a = generateArtifacts(fullCatalog());
    expect(compat(a).map((t) => t.entity)).toEqual(['class', 'org', 'user']);

    // 'consumer' < 'publisher' alphabetically → consumer source is publisher, publisher source is consumer.
    const user = compat(a).find((t) => t.entity === 'user')!;
    // The 'publisher' source (now acting as consumer) requires givenName; 'consumer' source (now publisher) lacks it.
    expect(user.consumerRequired.map((p) => p.name)).toContain('username');
    expect(user.publisherProps.map((p) => p.name)).not.toContain('username');
    expect(user.rule).toBe('consumer-can-read-publisher');
  });

  it('skips compat for single-source and invalid-variant entities (AC-85, E-21)', () => {
    const skips = generateArtifacts(fullCatalog()).manifest.skipped.filter((s) => s.kind === 'compat');
    expect(skips.find((s) => s.target === 'class-roster')?.reason).toBe('single-source (consumer only)');
    expect(skips.find((s) => s.target === 'enrollment')?.reason).toMatch(/variant invalid \(consumer\)/);
  });

  it('generates compat for two-domain entities using alphabetical publisher/consumer assignment', () => {
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
    const a = generateArtifacts(catalog);
    const compatTests = compat(a);
    expect(compatTests).toHaveLength(1);
    const t = compatTests[0];
    expect(t.entity).toBe('TaskPublished');
    // 'create' < 'get-ready' alphabetically → create is publisher, get-ready is consumer
    expect(t.publisher.source).toBe('create');
    expect(t.consumer.source).toBe('get-ready');
    expect(t.rule).toBe('consumer-can-read-publisher');
    // get-ready requires eventId + taskId; both present in create → compatible
    expect(t.consumerRequired.map((p) => p.name).sort()).toEqual(['eventId', 'taskId']);
  });

  it('skips compat for entities with more than two sources', () => {
    const catalog: CatalogContract[] = [
      cc('create', 'Event', 'e-1', [{ name: 'id', required: true }]),
      cc('deliver', 'Event', 'e-2', [{ name: 'id', required: true }]),
      cc('score', 'Event', 'e-3', [{ name: 'id', required: true }]),
    ];
    const skips = generateArtifacts(catalog).manifest.skipped.filter((s) => s.kind === 'compat');
    expect(skips.find((s) => s.target === 'Event')?.reason).toMatch(/single-source/);
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
