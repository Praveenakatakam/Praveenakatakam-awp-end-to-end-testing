/**
 * Semantic per-property contract diff (T-05 · R-53, D-18).
 *
 * Walks the parsed ODCS `schema[0].properties` of two variants and reports
 * which properties were added, removed, or changed — by dotted path
 * (`entity.property`). Property order is normalised (keyed by name), so YAML
 * re-ordering does not register as a change, unlike a raw text diff.
 *
 * "Changed" compares a small set of contract-meaningful fields per property:
 * `required`, `logicalType`, `physicalType`, and the enum `validValues`
 * derived from the property's ODCS data-quality rules.
 */

import { normalizeContractSchema, COMPARED_FIELDS } from "./schema-model.js";

export interface PropRef {
  /** Dotted path `entity.property`. */
  path: string;
}
export interface PropChange {
  path: string;
  field: string;
  a: unknown;
  b: unknown;
}
export interface EntityDiff {
  /** Properties present only in the first contract (A). */
  onlyInA: PropRef[];
  /** Properties present only in the second contract (B). */
  onlyInB: PropRef[];
  /** Properties in both whose compared fields differ. */
  changed: PropChange[];
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function diffContracts(a: unknown, b: unknown): EntityDiff {
  const A = normalizeContractSchema(a);
  const B = normalizeContractSchema(b);
  const entity = A.entity || B.entity;
  const path = (name: string) => `${entity}.${name}`;

  const onlyInA: PropRef[] = [];
  const onlyInB: PropRef[] = [];
  const changed: PropChange[] = [];

  for (const [name, pa] of A.props) {
    const pb = B.props.get(name);
    if (!pb) {
      onlyInA.push({ path: path(name) });
      continue;
    }
    for (const field of COMPARED_FIELDS) {
      if (!eq(pa[field], pb[field])) {
        changed.push({ path: path(name), field, a: pa[field], b: pb[field] });
      }
    }
  }
  for (const name of B.props.keys()) {
    if (!A.props.has(name)) onlyInB.push({ path: path(name) });
  }

  return { onlyInA, onlyInB, changed };
}
