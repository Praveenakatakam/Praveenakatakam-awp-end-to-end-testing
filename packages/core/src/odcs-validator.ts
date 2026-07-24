/**
 * ODCS v3.1.0 validation (T-02 · R-20, R-21).
 *
 * The registry validates every crawled `*.odcs.yaml` document against the
 * vendored official ODCS v3.1.0 JSON Schema (draft 2019-09) — the validation
 * oracle. Parsing and validation NEVER throw: malformed YAML or a
 * schema-violating contract is returned as `validation: "invalid"` with a
 * structured error list, so one bad contract is cataloged, not dropped, and
 * never aborts a crawl (design §1, D-9).
 */
import yaml from 'js-yaml';
import Ajv2019, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2019.js';
import addFormats from 'ajv-formats';
// Plain JSON import (resolveJsonModule) — esbuild-compatible for the Lambda
// bundle; the `with { type: "json" }` attribute form is not supported by SST's
// bundler.
import odcsSchema from '../resources/odcs-v3.1.0.schema.json';

/** One structured validation failure (design §3 — surfaced in the catalog). */
export interface ValidationError {
  /** JSON Pointer to the offending node (e.g. "/schema/0/properties"), or "" at root. */
  path: string;
  /** The failing rule: an Ajv keyword ("required", "enum", …) or "parse" for YAML errors. */
  keyword: string;
  message: string;
}

export interface ValidationResult {
  /** The parsed document when YAML parsing succeeded; undefined on a parse error. */
  parsed?: unknown;
  validation: 'valid' | 'invalid';
  errors: ValidationError[];
}

// Compile the ODCS meta-schema once at module load (reused across every crawl).
const ajv = new (Ajv2019 as unknown as typeof import('ajv/dist/2019.js').default)({
  strict: false,
  allErrors: true,
});
addFormats(ajv as any);
const validateOdcs: ValidateFunction = ajv.compile(odcsSchema as object);

function toError(e: ErrorObject): ValidationError {
  // For `required`, surface the missing property name in the message so callers
  // (and tests) can identify it without walking params.
  const missing =
    e.keyword === 'required' && e.params && 'missingProperty' in e.params
      ? ` (${(e.params as { missingProperty: string }).missingProperty})`
      : '';
  return {
    path: e.instancePath ?? '',
    keyword: e.keyword,
    message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${missing}`.trim(),
  };
}

/**
 * Parse `bytes` as YAML and validate against ODCS v3.1.0.
 * Returns a structured result; never throws.
 */
export function parseAndValidate(bytes: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(bytes);
  } catch (err) {
    return {
      validation: 'invalid',
      errors: [{ path: '', keyword: 'parse', message: `YAML parse error: ${(err as Error).message}` }],
    };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return {
      parsed,
      validation: 'invalid',
      errors: [{ path: '', keyword: 'parse', message: 'document is not a YAML mapping' }],
    };
  }

  const ok = validateOdcs(parsed);
  if (ok) return { parsed, validation: 'valid', errors: [] };
  return {
    parsed,
    validation: 'invalid',
    errors: (validateOdcs.errors ?? []).map(toError),
  };
}
