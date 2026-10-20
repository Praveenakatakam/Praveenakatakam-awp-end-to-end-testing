/**
 * T-43a — mutation attacks: §3.9 executed/manifest-tier compat mutation (R-135)
 * and §3.11 static plan mutation scoring (R-136, D-77).
 */
import { describe, it, expect } from 'vitest';
import type { CatalogContract } from '@registry/testgen';
import { normalizeContractSchema, parseAndValidate } from '@registry/core';
import { emitFunctionalTests, stampPlan } from '@registry/functest';
import {
  compatMutants,
  compatOutcome,
  mutateTestgen,
  manifestTierEvaluator,
  manifestTierEvaluatorWith,
  scorePlan,
  DEFAULT_MUTATION_THRESHOLD,
  type CompatEvaluator,
  type FunctionalUnderReview,
} from '../src/index.js';
import { loadFunctionalSeed, loadTestgenSeed } from './calibration.js';

/**
 * v0.8.0: the shipped generator resolves roles from declarations (R-84b), so it
 * IS role-correct on the S06 `publisher`/`consumer` pair — no relabelling trick.
 */
const roleCorrect = (_roles: unknown): CompatEvaluator => manifestTierEvaluator;

/** A minimal valid ODCS contract for in-test catalogs. */
function contractOf(source: string, entity: string, props: { name: string; logicalType: string; required?: boolean }[]): CatalogContract {
  const doc = { version: '1.0.0', apiVersion: 'v3.1.0', kind: 'DataContract', id: `${source}-${entity}`, name: entity, schema: [{ name: entity, properties: props }] };
  return { source, entity, id: `${source}-${entity}`, declaredVersion: '1.0.0', contentHash: `${source}-h`, validation: 'valid', rawYaml: JSON.stringify(doc) };
}

// ---- §3.9 executed/manifest mutation (R-135) -------------------------------

describe('compatMutants', () => {
  it('derives M1–M3 per consumer-required property, one M4 and one C1 control, deterministically', () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const ms = compatMutants(s.catalog, 'org', s.roles);
    const ids = ms.map((m) => m.id);
    // consumer (true role) requires name, sourcedId, status
    for (const p of ['name', 'sourcedId', 'status']) {
      for (const op of ['M1', 'M2', 'M3']) expect(ids).toContain(`${op}:${p}`);
    }
    expect(ms.filter((m) => m.operator === 'M4')).toHaveLength(1);
    expect(ms.filter((m) => m.operator === 'C1')).toHaveLength(1);
    expect(ms.find((m) => m.operator === 'C1')?.expect).toBe('green');
    expect(ms.filter((m) => m.operator !== 'C1').every((m) => m.expect === 'red')).toBe(true);
    expect(compatMutants(s.catalog, 'org', s.roles).map((m) => m.id)).toEqual(ids);
  });

  it('M1 deletes the property from the TRUE publisher’s contract only', () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const m1 = compatMutants(s.catalog, 'org', s.roles).find((m) => m.id === 'M1:sourcedId')!;
    const pub = m1.catalog.find((c) => c.source === 'publisher')!;
    const con = m1.catalog.find((c) => c.source === 'consumer')!;
    // The real org contract also mentions sourcedId elsewhere (parent's required list,
    // descriptions), so check the schema property list, not the raw text.
    const pubProps = [...normalizeContractSchema(parseAndValidate(pub.rawYaml).parsed).props.keys()];
    expect(pubProps).not.toContain('sourcedId');
    expect(pubProps).toContain('name');
    expect(parseAndValidate(pub.rawYaml).validation).toBe('valid');
    expect(con.rawYaml).toBe(s.catalog.find((c) => c.source === 'consumer')!.rawYaml);
  });
});

describe('mutateTestgen (R-135)', () => {
  it('S06: against a generator fed an INVERTED flow, M1 survives → Critical generator finding (D-80 seed 6, v0.8.0 form)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const r = await mutateTestgen(s.catalog, s.roles, manifestTierEvaluatorWith(s.generatorFlows!));
    expect(r.tier).toBe('manifest');
    const m1 = r.findings.find((f) => f.mutant === 'M1:sourcedId');
    expect(m1).toMatchObject({
      attack: 'mutation',
      rule: 'R-135',
      severity: 'Critical',
      target: { kind: 'generator', ref: 'packages/testgen' },
    });
    expect(m1?.failureScenario).toMatch(/sourcedId/);
    const org = r.entities.find((e) => e.entity === 'org')!;
    expect(org.applicable).toBe(true);
    expect(org.survivors).toContain('M1:sourcedId');
  });

  it('S06: against the SHIPPED generator (declared roles, R-84b) every M-mutant is killed and C1 stays green', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const r = await mutateTestgen(s.catalog, s.roles);
    expect(r.findings).toEqual([]);
    const org = r.entities.find((e) => e.entity === 'org')!;
    expect(org.killed).toBe(org.total);
  });

  it('a field-mapped pair: M1 on consumer-required id deletes the mapped publisher taskId, and is killed (R-135, D-85)', async () => {
    const flow = { publisher: 'create', consumer: 'get-ready', fields: { taskId: 'id' } };
    const catalog = [
      contractOf('create', 'Task', [{ name: 'taskId', logicalType: 'string', required: true }, { name: 'title', logicalType: 'string', required: true }]),
      contractOf('get-ready', 'Task', [{ name: 'id', logicalType: 'string', required: true }, { name: 'title', logicalType: 'string', required: true }]),
    ];
    const roles = { Task: flow };
    const m1 = compatMutants(catalog, 'Task', roles).find((m) => m.id === 'M1:id')!;
    expect(m1).toBeDefined();
    const pubProps = [...normalizeContractSchema(parseAndValidate(m1.catalog.find((c) => c.source === 'create')!.rawYaml).parsed).props.keys()];
    expect(pubProps).toEqual(['title']);

    const r = await mutateTestgen(catalog, roles, manifestTierEvaluatorWith({ Task: flow }));
    expect(r.findings).toEqual([]);
    expect(r.entities).toEqual([expect.objectContaining({ entity: 'Task', applicable: true, survivors: [] })]);
    expect(r.entities[0].total).toBe(8); // M1–M3 × {id, title} + M4 + C1
  });

  it('compatOutcome applies the manifest fieldMap exactly as the emitted test does', () => {
    const t = {
      kind: 'compat' as const,
      entity: 'Task',
      publisher: { source: 'create', contractId: 'c', contentHash: 'h' },
      consumer: { source: 'get-ready', contractId: 'g', contentHash: 'h' },
      rule: 'consumer-can-read-publisher' as const,
      consumerRequired: [{ name: 'id', logicalType: 'string' }],
      publisherProps: [{ name: 'taskId', logicalType: 'string' }],
    };
    expect(compatOutcome(t)).toBe('red');
    expect(compatOutcome({ ...t, fieldMap: { id: 'taskId' } })).toBe('green');
  });

  it('a red C1 control is a Critical false-positive generator finding (E-52)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    // An evaluator that turns red on ANY extra publisher property simulates false-positive compat logic.
    const strict: CompatEvaluator = (catalog, entity) =>
      catalog.some((c) => c.rawYaml.includes('advC1Extra')) ? 'red' : roleCorrect(s.roles)(catalog, entity);
    const r = await mutateTestgen(s.catalog, s.roles, strict);
    expect(r.findings).toEqual([expect.objectContaining({ mutant: 'C1:advC1Extra', rule: 'R-135', severity: 'Critical' })]);
  });

  it('create/get-ready (2026-10-06 reconstruction): the baseline is red → not applicable, no finding', async () => {
    const s = loadTestgenSeed('testgen/create-get-ready');
    const r = await mutateTestgen(s.catalog, s.roles);
    expect(r.findings).toEqual([]);
    expect(r.entities).toEqual([expect.objectContaining({ entity: 'TaskPublished', applicable: false })]);
  });

  it('records the tier it was given (executed tier is supplied by the CLI, T-47)', async () => {
    const s = loadTestgenSeed('testgen/S06-publisher-consumer');
    const r = await mutateTestgen(s.catalog, s.roles, roleCorrect(s.roles), 'executed');
    expect(r.tier).toBe('executed');
  });
});

// ---- §3.11 static mutation (R-136) ----------------------------------------

describe('scorePlan (R-136)', () => {
  const review = (path: string): FunctionalUnderReview => {
    const s = loadFunctionalSeed(path);
    return { plan: s.plan, context: s.context, file: s.file };
  };

  it('default threshold is 0.5 (D-77)', () => {
    expect(DEFAULT_MUTATION_THRESHOLD).toBe(0.5);
  });

  it('clean: every mutant is killed (equals on name/status; the read-back kills sourcedId + M-noprop)', () => {
    const r = scorePlan(review('functional/clean'));
    expect(r.total).toBe(10);
    expect(r.survivors).toEqual([]);
    expect(r.score).toBe(1);
    expect(r.findings).toEqual([]);
  });

  it('S01-03: the committed legacy plan lets M-noprop survive → Critical', () => {
    const r = scorePlan(review('functional/S01-03-committed-cre-r-24'));
    expect(r.survivors).toContain('M-noprop');
    expect(r.findings).toContainEqual(expect.objectContaining({ rule: 'R-136', severity: 'Critical', mutant: 'M-noprop' }));
  });

  it('S05: a low score (title exists only) is Major, listing the survivors', () => {
    const r = scorePlan(review('functional/S05-event-entity-unmapped-trigger'));
    expect(r.score).toBeLessThan(0.5);
    const major = r.findings.find((f) => f.severity === 'Major');
    expect(major?.rule).toBe('R-136');
    expect(major?.evidence).toMatch(/MP-corrupt:title/);
    expect(r.findings.some((f) => f.severity === 'Critical')).toBe(false);
  });

  it('only consumer-required ∩ publisher properties are mutated (the renamed taskId → id is not)', () => {
    const r = scorePlan(review('functional/S05-event-entity-unmapped-trigger'));
    const props = new Set([...r.killed, ...r.survivors].filter((m) => m.startsWith('MP-')).map((m) => m.split(':')[1]));
    expect([...props].sort()).toEqual(['duration', 'standards', 'title']);
  });

  it('a custom threshold is honoured', () => {
    const s = loadFunctionalSeed('functional/S05-event-entity-unmapped-trigger');
    const plan = stampPlan(s.body!, s.context);
    const u = { plan, context: s.context, file: emitFunctionalTests([plan])[0] };
    expect(scorePlan(u, 0.1).findings.filter((f) => f.severity === 'Major')).toEqual([]);
  });
});
