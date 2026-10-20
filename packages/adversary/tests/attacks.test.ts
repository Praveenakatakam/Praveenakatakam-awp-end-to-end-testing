/**
 * T-42a — grounding (R-133) and vacuity (R-134) attacks, on the real
 * calibration seeds plus targeted cases for each rule.
 */
import { describe, it, expect } from 'vitest';
import { generateArtifacts, type CompatTest, type ConformanceTest } from '@registry/testgen';
import { emitFunctionalTests, stampPlan, type FunctionalTestPlan } from '@registry/functest';
import {
  groundPlan,
  lintFunctional,
  lintConformance,
  lintCompat,
  segmentClauses,
  type DraftFinding,
  type FunctionalUnderReview,
} from '../src/index.js';
import { loadFunctionalSeed, loadConformanceSeed, loadTestgenSeed, type FunctionalSeed } from './calibration.js';

const review = (s: FunctionalSeed): FunctionalUnderReview => ({ plan: s.plan, context: s.context, file: s.file });
const rules = (fs: DraftFinding[]) => fs.map((f) => `${f.rule}:${f.severity}`).sort();
const has = (fs: DraftFinding[], rule: string, severity: string) => fs.some((f) => f.rule === rule && f.severity === severity);

/** Re-stamp + re-emit a seed after editing its plan body, as the pipeline would. */
function edited(seedPath: string, edit: (p: FunctionalTestPlan) => void): FunctionalUnderReview {
  const s = loadFunctionalSeed(seedPath);
  const body = structuredClone(s.body!);
  edit(body as FunctionalTestPlan);
  const plan = stampPlan(body, s.context);
  return { plan, context: s.context, file: emitFunctionalTests([plan])[0] };
}

// ---- Clean control ---------------------------------------------------------

describe('clean control', () => {
  it('raises no grounding or vacuity finding at all', () => {
    const u = review(loadFunctionalSeed('functional/clean'));
    expect([...groundPlan(u), ...lintFunctional(u)]).toEqual([]);
  });
});

// ---- Grounding (R-133) -----------------------------------------------------

describe('groundPlan (R-133)', () => {
  it('S04: an assertion fieldPath absent from the asserting service’s contract is Critical (a)', () => {
    const fs = groundPlan(review(loadFunctionalSeed('functional/S04-absent-fieldpath')));
    const f = fs.find((x) => x.rule === 'R-133a');
    expect(f?.severity).toBe('Critical');
    expect(f?.evidence).toMatch(/itemCount/);
    expect(f?.target).toMatchObject({ kind: 'functional', ref: 'create/CRE-R-24' });
  });

  it('(a) uses the ASSERTING service’s variant: totalItemCount is fine on the consumer', () => {
    const u = edited('functional/S05-event-entity-unmapped-trigger', (p) => {
      p.assertions.push({ ...p.assertions[1], fieldPath: 'totalItemCount' });
    });
    expect(groundPlan(u).filter((f) => f.rule === 'R-133a')).toEqual([]);
  });

  it('(a) a matchesType literal that contradicts the contract logicalType is Critical', () => {
    const u = edited('functional/clean', (p) => {
      p.assertions.push({
        service: 'consumer',
        fieldPath: 'name',
        operator: 'matchesType',
        expected: { from: 'literal', value: 'integer' },
        clause: p.assertions[0].clause,
      });
    });
    expect(has(groundPlan(u), 'R-133a', 'Critical')).toBe(true);
  });

  it('(b) on a MAPPED trigger path: unknown payload key / missing required key is Critical', () => {
    const unknownKey = edited('functional/clean', (p) => {
      p.trigger.payload.nickname = 'x';
    });
    const missingRequired = edited('functional/clean', (p) => {
      delete p.trigger.payload.dateLastModified;
    });
    expect(has(groundPlan(unknownKey), 'R-133b', 'Critical')).toBe(true);
    expect(has(groundPlan(missingRequired), 'R-133b', 'Critical')).toBe(true);
  });

  it('S05 (b) on an UNMAPPED trigger path is Major, not Critical (OQ-15)', () => {
    const fs = groundPlan(review(loadFunctionalSeed('functional/S05-event-entity-unmapped-trigger')));
    expect(has(fs, 'R-133b', 'Major')).toBe(true);
    expect(fs.some((f) => f.severity === 'Critical')).toBe(false);
  });

  it('(c) a clause that is not a verbatim substring of the requirement is Critical', () => {
    const u = edited('functional/clean', (p) => {
      p.assertions[0].clause = 'the consumer SHALL mirror the org';
    });
    expect(has(groundPlan(u), 'R-133c', 'Critical')).toBe(true);
  });

  it('S01-03 (d) the committed file reads PUBLISHER_*/CONSUMER_* while the mapping names GET_READY_* → Critical', () => {
    const f = groundPlan(review(loadFunctionalSeed('functional/S01-03-committed-cre-r-24'))).find((x) => x.rule === 'R-133d');
    expect(f?.severity).toBe('Critical');
    expect(f?.evidence).toMatch(/CONSUMER_API_URL/);
    expect(f?.failureScenario).toMatch(/GET_READY_API_URL/);
  });

  it('(e) trigger / read-back paths absent from every API mapping are Major', () => {
    const s0103 = groundPlan(review(loadFunctionalSeed('functional/S01-03-committed-cre-r-24')));
    expect(has(s0103, 'R-133e', 'Major')).toBe(true);
    const badReadBack = edited('functional/clean', (p) => {
      p.propagation.readBack.path = '/organisations';
    });
    expect(has(groundPlan(badReadBack), 'R-133e', 'Major')).toBe(true);
  });
});

// ---- Vacuity (R-134) -------------------------------------------------------

describe('segmentClauses (D-76)', () => {
  it('splits the CRE-R-24 text into one segment per modality, cut at the joining ", and"', () => {
    const text = loadFunctionalSeed('functional/S05-event-entity-unmapped-trigger').requirement.text;
    const segs = segmentClauses(text);
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toMatch(/create service SHALL publish/);
    expect(segs[1].text).toMatch(/get-ready service SHALL make/);
    expect(segs[0].end).toBe(segs[1].start);
    expect(segs[0].start).toBe(0);
    expect(segs[1].end).toBe(text.length);
  });

  it('returns no segments for a requirement without a modality keyword', () => {
    expect(segmentClauses('data at rest is encrypted')).toEqual([]);
  });
});

describe('lintFunctional (R-134)', () => {
  it('S01-03: the committed CRE-R-24 file trips (a)–(e), all Critical', () => {
    const fs = lintFunctional(review(loadFunctionalSeed('functional/S01-03-committed-cre-r-24')));
    for (const r of ['R-134a', 'R-134b', 'R-134c', 'R-134d', 'R-134e']) expect(has(fs, r, 'Critical'), r).toBe(true);
  });

  it('(b) names every it.todo / commented body it found as evidence', () => {
    const f = lintFunctional(review(loadFunctionalSeed('functional/S01-03-committed-cre-r-24'))).find((x) => x.rule === 'R-134b');
    expect(f?.evidence).toMatch(/13 × it\.todo/);
    expect(f?.evidence).toMatch(/commented-out body/);
  });

  it('(d) a v2 plan with no consumer assertion is Critical even though the file has expects', () => {
    const u = edited('functional/clean', (p) => {
      p.assertions = p.assertions.map((a) => ({ ...a, service: 'publisher' as const }));
    });
    expect(has(lintFunctional(u), 'R-134d', 'Critical')).toBe(true);
  });

  it('(f) an uncovered modality clause is Major', () => {
    const u = edited('functional/S05-event-entity-unmapped-trigger', (p) => {
      p.assertions = p.assertions.filter((a) => a.service === 'consumer');
    });
    const f = lintFunctional(u).find((x) => x.rule === 'R-134f');
    expect(f?.severity).toBe('Major');
    expect(f?.evidence).toMatch(/create service SHALL publish/);
  });

  it('S08 (g) asserting the read-back correlation field is a Major tautology', () => {
    const f = lintFunctional(review(loadFunctionalSeed('functional/S08-tautology'))).find((x) => x.rule === 'R-134g');
    expect(f?.severity).toBe('Major');
    expect(f?.evidence).toMatch(/\bid\b/);
  });

  it('S09: the semantic swap passes every deterministic grounding/vacuity check (critic-only seed)', () => {
    const u = review(loadFunctionalSeed('functional/S09-semantic-swap'));
    const s05 = review(loadFunctionalSeed('functional/S05-event-entity-unmapped-trigger'));
    expect(rules([...groundPlan(u), ...lintFunctional(u)])).toEqual(rules([...groundPlan(s05), ...lintFunctional(s05)]));
  });
});

describe('lintConformance / lintCompat (R-134h, R-134i)', () => {
  it('S07: the committed get-ready conformance test passes on zero records → Major', () => {
    const s = loadConformanceSeed('testgen/S07-conformance-empty');
    const fs = lintConformance(s.entry as ConformanceTest, s.file);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({
      attack: 'vacuity',
      rule: 'R-134h',
      severity: 'Major',
      target: { kind: 'conformance', ref: 'get-ready/TaskPublished' },
    });
  });

  it('a conformance file that asserts a non-empty record list is not flagged', () => {
    const s = loadConformanceSeed('testgen/S07-conformance-empty');
    const fixed = s.file.contents.replace(
      'const records = pluck(await res.json());',
      'const records = pluck(await res.json());\n    expect(records.length).toBeGreaterThan(0);'
    );
    expect(lintConformance(s.entry as ConformanceTest, { ...s.file, contents: fixed })).toEqual([]);
  });

  it('(i) a compat test with zero consumer-required properties is Major; a real one is not', () => {
    const real = generateArtifacts(loadTestgenSeed('testgen/S06-publisher-consumer').catalog).manifest.tests.find(
      (t) => t.kind === 'compat'
    ) as CompatTest;
    expect(lintCompat(real)).toEqual([]);
    const empty = { ...real, consumerRequired: [] };
    expect(lintCompat(empty)).toEqual([
      expect.objectContaining({ rule: 'R-134i', severity: 'Major', target: { kind: 'compat', ref: 'org' } }),
    ]);
  });
});

// ---- T-59a F-07: grounding reads the DECLARED consumer, not source order ----

import { groundPlan as groundPlanF07 } from '../src/index.js';

describe('grounding uses ctx.roles.consumer (T-59a · F-07)', () => {
  it('a consumer assertion on a field only the declared consumer has is NOT flagged R-133a', () => {
    const s = loadFunctionalSeed('functional/clean');
    // Declare a third, alphabetically-first source that lacks the field; roles still point at the real consumer.
    const context = {
      ...s.context,
      sources: ['aaa-audit', ...s.context.sources],
      schemasBySource: { ...s.context.schemasBySource, 'aaa-audit': [] },
    };
    const findings = groundPlanF07({ plan: s.plan, context, file: s.file }).filter((f) => f.rule === 'R-133a');
    expect(findings).toEqual([]);
  });
});
