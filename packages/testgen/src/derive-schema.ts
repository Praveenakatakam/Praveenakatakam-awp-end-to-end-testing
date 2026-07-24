/**
 * ODCS `schema[]` → embedded JSON Schema for conformance validation (T-19 · R-83, D-30).
 *
 * The registry does not compile ODCS to JSON Schema (D-11/D-20), so the
 * generator derives a minimal JSON Schema from the contract's property model
 * (reusing `normalizeContractSchema`) and embeds it in the manifest. The emitted
 * conformance test validates each live API record against it with Ajv.
 *
 * `additionalProperties: true` — a live record carrying extra fields must not
 * fail conformance (consistent with the "extra allowed" stance of R-84); the
 * test asserts the CONTRACT's fields are present and well-typed, not that the
 * record is exactly the contract.
 */
import { normalizeContractSchema } from '@registry/core';
import type { JsonSchema } from './manifest.js';

/** Map an ODCS `logicalType` to a JSON-Schema type (+ format for dates). */
function jsonType(logicalType?: string): { type?: string; format?: string } {
  switch ((logicalType ?? '').toLowerCase()) {
    case 'string':
      return { type: 'string' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'object':
      return { type: 'object' };
    case 'array':
      return { type: 'array' };
    default:
      return {}; // unknown/absent → no type constraint
  }
}

export function deriveJsonSchema(doc: unknown): JsonSchema {
  const { props } = normalizeContractSchema(doc);
  const required: string[] = [];
  const properties: JsonSchema['properties'] = {};

  // Deterministic property order (R-88): sort by name.
  for (const name of [...props.keys()].sort()) {
    const p = props.get(name)!;
    if (p.required) required.push(name);
    const t = jsonType(p.logicalType);
    properties[name] = { ...t, ...(p.validValues ? { enum: p.validValues } : {}) };
  }

  return { type: 'object', required, properties, additionalProperties: true };
}
