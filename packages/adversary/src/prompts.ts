/**
 * Critic prompts and forced-tool schemas (R-137, R-138, D-75).
 *
 * Both passes open with the user's persona sentence, verbatim. The prompt
 * version is part of the critic-cache key (R-142), so any wording change here
 * MUST bump `CRITIC_PROMPT_VERSION` (and re-run calibration, R-145).
 *
 * The schemas are the `input_schema` of the single tool each pass is forced to
 * call (the D-55 pattern) — kept to the structured-output subset: no numeric or
 * length constraints, `additionalProperties: false` throughout.
 */

/** D-75 — verbatim. Do not edit without the user. */
export const PERSONA =
  'You are an adversarial reviewer with a single job: find defects, broken logic, and reasons this code will fail. Do not praise or suggest improvements.';

export const CRITIC_PROMPT_VERSION = 'v1';

export const CRITIC_PROMPTS: Record<string, { blind: string; reconcile: string }> = {
  v1: {
    blind: [
      PERSONA,
      '',
      'PASS 1 (blind). You are given ONE natural-language EARS requirement, the ODCS contract schema of',
      'each service that handles the entity it concerns, and those services’ live API coordinates.',
      'You are NOT shown the test. List every observable behaviour a correct end-to-end test of this',
      'requirement MUST check, so that a broken implementation cannot pass it.',
      '',
      'Rules:',
      '- One behaviour per item. `clause` is the exact, verbatim substring of the requirement it comes from.',
      '- `service` is the side that exhibits it (publisher or consumer); `fieldPath` names the contract',
      '  property it is observed on, when there is one. Never invent a property that is not in a schema.',
      '- Include the ways the behaviour can silently break across services (dropped, renamed, retyped or',
      '  stale fields; never propagated; propagated to the wrong record).',
      '- Call the `emit_expected_behaviours` tool exactly once; do not reply with prose.',
    ].join('\n'),
    reconcile: [
      PERSONA,
      '',
      'PASS 2 (reconcile). You are given the expected behaviours from an independent blind pass, the',
      'generated test PLAN, the emitted test FILE, and the findings already raised by deterministic checks.',
      'Report every defect: a behaviour the test does not verify, an assertion that cannot fail, an',
      'assertion that will fail against a correct system, wrong field pairing, wrong service, wrong',
      'correlation of the read-back record, unbounded or too-short waits, and broken logic in the file.',
      '',
      'Rules:',
      '- Each finding states the `defect` in one sentence and a concrete `failureScenario`: the input or',
      '  state under which the test passes while the system is broken, or fails while it is correct.',
      '- Give `evidence` (a verbatim quote, plan JSON pointer, or file line) whenever you can.',
      '- Do not repeat a deterministic finding unless you add a different failure scenario.',
      '- Report nothing that is not a defect. Never praise. Never suggest improvements.',
      '- Call the `emit_findings` tool exactly once; do not reply with prose. An empty list is allowed.',
    ].join('\n'),
  },
};

const ROLE = { type: 'string', enum: ['publisher', 'consumer'] } as const;

/** Pass 1 output: the expected behaviours. */
export const CRITIC_BLIND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['behaviours'],
  properties: {
    behaviours: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['clause', 'observable', 'service'],
        properties: {
          clause: { type: 'string' },
          observable: { type: 'string' },
          service: ROLE,
          fieldPath: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Pass 2 output: findings (posture-linted before use, R-140). */
export const CRITIC_FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'defect', 'failureScenario'],
        properties: {
          severity: { type: 'string', enum: ['Critical', 'Major', 'Minor'] },
          defect: { type: 'string' },
          failureScenario: { type: 'string' },
          evidence: { type: 'string' },
          line: { type: 'integer' },
        },
      },
    },
  },
} as const;
