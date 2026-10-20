/**
 * ODCS `schema[]` → embedded JSON Schema for conformance validation (T-19 · R-83, D-30).
 *
 * The registry does not compile ODCS to JSON Schema (D-11/D-20), so the
 * generator derives a minimal JSON Schema from the contract's `schema[0]`
 * properties — nested objects and array items included (R-83c, D-86) — and
 * embeds it in the manifest. The emitted
 * conformance test validates each live API record against it with Ajv.
 *
 * A property's `logicalTypeOptions` (minItems, format: uuid, pattern, length and
 * range bounds) are carried into the schema, so a record that breaks a declared
 * constraint fails conformance instead of passing on `type` alone.
 *
 * `additionalProperties: true` — a live record carrying extra fields must not
 * fail conformance (consistent with the "extra allowed" stance of R-84); the
 * test asserts the CONTRACT's fields are present and well-typed, not that the
 * record is exactly the contract.
 */
import { compareCodePoint, enumValues, isNullable, resolveItemsProperties } from '@registry/core';
import type { JsonSchema, JsonSchemaProp } from './manifest.js';

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
      return { type: 'string', format: 'date' };
    case 'timestamp':
      return { type: 'string', format: 'date-time' };
    case 'time':
      return { type: 'string', format: 'time' };
    case 'object':
      return { type: 'object' };
    case 'array':
      return { type: 'array' };
    default:
      return {}; // unknown/absent → no type constraint
  }
}

/** Raw ODCS property list → `{required, properties}`, recursing into objects and array items (R-83c). */
function deriveProps(list: unknown, doc: unknown, expanding: ReadonlySet<unknown> = new Set()): { required: string[]; properties: Record<string, JsonSchemaProp> } {
  const required: string[] = [];
  const properties: Record<string, JsonSchemaProp> = {};
  const raw = (Array.isArray(list) ? list : []).filter((p: any) => p && typeof p.name === 'string');
  // Deterministic property order (R-88): sort by name.
  for (const p of [...raw].sort((a: any, b: any) => compareCodePoint(a.name, b.name)) as any[]) {
    if (p.required === true) required.push(p.name);
    properties[p.name] = deriveProp(p, doc, expanding);
  }
  return { required, properties };
}

/** Formats `ajv-formats` registers; any other `format` would make Ajv throw at compile time. */
const KNOWN_FORMATS = new Set(['date', 'time', 'date-time', 'duration', 'uri', 'uri-reference', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid', 'regex']);

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The enforceable subset of a property's ODCS `logicalTypeOptions` (R-83): an
 * option Ajv cannot compile (unknown format, invalid regex, wrong-typed value)
 * is dropped rather than allowed to break the whole conformance test.
 */
function deriveConstraints(options: unknown): Partial<JsonSchemaProp> {
  if (!options || typeof options !== 'object') return {};
  const o = options as Record<string, unknown>;
  const out: Partial<JsonSchemaProp> = {};
  if (typeof o.format === 'string' && KNOWN_FORMATS.has(o.format)) out.format = o.format;
  if (isCount(o.minLength)) out.minLength = o.minLength;
  if (isCount(o.maxLength)) out.maxLength = o.maxLength;
  if (typeof o.pattern === 'string') {
    try {
      new RegExp(o.pattern, 'u');
      out.pattern = o.pattern;
    } catch {
      /* invalid regex: unenforceable, drop */
    }
  }
  if (isNum(o.minimum)) out.minimum = o.minimum;
  if (isNum(o.maximum)) out.maximum = o.maximum;
  if (isNum(o.exclusiveMinimum)) out.exclusiveMinimum = o.exclusiveMinimum;
  if (isNum(o.exclusiveMaximum)) out.exclusiveMaximum = o.exclusiveMaximum;
  if (isCount(o.minItems)) out.minItems = o.minItems;
  if (isCount(o.maxItems)) out.maxItems = o.maxItems;
  if (o.uniqueItems === true) out.uniqueItems = true;
  return out;
}

function deriveProp(p: any, doc: unknown, expanding: ReadonlySet<unknown> = new Set()): JsonSchemaProp {
  const values = enumValues(p);
  const t = jsonType(p.logicalType);
  // A nullable property (customProperties nullable="true") also accepts null (T-59 F-06).
  const nullable = isNullable(p);
  const out: JsonSchemaProp = {
    ...t,
    ...(nullable && t.type ? { type: [t.type, 'null'] } : {}),
    ...(values ? { enum: nullable ? [...values, null] : values } : {}),
    ...deriveConstraints(p.logicalTypeOptions),
  };
  if (Array.isArray(p.properties) && p.properties.length) Object.assign(out, deriveProps(p.properties, doc, expanding));
  // An array whose item object is a sibling schema object, named in its description (review run 20261013-1055).
  const sibling = resolveItemsProperties(p, doc, expanding);
  if (sibling) out.items = { type: 'object', ...deriveProps(sibling, doc, new Set([...expanding, sibling])) };
  else if (p.items && typeof p.items === 'object') out.items = deriveProp(p.items, doc, expanding);
  return out;
}

export function deriveJsonSchema(doc: unknown): JsonSchema {
  const schema = (doc as any)?.schema;
  const first = Array.isArray(schema) ? schema[0] : undefined;
  const { required, properties } = deriveProps(first?.properties, doc);
  return { type: 'object', required, properties, additionalProperties: true };
}
