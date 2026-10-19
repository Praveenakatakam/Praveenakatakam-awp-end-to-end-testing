/**
 * Runtime-generated output instructions appended to a pipeline step's user
 * message (R-73, D-28).
 *
 * The output shape is enforced in code (forced tool use, R-60), so the text that
 * describes it lives here rather than in author-written prompt bodies. These
 * texts are versioned by `OUTPUT_INSTRUCTIONS_VERSION`, which is part of the
 * step cache key — bump it whenever any text below changes.
 */
import type { StepOutputType } from '@registry/core';

/** Bump on any change to the instruction texts (invalidates the step cache — R-73, TS-60). */
export const OUTPUT_INSTRUCTIONS_VERSION = '1';

/** Heading of the appended section; also the section name in the input snapshot (R-74). */
export const OUTPUT_INSTRUCTIONS_HEADING = 'Output instructions:';

const PLAN_FIELDS = [
  'Plan fields:',
  '  - requirementIds: the ID(s) of the requirement this test covers, as given above.',
  '  - title: a short, specific name for the scenario.',
  '  - rationale: why this scenario exercises the requirement — which clause of the requirement it proves.',
  '  - setup: preconditions and fixtures the test needs (tokens, existing records), one per item.',
  '  - trigger: the write that starts the scenario. source = the service performing the write; entity = the',
  '    entity under test; method = POST | PUT | PATCH | DELETE; path = that service\'s write endpoint;',
  '    payloadShape = a description of the request body; examplePayload (optional) = a concrete JSON body',
  '    using only properties from the contract schema.',
  '  - propagation: how the write reaches the other services. kind = "cdc" (change-data-capture from the',
  '    writer\'s store), "eventbridge" (an event published on a bus; put the bus / detail-type in channel),',
  '    or "sync" (a direct synchronous call); waitFor = the observable condition that signals propagation',
  '    is complete.',
  '  - assertions: what must hold after propagation. service = the service observed; assertion = what to',
  '    verify; field / expected (optional) = a property-level check on a contract schema property.',
  '  - negativeCases (optional): invalid or edge inputs the test should also cover, each with its',
  '    expected outcome.',
  'Grounding rules: trigger.entity must be the entity under test; trigger.source and every',
  'assertions[].service must be one of the listed sources; paths must come from the live API targets and',
  'fields from the contract schema. Never invent a source, entity, endpoint, or field that is not in the',
  'context above.',
].join('\n');

const PLAN_FRESH = [
  OUTPUT_INSTRUCTIONS_HEADING,
  'Produce ONE grounded cross-service test plan for the requirement above by calling the',
  '`emit_functional_test_plan` tool exactly once. Do not write test code and do not reply with prose.',
  PLAN_FIELDS,
].join('\n');

const PLAN_REVISE = [
  OUTPUT_INSTRUCTIONS_HEADING,
  'Prior step outputs above include a test plan. Produce a REVISED plan by calling the',
  '`emit_functional_test_plan` tool exactly once. Start from the most recent prior plan: address every',
  'issue raised in any critique among the prior outputs (blockers and majors first), fix anything that',
  'is not grounded in the context, and keep the parts that were already correct unchanged. Return the',
  'complete plan, not a diff. Do not write test code and do not reply with prose.',
  PLAN_FIELDS,
].join('\n');

const CRITIQUE = [
  OUTPUT_INSTRUCTIONS_HEADING,
  'Review the most recent test plan among the prior step outputs above and report your findings by',
  'calling the `emit_critique` tool exactly once. Do not reply with prose.',
  'Check the plan against the requirement (does the scenario actually prove it?), the contract schema',
  '(do the payload and assertion fields exist?), and the live API targets (are the trigger source,',
  'method, and path real?), and check that every source, entity, path, and field is grounded in the',
  'context above.',
  'Critique fields:',
  '  - verdict: "approve" (usable as is), "revise" (fixable issues), or "reject" (the scenario is wrong',
  '    for this requirement).',
  '  - summary: one or two sentences on the overall quality of the plan.',
  '  - issues: one entry per concrete problem. severity = "blocker" (the test would be wrong or',
  '    unrunnable), "major" (significant gap in coverage or grounding), or "minor" (clarity or polish);',
  '    target = the plan field it concerns, e.g. "trigger.path" or "assertions[1]"; problem = what is',
  '    wrong; suggestion = the specific fix. Use an empty list when there are no issues.',
].join('\n');

/**
 * The output-instructions section for a step, or `null` for `freeform` (R-73).
 * `hasPriorPlan` = an injected prior output came from a step whose output type
 * resolves to `plan`; it selects the "revise" variant for plan steps.
 */
export function outputInstructions(
  outputType: StepOutputType,
  opts: { hasPriorPlan: boolean }
): string | null {
  switch (outputType) {
    case 'plan':
      return opts.hasPriorPlan ? PLAN_REVISE : PLAN_FRESH;
    case 'critique':
      return CRITIQUE;
    case 'freeform':
      return null;
  }
}
