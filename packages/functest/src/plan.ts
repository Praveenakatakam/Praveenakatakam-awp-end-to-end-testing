/**
 * The structured functional-test plan — the LLM's constrained output (R-117, R-117b, D-51, D-74).
 *
 * The LLM never writes test code. It emits a `FunctionalTestPlan`: a grounded,
 * machine-checkable description of ONE cross-service scenario (publisher writes →
 * CDC propagates → consumer reflects). `PLAN_SCHEMA` is both the Anthropic
 * structured-output schema (the model is forced to return this shape) and the
 * Ajv schema we re-validate against on the way in — a malformed or hallucinated
 * plan is rejected and the requirement is skipped (R-120), never emitted.
 *
 * v2 (R-117b) makes the plan attackable and executable: a concrete trigger
 * `payload`, a bounded read-back for propagation, and structured assertions
 * (`fieldPath` + `operator` + `expected` + the verbatim requirement `clause`).
 *
 * `inputHash`, `planSchemaVersion` and `targets` are NOT part of the model's
 * output; the core stamps them after synthesis (`stampPlan`) so a cached plan can
 * be matched to its exact inputs (R-119, R-119b) and rendered with each service's
 * mapped env-var names (D-31). Hence two shapes: `PlanBody` (what the LLM returns
 * / what PLAN_SCHEMA validates) and `FunctionalTestPlan` (what we store and render).
 */
import Ajv from 'ajv';
import type { GroundedContext } from './ground.js';

/**
 * Bump on any change to `PLAN_SCHEMA` or to the stored plan's shape or validation
 * rules; it is part of the plan-cache key (R-119b).
 *
 * v3: a stored plan carries `kind: 'functional'` (R-122), and the cross-field rules
 * added in T-58/T-59 are covered, so plans cached under v2 are re-synthesized.
 */
export const PLAN_SCHEMA_VERSION = 3;

/** Which side of the publisher → CDC → consumer flow a step or assertion concerns. */
export type Role = 'publisher' | 'consumer';

export interface PlanStep {
  /** A precondition or fixture the scenario assumes (e.g. "a writer access token"). */
  description: string;
}

/** Where an `equals` / `matchesType` assertion gets its expected value. */
export type Expected = { from: 'trigger.payload'; path: string } | { from: 'literal'; value: unknown };

export interface PlanAssertion {
  /** Which side observes this. */
  service: Role;
  /** Dotted path into that service's record; must be a contract property (R-133a). */
  fieldPath: string;
  operator: 'exists' | 'equals' | 'matchesType';
  /** Required for `equals` and `matchesType`. For `matchesType` it is a literal logicalType. */
  expected?: Expected;
  /** The verbatim requirement-text substring this assertion verifies (R-133c). */
  clause: string;
}

/** The LLM's output shape — exactly `PLAN_SCHEMA`, nothing stamped. */
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
    /** The concrete request body; keys are publisher contract properties (R-133b). */
    payload: Record<string, unknown>;
  };
  propagation: {
    kind: 'cdc';
    waitFor: string;
    timeoutSeconds: number;
    pollIntervalSeconds: number;
    /**
     * Where to read the propagated record back, and how it correlates with the trigger:
     * the read-back record's `matchOn` field equals the payload's `matchFrom` path
     * (default: `matchOn`). Services rename fields across the flow — e.g. the
     * publisher's `taskId` is get-ready's `id`.
     */
    readBack: { service: Role; path: string; matchOn: string; matchFrom?: string };
  };
  assertions: PlanAssertion[];
}

/** One service's runtime coordinates, stamped from the API mapping (D-31). */
export interface PlanTarget {
  role: Role;
  source: string;
  baseUrlEnv: string;
  tokenEnv: string;
  recordsAt: string;
  /** False when the source has no API mapping; env names are then conventional (OQ-15). */
  mapped: boolean;
}

/** A validated plan plus what the core stamps on it (R-119, R-119b, D-31). */
export interface FunctionalTestPlan extends PlanBody {
  /** Lets a consumer of the merged manifests dispatch on kind, as for §3.9 entries (R-122). */
  kind: 'functional';
  inputHash: string;
  planSchemaVersion: number;
  /** Sorted by role: consumer, publisher. */
  targets: PlanTarget[];
  /**
   * `service:fieldPath` of each assertion whose field the asserting service's contract
   * marks nullable, sorted; a `matchesType` check then also accepts null (T-59 F-02).
   * Omitted when empty.
   */
  nullable?: string[];
}

const ROLE = { type: 'string', enum: ['publisher', 'consumer'] } as const;

/**
 * JSON Schema for the plan body. Doubles as the Anthropic structured-output
 * format and the inbound Ajv guard. Kept to the subset structured outputs
 * support: `type`/`properties`/`required`/`enum`, `additionalProperties:false`,
 * no numeric/length constraints. Cross-field rules (e.g. `equals` needs
 * `expected`) are enforced in `validatePlan`.
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
      required: ['source', 'entity', 'method', 'path', 'payload'],
      properties: {
        source: { type: 'string' },
        entity: { type: 'string' },
        method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string' },
        payload: { type: 'object' },
      },
    },
    propagation: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'waitFor', 'timeoutSeconds', 'pollIntervalSeconds', 'readBack'],
      properties: {
        kind: { type: 'string', enum: ['cdc'] },
        waitFor: { type: 'string' },
        timeoutSeconds: { type: 'integer' },
        pollIntervalSeconds: { type: 'integer' },
        readBack: {
          type: 'object',
          additionalProperties: false,
          required: ['service', 'path', 'matchOn'],
          properties: { service: ROLE, path: { type: 'string' }, matchOn: { type: 'string' }, matchFrom: { type: 'string' } },
        },
      },
    },
    assertions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['service', 'fieldPath', 'operator', 'clause'],
        properties: {
          service: ROLE,
          fieldPath: { type: 'string' },
          operator: { type: 'string', enum: ['exists', 'equals', 'matchesType'] },
          expected: {
            type: 'object',
            additionalProperties: false,
            required: ['from'],
            properties: {
              from: { type: 'string', enum: ['trigger.payload', 'literal'] },
              path: { type: 'string' },
              value: {},
            },
          },
          clause: { type: 'string' },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
const validateBody = ajv.compile(PLAN_SCHEMA as object);

export type PlanValidation = { ok: true; body: PlanBody } | { ok: false; reason: string };

/**
 * Read a dotted path from a value; `undefined` when any segment is missing (a present `null` is a value).
 * `items[0].x` and `items.0.x` are the same path, as R-133a treats them; the emitted `at()` does the same.
 */
export function readPath(value: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<any>((o, k) => (o == null ? undefined : o[k]), value);
}

/** `tags[0].note` and `tags.0.note` → the contract's flattened `tags[].note`. */
function schemaPath(fieldPath: string): string {
  return fieldPath.replace(/\[\d+\]/g, '[]').replace(/\.\d+(?=\.|$)/g, '[]');
}

/**
 * A URL path the emitter can quote safely: a leading slash, then only URL path/query characters.
 * No backtick, `$`, quote, backslash or whitespace, so a model-written path can never become code
 * in the committed test file (code review F-07).
 */
const PLAIN_URL_PATH = /^\/[A-Za-z0-9._~/{}:@%?&=+,;#[\]-]*$/;

/** Cross-field rules the structured-output subset can't express. Returns a reason or undefined. */
function crossFieldError(body: PlanBody): string | undefined {
  if (!PLAIN_URL_PATH.test(body.trigger.path)) {
    return `malformed plan (trigger.path '${body.trigger.path}' is not a plain URL path)`;
  }
  if (!PLAIN_URL_PATH.test(body.propagation.readBack.path)) {
    return `malformed plan (readBack.path '${body.propagation.readBack.path}' is not a plain URL path)`;
  }
  for (const [i, a] of body.assertions.entries()) {
    // An expected value read from a payload key that is not there renders toEqual(undefined), which is
    // green whenever the consumer field is missing too (run 2 F-01).
    if (a.expected?.from === 'trigger.payload' && typeof a.expected.path === 'string' && readPath(body.trigger.payload, a.expected.path) === undefined) {
      return `malformed plan (assertion #${i}: expected.path '${a.expected.path}' is not a trigger.payload key)`;
    }
    if (a.operator !== 'exists' && !a.expected) {
      return `malformed plan (assertion #${i}: operator '${a.operator}' requires 'expected')`;
    }
    if (a.expected?.from === 'trigger.payload' && typeof (a.expected as { path?: unknown }).path !== 'string') {
      return `malformed plan (assertion #${i}: expected.from 'trigger.payload' requires 'path')`;
    }
    if (a.expected?.from === 'literal' && !('value' in a.expected)) {
      return `malformed plan (assertion #${i}: expected.from 'literal' requires 'value')`;
    }
    // A type check needs a literal logicalType; from the payload it renders an unpassable toBe("") (T-59 F-05).
    if (a.operator === 'matchesType' && a.expected?.from !== 'literal') {
      return `malformed plan (assertion #${i}: operator 'matchesType' requires expected.from 'literal')`;
    }
  }
  const { readBack, pollIntervalSeconds, timeoutSeconds } = body.propagation;
  // Consumer checks read the read-back record; anywhere else they read `undefined` (T-59 F-01).
  if (readBack.service !== 'consumer' && body.assertions.some((a) => a.service === 'consumer')) {
    return `malformed plan (consumer assertions require readBack.service 'consumer', got '${readBack.service}')`;
  }
  // The correlation value is read from the payload; a missing key matches nothing or the wrong record (T-59 F-03).
  const matchFrom = readBack.matchFrom ?? readBack.matchOn;
  if (readPath(body.trigger.payload, matchFrom) === undefined) {
    return `malformed plan (readBack.matchFrom '${matchFrom}' is not a trigger.payload key)`;
  }
  // Bounded wait: no busy loop and no zero-length window (T-59 F-08).
  if (!(timeoutSeconds >= 1)) return `malformed plan (propagation.timeoutSeconds must be >= 1, got ${timeoutSeconds})`;
  if (!(pollIntervalSeconds >= 1) || pollIntervalSeconds > timeoutSeconds) {
    return `malformed plan (propagation.pollIntervalSeconds must be between 1 and timeoutSeconds, got ${pollIntervalSeconds})`;
  }
  return undefined;
}

/**
 * Validate a raw LLM response against `PLAN_SCHEMA` AND its grounding: the
 * trigger must name the grounded entity and a known source (R-117 — "a plan
 * naming an unknown target is rejected"). Returns a skip reason instead of
 * throwing. Field-level grounding (fieldPath, payload keys, clauses) is the
 * adversarial stage's job (R-133), which reports rather than silently skipping.
 */
export function validatePlan(raw: unknown, grounded: { entity: string; sources: string[]; publisher?: string }): PlanValidation {
  if (!validateBody(raw)) {
    const first = validateBody.errors?.[0];
    const where = first?.instancePath || '/';
    return { ok: false, reason: `malformed plan (schema ${where}: ${first?.message ?? 'invalid'})` };
  }
  // `exists` never reads `expected` (emit, grounding, mutation all ignore it). Models
  // sometimes attach a vestigial `{from: "literal"}` to it; drop it rather than reject
  // the whole plan (T-49 live finding: both groundable plans were lost this way).
  const body: PlanBody = {
    ...(raw as PlanBody),
    assertions: (raw as PlanBody).assertions.map((a) => {
      if (a.operator !== 'exists' || a.expected === undefined) return a;
      const { expected: _stray, ...rest } = a;
      return rest;
    }),
  };
  const crossField = crossFieldError(body);
  if (crossField) return { ok: false, reason: crossField };
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
  if (grounded.publisher !== undefined && body.trigger.source !== grounded.publisher) {
    return {
      ok: false,
      reason: `role inversion: trigger source '${body.trigger.source}' is not the declared publisher '${grounded.publisher}' of '${grounded.entity}'`,
    };
  }
  return { ok: true, body };
}

/** A stored plan minus everything the core stamps: the shape `PLAN_SCHEMA` validates. */
export function planBodyOf(plan: FunctionalTestPlan): PlanBody {
  const { kind: _kind, inputHash: _hash, planSchemaVersion: _version, targets: _targets, nullable: _nullable, ...body } = plan;
  return body;
}

/** Conventional env-var stem for a source with no API mapping: `get-ready` → `GET_READY`. */
export function envStem(source: string): string {
  return source.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/**
 * Stamp a validated body into a stored plan: the input hash (R-119), the plan
 * schema version (R-119b), and per-role runtime targets from the API mapping
 * (D-31). The publisher is the trigger's source (validated to be the declared
 * publisher); the consumer is the declared consumer (R-117c), never inferred
 * from source order. `requirementIds` is overwritten with the grounded
 * requirement's canonical `{source}/{id}` (R-117d). A source without a mapping
 * gets conventional env names and `mapped: false` (OQ-15), which the
 * adversarial stage reports.
 */
export function stampPlan(body: PlanBody, ctx: GroundedContext): FunctionalTestPlan {
  const roleSources: [Role, string][] = [
    ['consumer', ctx.roles.consumer],
    ['publisher', body.trigger.source],
  ];
  const targets: PlanTarget[] = roleSources.map(([role, source]) => {
    const mapped = ctx.apiTargets.find((t) => t.source === source)?.target;
    return mapped
      ? { role, source, baseUrlEnv: mapped.baseUrlEnv, tokenEnv: mapped.tokenEnv, recordsAt: mapped.recordsAt, mapped: true }
      : { role, source, baseUrlEnv: `${envStem(source)}_API_URL`, tokenEnv: `${envStem(source)}_TOKEN`, recordsAt: '', mapped: false };
  });
  const requirementIds = [`${ctx.requirement.source}/${ctx.requirement.id}`];
  const sourceOf: Record<Role, string> = { publisher: body.trigger.source, consumer: ctx.roles.consumer };
  // A nested field (`tags[0].note`) is looked up in the flattened schema as `tags[].note`; a context built
  // without it falls back to the top-level properties, as before.
  const isNullable = (service: Role, fieldPath: string): boolean => {
    const source = sourceOf[service];
    const flat = ctx.flatSchemasBySource?.[source];
    if (flat) return flat.some((p) => p.name === schemaPath(fieldPath) && p.nullable);
    return ctx.schemasBySource[source]?.some((p) => p.name === fieldPath && p.nullable) ?? false;
  };
  const nullable = [...new Set(body.assertions.filter((a) => isNullable(a.service, a.fieldPath)).map((a) => `${a.service}:${a.fieldPath}`))].sort();
  return {
    ...body,
    requirementIds,
    kind: 'functional',
    inputHash: ctx.inputHash,
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    targets,
    ...(nullable.length ? { nullable } : {}),
  };
}
