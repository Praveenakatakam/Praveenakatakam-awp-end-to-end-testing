/**
 * Cross-app compatibility check — consumer-can-read-publisher (T-19 · R-84, R-84a, D-24).
 *
 * Directional, matching the CDC data flow (publisher emits → consumer reads):
 * every property the CONSUMER's contract marks `required` must be present in the
 * PUBLISHER's contract and share the same logical type. Extra publisher
 * properties are allowed (E-26); a missing or type-incompatible required
 * consumer property is a violation (E-25).
 *
 * Reuses the shared property model (`normalizeContractSchema`) so this check and
 * the semantic differ (R-53) cannot drift.
 */
import { normalizeContractSchema } from '@registry/core';
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
}

export function checkCompat(consumerDoc: unknown, publisherDoc: unknown): CompatResult {
  const consumer = normalizeContractSchema(consumerDoc);
  const publisher = normalizeContractSchema(publisherDoc);
  const entity = consumer.entity || publisher.entity;

  const consumerRequired: CompatProp[] = [...consumer.props.values()]
    .filter((p) => p.required)
    .map((p) => ({ name: p.name, logicalType: p.logicalType }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const publisherProps: CompatProp[] = [...publisher.props.values()]
    .map((p) => ({ name: p.name, logicalType: p.logicalType }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const violations: CompatViolation[] = [];
  for (const req of consumerRequired) {
    const pub = publisher.props.get(req.name);
    if (!pub) {
      violations.push({ path: `${entity}.${req.name}`, reason: `required by consumer but absent in publisher` });
    } else if ((pub.logicalType ?? '') !== (req.logicalType ?? '')) {
      violations.push({
        path: `${entity}.${req.name}`,
        reason: `type mismatch: consumer '${req.logicalType ?? ''}' vs publisher '${pub.logicalType ?? ''}'`,
      });
    }
  }

  return { entity, compatible: violations.length === 0, violations, consumerRequired, publisherProps };
}
