/**
 * Functional-plan prompts (T-34, T-40, T-54 · R-117, R-117b, R-117c).
 *
 * Pure (no SDK import), so the offline suite can test the exact text the model
 * sees; `llm.ts` sends it through Bedrock. The version is pinned in the plan
 * cache key (R-119), so any wording change MUST add a new version. v1/v2 stay
 * registered so a cached plan's `promptVersion` still names real text.
 */
import { compareCodePoint } from '@registry/core';
import type { GroundedContext } from '@registry/functest';

const V2_RULES = [
  '- Ground every field ONLY in the inputs provided. Never invent an entity, source, endpoint, or',
  '  field that was not given. `trigger.entity` MUST be the given entity; `trigger.source` MUST be',
  '  one of the given sources.',
  '- `trigger.path` should be the write endpoint on the publisher for that entity.',
  "- `trigger.payload` is a CONCRETE JSON object. Use only properties of the publisher's schema and",
  '  include every property it marks (required). Use realistic literal values.',
  '- `propagation.readBack` names where the propagated record is read back (normally the consumer,',
  "  using its live API target path), `matchOn`: the read-back record's identifying property, and",
  '  `matchFrom`: the payload property holding the same value when its name differs (e.g. payload',
  '  `taskId` → consumer `id`). Choose a bounded `timeoutSeconds` and `pollIntervalSeconds`.',
  "- Every assertion names a `fieldPath` that is a property of the asserting service's schema, an",
  '  `operator` (exists | equals | matchesType), an `expected` value for equals (from the trigger',
  '  payload, or a literal) and for matchesType (a literal logicalType), and `clause`: the exact,',
  '  verbatim substring of the requirement text that the assertion verifies.',
  '- Assert on the consumer side: a test that never checks the consumer cannot detect broken',
  '  propagation. Cover every SHALL/SHOULD/MAY clause of the requirement with at least one assertion.',
  '- Call the `emit_functional_test_plan` tool exactly once with the plan; do not reply with prose.',
];

const V2_INTRO = [
  'You are a senior test engineer specifying ONE end-to-end, cross-service functional test.',
  'You are given a single natural-language EARS requirement, the ODCS contract schema of each',
  'service that handles the entity it concerns, and the live API coordinates for those services.',
  '',
  'Produce a SINGLE test PLAN (never code) for the scenario: the PUBLISHER performs a write that,',
  'via change-data-capture (CDC), propagates to the CONSUMER, with assertions on the affected side(s).',
  '',
  'Rules:',
];

/** Prompt registry — the version is pinned in the cache key (R-119). */
export const PROMPTS: Record<string, string> = {
  v1: [
    'You are a senior test engineer specifying ONE end-to-end, cross-service functional test.',
    'You are given a single natural-language EARS requirement, the ODCS contract schema for the',
    'entity it concerns, and the live API coordinates for each service that handles that entity.',
    '',
    'Produce a SINGLE test PLAN (never code) for the scenario: the PUBLISHER performs a write that,',
    'via change-data-capture (CDC), propagates to the CONSUMER, with assertions on the affected side(s).',
    '',
    'Rules:',
    '- Ground every field ONLY in the inputs provided. Never invent an entity, source, endpoint, or',
    '  field that was not given. `trigger.entity` MUST be the given entity; `trigger.source` MUST be',
    '  one of the given sources.',
    '- `trigger.path` should be the write endpoint on the publisher for that entity.',
    '- Keep `payloadShape` a description of the request body shape, not a literal payload.',
    '- Assertions describe what a runner must verify after propagation; be specific and grounded.',
    '- Call the `emit_functional_test_plan` tool exactly once with the plan; do not reply with prose.',
  ].join('\n'),
  // v2 (R-117b, D-74): structured, executable plans.
  v2: [...V2_INTRO, ...V2_RULES].join('\n'),
  // v3 (R-117c, D-84, D-85): declared roles + field correspondence.
  v3: [
    ...V2_INTRO,
    '- `trigger.source` MUST be the declared publisher named in the "Flow" line; the read-back and',
    '  every consumer assertion concern the declared consumer.',
    '- Use the field correspondence: a publisher payload property maps to the consumer property it',
    '  names. Consumer assertions use CONSUMER field names; `matchFrom`/`expected.path` use PUBLISHER',
    '  (payload) names. Never assert a publisher-only name on the consumer.',
    ...V2_RULES,
  ].join('\n'),
};

/** The per-requirement user message: requirement, flow, schemas, field map, API targets. */
export function userPrompt(ctx: GroundedContext): string {
  const propsOf = (props: GroundedContext['schema']) =>
    props.map((p) => `  - ${p.name}${p.required ? ' (required)' : ''}: ${p.logicalType ?? 'unknown'}`).join('\n') || '  (no properties)';
  const schema = Object.keys(ctx.schemasBySource ?? {}).length
    ? Object.entries(ctx.schemasBySource)
        .sort(([a], [b]) => compareCodePoint(a, b))
        .map(([source, props]) => `Contract schema for ${ctx.entity} in ${source}:\n${propsOf(props)}`)
        .join('\n\n')
    : `Contract schema for ${ctx.entity}:\n${propsOf(ctx.schema)}`;
  const targets = ctx.apiTargets.map((t) => `  - ${t.source}: ${t.target.path} (records at "${t.target.recordsAt}")`).join('\n');
  const mapping = Object.entries(ctx.fieldMap ?? {});
  const correspondence = mapping.length
    ? ['Field correspondence (publisher → consumer):', ...mapping.map(([pub, con]) => `  - ${pub} → ${con}`)].join('\n')
    : 'Field correspondence (publisher → consumer): none declared; names match across the flow';
  return [
    `Requirement ${ctx.requirement.id} (${ctx.requirement.earsType}, §${ctx.requirement.section}) from the ${ctx.requirement.source} service:`,
    `  "${ctx.requirement.text}"`,
    ``,
    `Entity under test: ${ctx.entity}`,
    `Sources that handle this entity: ${ctx.sources.join(', ')}`,
    `Flow: ${ctx.roles.publisher} (publisher) → ${ctx.roles.consumer} (consumer)`,
    ``,
    schema,
    ``,
    correspondence,
    ``,
    `Live API targets:`,
    targets,
  ].join('\n');
}
