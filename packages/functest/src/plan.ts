/**
 * The structured functional-test plan — the LLM's constrained output (R-117, D-51).
 *
 * The LLM never writes test code. It emits a `FunctionalTestPlan`: a grounded,
 * machine-checkable description of ONE cross-service scenario (publisher writes →
 * CDC propagates → consumer reflects). `PLAN_SCHEMA` is both the Anthropic
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
  /** Which side observes this — "publisher" or "consumer". */
  service: string;
  /** What must hold after propagation (natural language; a runner/human fills the glue). */
  assertion: string;
}

/** The LLM's output shape — exactly `PLAN_SCHEMA`, no `inputHash`. */
export interface PlanBody {
  requirementIds: string[];
  title: string;
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
  };
  propagation: { kind: 'cdc'; waitFor: string };
  assertions: PlanAssertion[];
}

/** A validated plan plus the input hash that keys its cache entry (R-119). */
export interface FunctionalTestPlan extends PlanBody {
  inputHash: string;
}

/**
 * JSON Schema for the plan body. Doubles as the Anthropic structured-output
 * format and the inbound Ajv guard. Kept to the subset structured outputs
 * support: `type`/`properties`/`required`/`enum`, `additionalProperties:false`,
 * no numeric/length constraints.
 */
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['requirementIds', 'title', 'setup', 'trigger', 'propagation', 'assertions'],
  properties: {
    requirementIds: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
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
      },
    },
    propagation: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'waitFor'],
      properties: {
        kind: { type: 'string', enum: ['cdc'] },
        waitFor: { type: 'string' },
      },
    },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'assertion'],
        properties: {
          service: { type: 'string', enum: ['publisher', 'consumer'] },
          assertion: { type: 'string' },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
const validateBody = ajv.compile(PLAN_SCHEMA as object);

export type PlanValidation = { ok: true; body: PlanBody } | { ok: false; reason: string };

/**
 * Validate a raw LLM response against `PLAN_SCHEMA` AND its grounding: the
 * trigger must name the grounded entity and a known source, and every assertion
 * must target a real service (R-117 — "a plan naming an unknown target is
 * rejected"). Returns a skip reason instead of throwing.
 */
export function validatePlan(raw: unknown, grounded: { entity: string; sources: string[] }): PlanValidation {
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
  return { ok: true, body };
}
