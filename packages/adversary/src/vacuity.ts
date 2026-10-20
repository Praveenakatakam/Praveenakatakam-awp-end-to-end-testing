/**
 * Vacuity attack (R-134) — would this test still pass if the system were broken?
 *
 * §3.11, Critical (gates, R-129):
 *   (a) no executable assertion on a record field (only HTTP-status checks);
 *   (b) `it.todo` / `it.skip`, or a commented-out request body;
 *   (c) a POST/PUT/PATCH trigger sent without a body;
 *   (d) no consumer-side assertion — broken propagation is undetectable;
 *   (e) no bounded wait before observing the consumer.
 * §3.11, Major:
 *   (f) a modality clause (segmented per D-76) no assertion's `clause` covers;
 *   (g) a tautology — asserting the very correlation the read-back selected on.
 * §3.9, Major:
 *   (h) a conformance test that is green when zero records come back;
 *   (i) a compat test with zero consumer-required properties.
 *
 * File checks are regexes over OUR emitters' fixed output shape (design §12.8a);
 * calibration seeds S01–S03/S07 pin them to the real committed files.
 */
import type { CompatTest, ConformanceTest } from '@registry/testgen';
import type { DraftFinding } from './finding.js';
import { isLegacyPlan, planRef, type EmittedFile, type FunctionalUnderReview } from './subject.js';
import { at, lineOf, locateClause } from './text.js';

// ---- D-76 clause segmentation ---------------------------------------------

export interface ClauseSegment {
  start: number;
  end: number;
  text: string;
}

const MODALITY = /\b(SHALL|SHOULD|MAY)\b/g;
const JOINER = /,\s*(?:and|or)\s+|;\s+|,\s+/g;

/**
 * Split a requirement into one contiguous segment per modality keyword. The
 * boundary between two modalities is the LAST joiner (", and", ";", ",")
 * between them — so "…bus, and the get-ready service SHALL make…" cuts at
 * ", and". No modality → no segments (nothing to cover).
 */
export function segmentClauses(text: string): ClauseSegment[] {
  const modalities = [...text.matchAll(MODALITY)].map((m) => m.index!);
  if (modalities.length === 0) return [];
  const cuts = [0];
  for (let k = 1; k < modalities.length; k++) {
    const between = text.slice(modalities[k - 1], modalities[k]);
    const joiners = [...between.matchAll(JOINER)];
    cuts.push(joiners.length ? modalities[k - 1] + joiners[joiners.length - 1].index! : modalities[k]);
  }
  cuts.push(text.length);
  return cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1], text: text.slice(start, cuts[i + 1]) }));
}

// ---- §3.11 -----------------------------------------------------------------

// The three shapes the emitter renders: expect(at(…)), expect(logicalTypeOf(at(…))), expect(typeMatches(at(…)).
const FIELD_EXPECT = /expect\(\s*(?:(?:logicalTypeOf|typeMatches)\(\s*)?at\(/g;
const TODO = /\bit\.(todo|skip)\(/g;
const COMMENTED_BODY = /^[ \t]*\/\/[ \t]*body[ \t]*:/m;
const LIVE_BODY = /^[ \t]*body[ \t]*:/m;
const STATUS_EXPECT = /expect\(\s*res\.(ok|status)\b/;

export function lintFunctional(u: FunctionalUnderReview): DraftFinding[] {
  const { plan, context: ctx, file } = u;
  const c = file.contents;
  const legacy = isLegacyPlan(plan);
  const target = { kind: 'functional' as const, ref: planRef(u), file: file.path };
  const out: DraftFinding[] = [];
  const finding = (rule: string, severity: DraftFinding['severity'], defect: string, failureScenario: string, evidence: string) =>
    out.push({ attack: 'vacuity', severity, rule, target, defect, failureScenario, evidence });

  const fieldExpects = [...c.matchAll(FIELD_EXPECT)].length;

  // (a)
  if (fieldExpects === 0) {
    finding(
      'R-134a',
      'Critical',
      'The test has no executable assertion on any record field; its only checks are on the HTTP status.',
      'If the change never propagates, or arrives corrupted, the test still passes as soon as the trigger returns 2xx.',
      STATUS_EXPECT.test(c) ? `only status check: ${at(file.path, c, STATUS_EXPECT)}` : `${file.path}: no expect() on a field`
    );
  }

  // (b)
  const todos = [...c.matchAll(TODO)];
  const commented = COMMENTED_BODY.exec(c);
  if (todos.length || commented) {
    const kinds = ['todo', 'skip']
      .map((k) => [k, todos.filter((m) => m[1] === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} × it.${k}`);
    if (commented) kinds.push(`commented-out body at ${file.path}:${lineOf(c, commented.index)}`);
    finding(
      'R-134b',
      'Critical',
      'Assertions or the request body are present only as placeholders that never execute.',
      'Every placeholder passes (or is skipped) regardless of system behaviour, so the stated assertions verify nothing.',
      kinds.join('; ')
    );
  }

  // (c)
  if (['POST', 'PUT', 'PATCH'].includes(plan.trigger.method) && !LIVE_BODY.test(c)) {
    finding(
      'R-134c',
      'Critical',
      `The ${plan.trigger.method} trigger is sent without a request body.`,
      'The publisher receives an empty write, so either it rejects it (the test fails for the wrong reason) or the scenario under test never happens.',
      `${file.path}: no live \`body:\` in the trigger fetch`
    );
  }

  // (d)
  const consumerAssertions = legacy ? fieldExpects : plan.assertions.filter((a) => a.service === 'consumer').length;
  if (consumerAssertions === 0) {
    finding(
      'R-134d',
      'Critical',
      'The test makes no assertion on the consumer side.',
      'If CDC never delivers the change to the consumer, nothing in the test observes it, so the cross-service test passes on a broken flow.',
      legacy
        ? `${file.path}: no executable consumer assertion (legacy plan)`
        : `plan.assertions services: ${plan.assertions.map((a) => a.service).join(', ') || '(none)'}`
    );
  }

  // (e)
  const unbounded = !/pollUntil\(/.test(c) || (!legacy && !(plan.propagation.timeoutSeconds > 0));
  if (unbounded) {
    finding(
      'R-134e',
      'Critical',
      'There is no bounded wait for propagation before the consumer is observed.',
      'The consumer is read (if at all) before CDC can deliver, so the outcome depends on timing, not on whether propagation works.',
      legacy ? `${file.path}: no read-back poll; propagation is only a comment` : `timeoutSeconds = ${plan.propagation.timeoutSeconds}`
    );
  }

  if (!legacy) {
    // (f)
    const text = ctx.requirement.text;
    const ranges = plan.assertions
      .map((a) => locateClause(text, a.clause))
      .filter((r): r is { start: number; len: number } => r !== undefined && r.len > 0);
    for (const seg of segmentClauses(text)) {
      const covered = ranges.some((r) => r.start < seg.end && r.start + r.len > seg.start);
      if (!covered) {
        finding(
          'R-134f',
          'Major',
          `No assertion covers the clause "${seg.text.trim()}" of ${ctx.requirement.id}.`,
          'That part of the requirement can be broken without any assertion failing.',
          `uncovered clause: "${seg.text.trim()}"`
        );
      }
    }

    // (g)
    const rb = plan.propagation.readBack;
    const matchFrom = rb.matchFrom ?? rb.matchOn;
    plan.assertions.forEach((a, i) => {
      const onCorrelation = a.service === rb.service && a.fieldPath === rb.matchOn;
      const tautological =
        onCorrelation &&
        (a.operator === 'exists' || (a.operator === 'equals' && a.expected?.from === 'trigger.payload' && a.expected.path === matchFrom));
      if (tautological) {
        finding(
          'R-134g',
          'Major',
          `Assertion #${i + 1} re-checks the field the read-back record was selected by, so it cannot fail.`,
          `The read-back only returns a record whose ${rb.matchOn} already equals payload.${matchFrom}; a consumer that corrupts every other field still passes this assertion.`,
          `assertion #${i + 1}: ${a.service} ${a.fieldPath} ${a.operator}${a.expected?.from === 'trigger.payload' ? ` payload.${a.expected.path}` : ''}; readBack matchOn ${rb.matchOn}`
        );
      }
    });
  }

  return out;
}

// ---- §3.9 ------------------------------------------------------------------

const ITERATES_RECORDS = /records\.(forEach|map|every)\(|for\s*\(\s*const\s+\w+\s+of\s+records\b/;
/**
 * A real non-empty check: an `expect` ON `records` that requires at least one element.
 * Not the bare token `records.length` (a comment or an unrelated read), not a `toHaveLength`
 * on some other array, and not `toBeGreaterThanOrEqual(0)`, which every length satisfies.
 */
const CHECKS_NONEMPTY = new RegExp(
  [
    String.raw`expect\(\s*records\.length\b[^\n]*\)\s*\.toBeGreaterThan\(\s*0\s*\)`,
    String.raw`expect\(\s*records\.length\b[^\n]*\)\s*\.toBeGreaterThanOrEqual\(\s*[1-9]\d*\s*\)`,
    String.raw`expect\(\s*records\b[^\n]*\)\s*\.not\.toHaveLength\(\s*0\s*\)`,
    String.raw`expect\(\s*records\b[^\n]*\)\s*\.toHaveLength\(\s*[1-9]\d*\s*\)`,
  ].join('|')
);

export function lintConformance(t: ConformanceTest, file: EmittedFile): DraftFinding[] {
  const c = file.contents;
  if (!ITERATES_RECORDS.test(c) || CHECKS_NONEMPTY.test(c)) return [];
  return [
    {
      attack: 'vacuity',
      severity: 'Major',
      rule: 'R-134h',
      target: { kind: 'conformance', ref: `${t.source}/${t.entity}`, file: file.path },
      defect: 'The conformance test validates each returned record but never requires that any record is returned.',
      failureScenario: `If ${t.target.path} returns an empty list — or recordsAt "${t.target.recordsAt}" points at the wrong key, so pluck() yields [] — no record is validated and the test passes.`,
      evidence: `${at(file.path, c, ITERATES_RECORDS)}; no non-empty check`,
    },
  ];
}

export function lintCompat(t: CompatTest): DraftFinding[] {
  if (t.consumerRequired.length > 0) return [];
  return [
    {
      attack: 'vacuity',
      severity: 'Major',
      rule: 'R-134i',
      target: { kind: 'compat', ref: t.entity },
      defect: `The compat test for '${t.entity}' checks zero consumer-required properties.`,
      failureScenario:
        'The test loops over an empty list and passes whatever the publisher contract contains, including one the consumer cannot read.',
      evidence: `manifest compat ${t.entity}: consumerRequired = []`,
    },
  ];
}
