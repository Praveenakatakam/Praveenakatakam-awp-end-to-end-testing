/**
 * Shared ODCS property model (T-18 · R-84a, R-53).
 *
 * Normalises a parsed ODCS document's first `schema[]` object into an
 * order-independent map of contract-meaningful property facts. Extracted from
 * the semantic differ (`diff.ts`) so the differ (R-53) and the test generator's
 * compatibility check (`@registry/testgen`, R-84) share ONE property model and
 * cannot drift apart.
 *
 * "Contract-meaningful" fields compared here: `required`, `logicalType`,
 * `physicalType`, and the enum `validValues` derived from a property's ODCS
 * data-quality rules. Property order is normalised (keyed by name), so YAML
 * re-ordering never registers as a change.
 */

export interface NormProp {
  name: string;
  required: boolean;
  logicalType?: string;
  physicalType?: string;
  validValues?: unknown[];
}

export interface NormSchema {
  /** `schema[0].name`, or "" when absent. */
  entity: string;
  /** Properties keyed by name (order-independent). */
  props: Map<string, NormProp>;
}

/** The property facts the differ + compat check compare. */
export const COMPARED_FIELDS: (keyof NormProp)[] = ['required', 'logicalType', 'physicalType', 'validValues'];

/** Extract the enum allowed-set from a property's ODCS data-quality rules. */
export function enumValues(prop: any): unknown[] | undefined {
  const rules = Array.isArray(prop?.quality) ? prop.quality : [];
  for (const r of rules) {
    const vv = r?.arguments?.validValues;
    if (Array.isArray(vv)) return vv;
  }
  return undefined;
}

/** Normalise a parsed ODCS doc's first schema object into `{entity, props}`. */
export function normalizeContractSchema(doc: unknown): NormSchema {
  const schema = (doc as any)?.schema;
  const first = Array.isArray(schema) ? schema[0] : undefined;
  const entity = typeof first?.name === 'string' ? first.name : '';
  const props = new Map<string, NormProp>();
  const list = Array.isArray(first?.properties) ? first.properties : [];
  for (const p of list) {
    if (!p || typeof p.name !== 'string') continue;
    props.set(p.name, {
      name: p.name,
      required: p.required === true,
      logicalType: typeof p.logicalType === 'string' ? p.logicalType : undefined,
      physicalType: typeof p.physicalType === 'string' ? p.physicalType : undefined,
      validValues: enumValues(p),
    });
  }
  return { entity, props };
}
