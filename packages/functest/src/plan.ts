/**
 * The structured functional-test plan — the LLM's constrained output (R-117, D-51).
 *
 * The LLM never writes test code. It emits a `FunctionalTestPlan`: a grounded,
 * machine-checkable description of ONE cross-service scenario (a source writes →
 * CDC / EventBridge / sync propagates → other sources reflect). v2 (R-61) adds
 * `rationale`, `examplePayload`, `propagation.channel`, property-level
 * assertions and `negativeCases` on top of v1. `PLAN_SCHEMA` is both the Anthropic
 * structured-output schema (the model is forced to return this shape) and the
 * Ajv schema we re-validate against on the way in — a malformed or hallucinated
 * plan is rejected and the requirement is skipped (R-120), never emitted.
 *
 * `inputHash` is NOT part of the model's output; the core stamps it after
 * synthesis so a cached plan can be matched to its exact inputs (R-119). Hence
 * two shapes: `PlanBody` (what the LLM returns / what PLAN_SCHEMA validates) and
 * `FunctionalTestPlan` (`PlanBody` + `inputHash`, what we store and render).
 */
import Ajv from 'ajv';

export interface PlanStep {
  /** A precondition or fixture the scenario assumes (e.g. "a writer access token"). */
  description: string;
}

export interface PlanAssertion {
  /** Which service observes this — must be one of the grounded sources (R-61, R-64). */
  service: string;
  /** What must hold after propagation (natural language; a runner/human fills the glue). */
  assertion: string;
  /** Optional property-level check: the contract field asserted on (v2). */
  field?: string;
  /** Optional property-level check: the expected value (v2). */
  expected?: string;
}

/** A negative scenario the test should also cover (v2). */
export interface PlanNegativeCase {
  description: string;
  expectedOutcome: string;
}

/** How the trigger's effect reaches the observing services (v2 widens v1's `cdc`). */
export type PropagationKind = 'cdc' | 'eventbridge' | 'sync';

/** The LLM's output shape — exactly `PLAN_SCHEMA`, no `inputHash`. */
export interface PlanBody {
  requirementIds: string[];
  title: string;
  /**
   * Why this scenario exercises the requirement (v2). Required for model output;
   * absent on v1 plans stored before v0.4.0 (D-25).
   */
  rationale?: string;
  setup: PlanStep[];
  trigger: {
    /** The service that performs the write — must be a known catalog source. */
    source: string;
    /** The entity written — must be the grounded entity (no hallucinated targets). */
    entity: string;
    method: string;
    path: string;
    /** A description of the request body shape (not a literal payload). */
    payloadShape: string;
    /** A concrete JSON example body built only from contract schema properties (v2). */
    examplePayload?: string;
  };
  propagation: {
    kind: PropagationKind;
    waitFor: string;
    /** e.g. event bus / detail-type (v2). */
    channel?: string;
  };
  assertions: PlanAssertion[];
  negativeCases?: PlanNegativeCase[];
}

/** A validated plan plus the input hash that keys its cache entry (R-119). */
export interface FunctionalTestPlan extends PlanBody {
  inputHash: string;
}

/**
 * JSON Schema for the plan body — v2 (R-61, D-25). Doubles as the Anthropic
 * structured-output format and the inbound Ajv guard. Kept to the subset
 * structured outputs support: `type`/`properties`/`required`/`enum`,
 * `additionalProperties:false`, no numeric/length constraints.
 *
 * Strict superset of v1: every v1 field is retained; new fields are optional
 * except `rationale`, which is required of the MODEL. Stored/cached v1 plans are
 * validated with `{ requireRationale: false }`. `assertions[].service` is no
 * longer an enum — it is checked at runtime against the grounded sources.
 */
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirementIds', 'title', 'rationale', 'setup', 'trigger', 'propagation', 'assertions'],
  properties: {
    requirementIds: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
    rationale: { type: 'string' },
    setup: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description'],
        properties: { description: { type: 'string' } },
      },
    },
    trigger: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'entity', 'method', 'path', 'payloadShape'],
      properties: {
        source: { type: 'string' },
        entity: { type: 'string' },
        method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string' },
        payloadShape: { type: 'string' },
        examplePayload: { type: 'string' },
      },
    },
    propagation: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'waitFor'],
      properties: {
        kind: { type: 'string', enum: ['cdc', 'eventbridge', 'sync'] },
        waitFor: { type: 'string' },
        channel: { type: 'string' },
      },
    },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'assertion'],
        properties: {
          service: { type: 'string' },
          assertion: { type: 'string' },
          field: { type: 'string' },
          expected: { type: 'string' },
        },
      },
    },
    negativeCases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'expectedOutcome'],
        properties: {
          description: { type: 'string' },
          expectedOutcome: { type: 'string' },
        },
      },
    },
  },
} as const;

/** v2 schema minus the `rationale` requirement — for stored/cached v1 plans (D-25). */
const STORED_PLAN_SCHEMA = {
  ...PLAN_SCHEMA,
  required: PLAN_SCHEMA.required.filter((k) => k !== 'rationale'),
};

const ajv = new Ajv({ allErrors: true });
const validateModelBody = ajv.compile(PLAN_SCHEMA as object);
const validateStoredBody = ajv.compile(STORED_PLAN_SCHEMA as object);

export type PlanValidation = { ok: true; body: PlanBody } | { ok: false; reason: string };

export interface ValidatePlanOptions {
  /**
   * Require the v2 `rationale` field (default `true` — model output). Pass
   * `false` when re-validating stored/cached plans that may predate v2 (D-25).
   */
  requireRationale?: boolean;
}

/**
 * Validate a raw LLM response against `PLAN_SCHEMA` AND its grounding: the
 * trigger must name the grounded entity and a known source, and every assertion
 * must target a grounded source (R-117, R-64 — "a plan naming an unknown target
 * is rejected"). Returns a skip reason instead of throwing.
 */
export function validatePlan(
  raw: unknown,
  grounded: { entity: string; sources: string[] },
  opts: ValidatePlanOptions = {}
): PlanValidation {
  const validateBody = opts.requireRationale === false ? validateStoredBody : validateModelBody;
  if (!validateBody(raw)) {
    const first = validateBody.errors?.[0];
    const where = first?.instancePath || '/';
    return { ok: false, reason: `malformed plan (schema ${where}: ${first?.message ?? 'invalid'})` };
  }
  const body = raw as PlanBody;
  if (body.trigger.entity !== grounded.entity) {
    return {
      ok: false,
      reason: `hallucinated target: trigger entity '${body.trigger.entity}' ≠ grounded '${grounded.entity}'`,
    };
  }
  if (!grounded.sources.includes(body.trigger.source)) {
    return {
      ok: false,
      reason: `hallucinated target: trigger source '${body.trigger.source}' is not a catalog source`,
    };
  }
  const stray = body.assertions.find((a) => !grounded.sources.includes(a.service));
  if (stray) {
    return {
      ok: false,
      reason: `hallucinated target: assertion service '${stray.service}' is not a grounded source (${grounded.sources.join(', ')})`,
    };
  }
  return { ok: true, body };
}
