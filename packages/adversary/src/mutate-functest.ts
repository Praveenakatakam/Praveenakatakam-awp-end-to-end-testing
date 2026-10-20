/**
 * §3.11 static mutation attack (R-136, D-71, D-77).
 *
 * Functional tests need live services, so instead of executing them we score
 * the structured plan against behavioural mutants of the consumer side. For each
 * property P the consumer REQUIRES and the publisher also carries:
 *   MP-drop     the consumer record lacks P
 *   MP-corrupt  the consumer's P differs from the published value
 *   MP-type     the consumer's P has the wrong type
 * plus M-noprop: propagation never happens.
 *
 * Killers: a consumer assertion on P (drop: any operator; corrupt: `equals` with
 * `expected.from = trigger.payload`; type: `matchesType` or `equals`), and the
 * consumer read-back itself — its "record found" check fails when nothing
 * propagates, and when its own `matchOn` field is dropped, corrupted or retyped.
 * A legacy plan has no structured checks, so nothing is killed.
 */
import type { DraftFinding } from './finding.js';
import { isLegacyPlan, planRef, type FunctionalUnderReview } from './subject.js';

export const DEFAULT_MUTATION_THRESHOLD = 0.5;

export interface PlanMutationScore {
  score: number;
  total: number;
  killed: string[];
  survivors: string[];
  findings: DraftFinding[];
}

export function scorePlan(u: FunctionalUnderReview, threshold: number = DEFAULT_MUTATION_THRESHOLD): PlanMutationScore {
  const { plan, context: ctx } = u;
  const legacy = isLegacyPlan(plan);
  const publisherSource = plan.trigger.source;
  // The declared consumer (R-117c, R-135 v0.8.0); source order is only the fallback for a hand-built context.
  const consumerSource = ctx.roles?.consumer ?? ctx.sources.find((s) => s !== publisherSource) ?? publisherSource;
  const pubNames = new Set((ctx.schemasBySource[publisherSource] ?? []).map((p) => p.name));
  const props = (ctx.schemasBySource[consumerSource] ?? [])
    .filter((p) => p.required && pubNames.has(p.name))
    .map((p) => p.name)
    .sort();

  const consumerAsserts = legacy ? [] : plan.assertions.filter((a) => a.service === 'consumer');
  const rb = legacy ? undefined : plan.propagation.readBack;
  const readBackOn = (p: string) => rb?.service === 'consumer' && rb.matchOn === p;
  const on = (p: string) => consumerAsserts.filter((a) => a.fieldPath === p);

  const mutants: [string, boolean][] = [];
  for (const p of props) {
    mutants.push([`MP-drop:${p}`, readBackOn(p) || on(p).length > 0]);
    mutants.push([
      `MP-corrupt:${p}`,
      readBackOn(p) || on(p).some((a) => a.operator === 'equals' && a.expected?.from === 'trigger.payload'),
    ]);
    mutants.push([`MP-type:${p}`, readBackOn(p) || on(p).some((a) => a.operator === 'matchesType' || a.operator === 'equals')]);
  }
  mutants.push(['M-noprop', rb?.service === 'consumer' || consumerAsserts.length > 0]);

  const killed = mutants.filter(([, k]) => k).map(([id]) => id);
  const survivors = mutants.filter(([, k]) => !k).map(([id]) => id);
  const score = killed.length / mutants.length;

  const target = { kind: 'functional' as const, ref: planRef(u), file: u.file.path };
  const findings: DraftFinding[] = [];
  if (survivors.includes('M-noprop')) {
    findings.push({
      attack: 'mutation',
      severity: 'Critical',
      rule: 'R-136',
      target,
      mutant: 'M-noprop',
      defect: 'The test cannot detect that the change never reached the consumer.',
      failureScenario: `CDC is down and ${consumerSource} never receives anything; with no consumer read-back or assertion, the test still passes.`,
      evidence: legacy ? 'legacy plan: no structured consumer check' : 'no consumer read-back and no consumer assertion',
    });
  }
  if (score < threshold) {
    findings.push({
      attack: 'mutation',
      severity: 'Major',
      rule: 'R-136',
      target,
      defect: `Only ${killed.length} of ${mutants.length} consumer-side mutants would fail this test (score ${score.toFixed(2)} < ${threshold}).`,
      failureScenario: `${consumerSource} can drop, corrupt or retype the surviving fields and the test stays green.`,
      evidence: `survivors: ${survivors.join(', ')}`,
    });
  }
  return { score, total: mutants.length, killed, survivors, findings };
}
