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
  /** Present (true) only when the contract marks the property nullable (customProperties nullable="true"). */
  nullable?: true;
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

function normProp(p: any, name: string, required: boolean): NormProp {
  return {
    name,
    required,
    logicalType: typeof p.logicalType === 'string' ? p.logicalType : undefined,
    physicalType: typeof p.physicalType === 'string' ? p.physicalType : undefined,
    validValues: enumValues(p),
    ...(isNullable(p) ? { nullable: true as const } : {}),
  };
}

/**
 * Flatten a parsed ODCS doc's first schema object to dotted property paths
 * (R-84d, D-86): an object's `properties` → `parent.child`, an array's
 * `items.properties` → `parent[].child`. A nested property is required only
 * when it and every ancestor are. Sorted by code point (locale-independent,
 * R-88). The differ (R-53) keeps the top-level `normalizeContractSchema`.
 */
export function flattenContractProperties(doc: unknown): NormProp[] {
  const schema = (doc as any)?.schema;
  const first = Array.isArray(schema) ? schema[0] : undefined;
  const out: NormProp[] = [];
  const walk = (list: unknown, prefix: string, ancestorsRequired: boolean, expanding: ReadonlySet<unknown>) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (!p || typeof p.name !== 'string') continue;
      const name = `${prefix}${p.name}`;
      const required = ancestorsRequired && p.required === true;
      out.push(normProp(p, name, required));
      walk(p.properties, `${name}.`, required, expanding);
      // A sibling object already being expanded on this path is a cycle: leave the repeat undeclared (NFR-4).
      const sibling = resolveItemsProperties(p, doc, expanding);
      if (sibling) walk(sibling, `${name}[].`, required, new Set([...expanding, sibling]));
      else if (p.items && typeof p.items === 'object') walk(p.items.properties, `${name}[].`, required, expanding);
    }
  };
  walk(first?.properties, '', true, new Set());
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** ODCS has no native nullable flag; contracts declare it as customProperties `{property: nullable, value: "true"}`. */
export function isNullable(prop: any): boolean {
  const custom = Array.isArray(prop?.customProperties) ? prop.customProperties : [];
  return custom.some((c: any) => c?.property === 'nullable' && String(c?.value).toLowerCase() === 'true');
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
      ...(isNullable(p) ? { nullable: true as const } : {}),
    });
  }
  return { entity, props };
}

/**
 * The properties of an array property's item type, when the contract describes them in a sibling
 * `schema[]` object instead of inline under `items.properties` (review run 20261013-1055).
 *
 * Contracts such as `create.content-events` declare `items` as a bare array and say, in its
 * description, "Ordered list of TaskPublishedItem objects", with `TaskPublishedItem` as the next
 * `schema[]` entry. An explicit `items.properties` always wins. Otherwise the description is searched
 * for the whole-word name of another object in the SAME document (the entity under test, `schema[0]`,
 * is never taken); a name that is not in this document resolves to nothing, so a projection that only
 * mentions another contract's type (get-ready) stays undeclared rather than guessed.
 */
export function resolveItemsProperties(prop: any, doc: unknown, expanding: ReadonlySet<unknown> = new Set()): any[] | undefined {
  if (!prop || String(prop.logicalType ?? '').toLowerCase() !== 'array') return undefined;
  if (Array.isArray(prop.items?.properties) && prop.items.properties.length) return undefined;
  const description = typeof prop.description === 'string' ? prop.description : '';
  const schema = (doc as any)?.schema;
  if (!description || !Array.isArray(schema)) return undefined;
  for (const object of schema.slice(1)) {
    if (typeof object?.name !== 'string' || !Array.isArray(object.properties) || object.properties.length === 0) continue;
    const escaped = object.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(description)) {
      // `expanding` holds the sibling objects already being expanded on this path: naming one of them
      // again (itself, or A → B → A) is a cycle, left undeclared rather than followed forever (NFR-4).
      return expanding.has(object.properties) ? undefined : object.properties;
    }
  }
  return undefined;
}
