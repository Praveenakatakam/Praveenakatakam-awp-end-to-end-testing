/**
 * Cross-app compatibility check — consumer-can-read-publisher (T-19 · R-84, R-84a, D-24).
 *
 * Directional, matching the CDC data flow (publisher emits → consumer reads):
 * every property the CONSUMER's contract marks `required` must be present in the
 * PUBLISHER's contract and share the same logical type. Extra publisher
 * properties are allowed (E-26); a missing or type-incompatible required
 * consumer property is a violation (E-25).
 *
 * v0.8.0: properties are compared by dotted path, nested included (R-84d,
 * `flattenContractProperties`), and a declared field map (publisher → consumer,
 * R-84c) lets a consumer property be satisfied by its renamed publisher
 * counterpart. A map entry on a parent path renames its descendants.
 */
import { flattenContractProperties, normalizeContractSchema } from '@registry/core';
import type { CompatProp } from './manifest.js';

export interface CompatViolation {
  /** `entity.property`. */
  path: string;
  reason: string;
}

export interface CompatResult {
  entity: string;
  compatible: boolean;
  violations: CompatViolation[];
  /** Consumer's required properties (embedded into the emitted test). */
  consumerRequired: CompatProp[];
  /** Publisher's properties, name → logicalType (embedded into the emitted test). */
  publisherProps: CompatProp[];
  /** Consumer path → publisher path, for each consumer-required path the field map renames (sorted keys). */
  fieldMap: Record<string, string>;
}

/** Translate a consumer path to its publisher path via the longest mapped prefix. */
function toPublisherPath(conPath: string, conToPub: [string, string][]): string {
  for (const [con, pub] of conToPub) {
    if (conPath === con) return pub;
    for (const sep of ['.', '[].']) {
      if (conPath.startsWith(con + sep)) return pub + conPath.slice(con.length);
    }
  }
  return conPath;
}

const byName = (a: CompatProp, b: CompatProp) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** `fields` is the flow's map, publisher property → consumer property (R-84c). */
export function checkCompat(consumerDoc: unknown, publisherDoc: unknown, fields: Record<string, string> = {}): CompatResult {
  const entity = normalizeContractSchema(consumerDoc).entity || normalizeContractSchema(publisherDoc).entity;
  const consumer = flattenContractProperties(consumerDoc);
  const publisher = new Map(flattenContractProperties(publisherDoc).map((p) => [p.name, p]));
  const conToPub = Object.entries(fields)
    .map(([pub, con]) => [con, pub] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);

  // logicalType is compared case-insensitively, as derive-schema reads it (T-59 F-09).
  const lt = (t?: string) => (t === undefined ? undefined : t.toLowerCase());
  const consumerRequired: CompatProp[] = consumer
    .filter((p) => p.required)
    .map((p) => ({ name: p.name, logicalType: lt(p.logicalType) }))
    .sort(byName);
  const publisherProps: CompatProp[] = [...publisher.values()].map((p) => ({ name: p.name, logicalType: lt(p.logicalType) })).sort(byName);

  const fieldMap: Record<string, string> = {};
  const violations: CompatViolation[] = [];
  for (const req of consumerRequired) {
    const pubName = toPublisherPath(req.name, conToPub);
    if (pubName !== req.name) fieldMap[req.name] = pubName;
    const pub = publisher.get(pubName);
    if (!pub) {
      violations.push({ path: `${entity}.${req.name}`, reason: `required by consumer but absent in publisher` });
    } else if (req.logicalType === undefined && lt(pub.logicalType) === undefined) {
      // Two missing types would compare equal as '' === '', but nothing was established (R-84a).
      violations.push({
        path: `${entity}.${req.name}`,
        reason: `type undeclared: neither consumer nor publisher declares a logicalType for '${req.name}'`,
      });
    } else if ((lt(pub.logicalType) ?? '') !== (req.logicalType ?? '')) {
      violations.push({
        path: `${entity}.${req.name}`,
        reason: `type mismatch: consumer '${req.logicalType ?? ''}' vs publisher '${pub.logicalType ?? ''}'`,
      });
    }
  }

  return { entity, compatible: violations.length === 0, violations, consumerRequired, publisherProps, fieldMap };
}
