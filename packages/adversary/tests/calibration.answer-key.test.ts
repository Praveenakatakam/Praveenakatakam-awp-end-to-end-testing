/**
 * T-48a — the deterministic attacks against the calibration answer key
 * (R-145, D-80): 100% of the deterministic-tagged expectations are found, and
 * no `forbid` entry (e.g. any Critical on the clean control) appears. Critic
 * expectations are measured live in T-49, not here.
 */
import { describe, it, expect } from 'vitest';
import type { ConformanceTest } from '@registry/testgen';
import {
  groundPlan,
  lintFunctional,
  lintConformance,
  scorePlan,
  mutateTestgen,
  manifestTierEvaluatorWith,
  type DraftFinding,
} from '../src/index.js';
import {
  ANSWER_KEY,
  loadFunctionalSeed,
  loadConformanceSeed,
  loadTestgenSeed,
  type AnswerKeyExpectation,
  type AnswerKeySeed,
} from './calibration.js';

async function deterministicFindings(s: AnswerKeySeed): Promise<DraftFinding[]> {
  if (s.kind === 'functional') {
    const seed = loadFunctionalSeed(s.path);
    const u = { plan: seed.plan, context: seed.context, file: seed.file };
    return [...groundPlan(u), ...lintFunctional(u), ...scorePlan(u).findings];
  }
  if (s.kind === 'conformance') {
    const seed = loadConformanceSeed(s.path);
    return lintConformance(seed.entry as ConformanceTest, seed.file);
  }
  const seed = loadTestgenSeed(s.path);
  // v0.8.0: seed 6's role inversion lives in the flows fed to the generator under test.
  const evaluate = seed.generatorFlows ? manifestTierEvaluatorWith(seed.generatorFlows) : undefined;
  return (await mutateTestgen(seed.catalog, seed.roles, evaluate)).findings;
}

function matches(f: DraftFinding, e: AnswerKeyExpectation): boolean {
  return (
    (e.attack === undefined || f.attack === e.attack) &&
    (e.rule === undefined || f.rule === e.rule) &&
    (e.severity === undefined || f.severity === e.severity) &&
    (e.targetKind === undefined || f.target.kind === e.targetKind) &&
    (e.mutant === undefined || (f.mutant ?? '').startsWith(`${e.mutant}:`))
  );
}

const describeExp = (e: AnswerKeyExpectation) => [e.attack, e.rule, e.severity, e.targetKind, e.mutant].filter(Boolean).join(' ');

describe('calibration answer key (T-48a · R-145)', () => {
  for (const s of ANSWER_KEY) {
    describe(`${s.seed} (${s.tag})`, () => {
      for (const e of s.expect) {
        it(`finds ${describeExp(e)}`, async () => {
          const fs = await deterministicFindings(s);
          expect(
            fs.some((f) => matches(f, e)),
            JSON.stringify(fs.map((f) => `${f.attack}/${f.rule}/${f.severity}`))
          ).toBe(true);
        });
      }
      for (const e of s.forbid ?? []) {
        it(`raises no ${describeExp(e)}`, async () => {
          const fs = (await deterministicFindings(s)).filter((f) => matches(f, e));
          expect(fs.map((f) => `${f.attack}/${f.rule}/${f.severity}: ${f.defect}`)).toEqual([]);
        });
      }
    });
  }

  it('recall over deterministic-tagged expectations is 100%', async () => {
    let total = 0;
    let found = 0;
    for (const s of ANSWER_KEY.filter((k) => k.tag.includes('deterministic'))) {
      const fs = await deterministicFindings(s);
      for (const e of s.expect) {
        total++;
        if (fs.some((f) => matches(f, e))) found++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(found / total).toBe(1);
  });
});
