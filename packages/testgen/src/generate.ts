/**
 * generateArtifacts — the pure test-generator core (T-19 · R-81…R-88, D-23/24/27, NFR-8).
 *
 * Catalog contracts → { manifest, files[] }. No AWS, no network, no clock, no
 * randomness — the same catalog always yields byte-identical output (R-88), so
 * it is fully unit-testable offline and re-running on an unchanged catalog is a
 * no-op git diff (E-22). Fault-isolating: an invalid contract, a single-source
 * entity, or an unmapped entity is SKIPPED with a recorded reason (R-85), never
 * an abort. An entity with no declared publisher/consumer roles is skipped
 * the same way (R-84b).
 */
import { parseAndValidate, apiTarget, resolveRoles, compareCodePoint, ENTITY_FLOWS, type EntityFlows } from '@registry/core';
import { deriveJsonSchema } from './derive-schema.js';
import { checkCompat } from './compat.js';
import { emitConformanceTest, emitCompatTest } from './emit.js';
import {
  GENERATOR_ID,
  type ArtifactSet,
  type CatalogContract,
  type CompatTest,
  type ConformanceTest,
  type GeneratedTest,
  type Manifest,
  type Skip,
} from './manifest.js';

/**
 * `flows` are the declared publisher → consumer flows (R-84b, D-84); roles are
 * never inferred from source-label order. Injectable so the §3.12 mutation
 * attack can run this core against a mis-declared flow (calibration seed 6).
 */
export function generateArtifacts(catalog: CatalogContract[], flows: EntityFlows = ENTITY_FLOWS): ArtifactSet {
  const conformance: ConformanceTest[] = [];
  const compat: CompatTest[] = [];
  const skipped: Skip[] = [];

  // --- Conformance: one per applicable {source, entity} (R-83) ---
  for (const c of catalog) {
    if (c.validation !== 'valid') {
      skipped.push({ kind: 'conformance', target: `${c.source}/${c.id}`, reason: 'validation: invalid' });
      continue;
    }
    const target = apiTarget(c.source, c.entity);
    if (!target) {
      skipped.push({
        kind: 'conformance',
        target: `${c.source}/${c.id}`,
        reason: `no API mapping for entity '${c.entity}'`,
      });
      continue;
    }
    conformance.push({
      kind: 'conformance',
      source: c.source,
      entity: c.entity,
      contractId: c.id,
      contentHash: c.contentHash,
      declaredVersion: c.declaredVersion,
      target,
      jsonSchema: deriveJsonSchema(parseAndValidate(c.rawYaml).parsed),
    });
  }

  // --- Compat: one per multi-source entity, over its declared pair (R-84, R-84b) ---
  const entities = [...new Set(catalog.map((c) => c.entity))].sort();
  for (const entity of entities) {
    const variants = catalog.filter((c) => c.entity === entity);
    const sources = [...new Set(variants.map((v) => v.source))].sort();
    if (sources.length < 2) {
      skipped.push({ kind: 'compat', target: entity, reason: `single-source (${sources.join(',')} only)` });
      continue;
    }
    const roles = resolveRoles(entity, sources, flows);
    if (!roles) {
      skipped.push({ kind: 'compat', target: entity, reason: 'no declared publisher/consumer roles' });
      continue;
    }
    const pub = variants.find((v) => v.source === roles.publisher)!;
    const con = variants.find((v) => v.source === roles.consumer)!;
    if (pub.validation !== 'valid' || con.validation !== 'valid') {
      const bad = [pub, con]
        .filter((v) => v.validation !== 'valid')
        .map((v) => v.source)
        .join(',');
      skipped.push({ kind: 'compat', target: entity, reason: `variant invalid (${bad})` });
      continue;
    }
    const result = checkCompat(parseAndValidate(con.rawYaml).parsed, parseAndValidate(pub.rawYaml).parsed, roles.fields);
    compat.push({
      kind: 'compat',
      entity,
      publisher: { source: pub.source, contractId: pub.id, contentHash: pub.contentHash, declaredVersion: pub.declaredVersion },
      consumer: { source: con.source, contractId: con.id, contentHash: con.contentHash, declaredVersion: con.declaredVersion },
      rule: 'consumer-can-read-publisher',
      consumerRequired: result.consumerRequired,
      publisherProps: result.publisherProps,
      // Only when something is renamed, so unmapped entities keep a byte-identical entry (R-88).
      ...(Object.keys(result.fieldMap).length ? { fieldMap: result.fieldMap } : {}),
    });
  }

  // --- Deterministic ordering (R-88) ---
  // Code-point order, never the host locale's (R-88).
  conformance.sort((a, b) => compareCodePoint(`${a.source}.${a.entity}.${a.contractId}`, `${b.source}.${b.entity}.${b.contractId}`));
  compat.sort((a, b) => compareCodePoint(a.entity, b.entity));
  skipped.sort((a, b) => compareCodePoint(`${a.kind}.${a.target}`, `${b.kind}.${b.target}`));

  const tests: GeneratedTest[] = [...conformance, ...compat];
  const manifest: Manifest = { manifestVersion: 1, generator: GENERATOR_ID, tests, skipped };

  // --- Emit files (paths sorted, R-92) ---
  const files = tests
    .map((t, i) =>
      t.kind === 'conformance'
        ? { path: `conformance/${t.source}.${t.entity}.generated.test.ts`, contents: emitConformanceTest(t, i) }
        : { path: `compat/${t.entity}.generated.test.ts`, contents: emitCompatTest(t, i) }
    )
    .sort((a, b) => compareCodePoint(a.path, b.path));

  return { manifest, files };
}

/** Serialise a manifest deterministically (R-88) — used by handlers + CLI. */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}
