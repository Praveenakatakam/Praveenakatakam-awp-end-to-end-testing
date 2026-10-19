/**
 * The structured critique — output contract for pipeline steps with
 * `outputType: "critique"` (R-60, R-62, D-22).
 *
 * A critique step reviews prior step outputs (typically a plan) and returns a
 * verdict plus concrete issues instead of re-emitting a plan. `CRITIQUE_SCHEMA`
 * is both the Bedrock forced-tool `input_schema` (`emit_critique`) and the Ajv
 * guard the step worker re-validates against before writing/caching (R-64).
 * Kept to the structured-output-safe subset, like `PLAN_SCHEMA`.
 */
import Ajv from 'ajv';

export type CritiqueVerdict = 'approve' | 'revise' | 'reject';
export type CritiqueSeverity = 'blocker' | 'major' | 'minor';

export interface CritiqueIssue {
  severity: CritiqueSeverity;
  /** What the issue is about, e.g. `trigger.path` or `assertions[1]`. */
  target: string;
  problem: string;
  suggestion: string;
}

export interface Critique {
  verdict: CritiqueVerdict;
  summary: string;
  issues: CritiqueIssue[];
}

export const CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'issues'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise', 'reject'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'target', 'problem', 'suggestion'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          target: { type: 'string' },
          problem: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true });
const validateBody = ajv.compile(CRITIQUE_SCHEMA as object);

export type CritiqueValidation = { ok: true; body: Critique } | { ok: false; reason: string };

/** Validate a raw critique against `CRITIQUE_SCHEMA` (R-62, R-64). */
export function validateCritique(raw: unknown): CritiqueValidation {
  if (!validateBody(raw)) {
    const first = validateBody.errors?.[0];
    const where = first?.instancePath || '/';
    return { ok: false, reason: `malformed critique (schema ${where}: ${first?.message ?? 'invalid'})` };
  }
  return { ok: true, body: raw as Critique };
}
