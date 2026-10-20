/**
 * T-48 — calibration fixture integrity. These must pass BEFORE any attack is
 * built: they prove each seed is what the answer key claims (real, valid
 * contracts; plans that pass structural validation and ground; the S06 baseline
 * is green and the create/get-ready baseline is red), so a T-48a failure later
 * means the attack is wrong, not the fixture.
 */
import { describe, it, expect } from 'vitest';
import { parseAndValidate } from '@registry/core';
import { validatePlan } from '@registry/functest';
import { generateArtifacts, type CompatTest } from '@registry/testgen';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_KEY, CALIBRATION_DIR, loadFunctionalSeed, loadTestgenSeed, loadConformanceSeed, seedExists } from './calibration.js';

/** Consumer-required properties the publisher fails, evaluated as the emitted test does (R-84, R-84c field map). */
function compatUnmet(t: CompatTest): string[] {
  const pub = new Map(t.publisherProps.map((p) => [p.name, p.logicalType]));
  return t.consumerRequired
    .filter((r) => {
      const name = t.fieldMap?.[r.name] ?? r.name;
      return !(pub.has(name) && pub.get(name) === r.logicalType);
    })
    .map((r) => r.name);
}
const compatGreen = (t: CompatTest) => compatUnmet(t).length === 0;

describe('calibration fixtures (T-48)', () => {
  it('every answer-key seed folder exists', () => {
    for (const s of ANSWER_KEY) expect(seedExists(s.path), s.path).toBe(true);
  });

  it('every calibration contract is valid ODCS v3.1.0', () => {
    const dir = join(CALIBRATION_DIR, 'contracts');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.odcs.yaml'))) {
      const { validation, errors } = parseAndValidate(readFileSync(join(dir, f), 'utf8'));
      expect(validation, `${f}: ${JSON.stringify(errors)}`).toBe('valid');
    }
  });

  for (const s of ANSWER_KEY.filter((k) => k.kind === 'functional')) {
    it(`functional seed ${s.seed} grounds, and (v2) passes structural plan validation`, () => {
      const seed = loadFunctionalSeed(s.path);
      expect(seed.context.sources.length).toBe(2);
      if (!seed.legacy) {
        const v = validatePlan(seed.body, { entity: seed.context.entity, sources: seed.context.sources, publisher: seed.context.roles.publisher });
        expect(v.ok, v.ok ? '' : v.reason).toBe(true);
        expect(seed.file.contents).not.toContain('it.todo');
      } else {
        expect(seed.file.contents).toContain('it.todo'); // the verbatim committed defect
      }
    });
  }

  it('S06: baseline compat is green under BOTH the shipped generator and the inverted generatorFlows (so M1 can be judged)', () => {
    const seed = loadTestgenSeed('testgen/S06-publisher-consumer');
    const shipped = generateArtifacts(seed.catalog).manifest.tests.find((t) => t.kind === 'compat') as CompatTest;
    const inverted = generateArtifacts(seed.catalog, seed.generatorFlows).manifest.tests.find((t) => t.kind === 'compat') as CompatTest;
    expect(compatGreen(shipped)).toBe(true);
    expect(compatGreen(inverted)).toBe(true);
  });

  it('S06: the shipped generator assigns publisher → consumer (R-84b); generatorFlows reproduces the D-80 seed-6 inversion', () => {
    const seed = loadTestgenSeed('testgen/S06-publisher-consumer');
    const shipped = generateArtifacts(seed.catalog).manifest.tests.find((t) => t.kind === 'compat') as CompatTest;
    expect(shipped.publisher.source).toBe('publisher');
    expect(shipped.consumer.source).toBe('consumer');
    const inverted = generateArtifacts(seed.catalog, seed.generatorFlows).manifest.tests.find((t) => t.kind === 'compat') as CompatTest;
    expect(inverted.publisher.source).toBe('consumer');
    expect(inverted.consumer.source).toBe('publisher');
  });

  it('create/get-ready (2026-10-06 reconstruction): no field map is declared, so compat is red on the old divergent names (D-85)', () => {
    const seed = loadTestgenSeed('testgen/create-get-ready');
    const compat = generateArtifacts(seed.catalog).manifest.tests.find((t) => t.kind === 'compat') as CompatTest;
    expect(compat.publisher.source).toBe('create');
    expect('fieldMap' in compat).toBe(false);
    expect(compatUnmet(compat)).toEqual(['description', 'id', 'itemTypes', 'totalItemCount', 'type']);
  });

  it('S07: the verbatim conformance test iterates records with no non-empty check', () => {
    const seed = loadConformanceSeed('testgen/S07-conformance-empty');
    expect(seed.file.contents).toContain('records.forEach');
    expect(seed.file.contents).not.toMatch(/records\.length/);
  });
});
