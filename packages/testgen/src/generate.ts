/**
 * generateArtifacts — the pure test-generator core (T-19 · R-81…R-88, D-23/24/27, NFR-8).
 *
 * Catalog contracts → { manifest, files[] }. No AWS, no network, no clock, no
 * randomness — the same catalog always yields byte-identical output (R-88), so
 * it is fully unit-testable offline and re-running on an unchanged catalog is a
 * no-op git diff (E-22). Fault-isolating: an invalid contract, a single-source
 * entity, or an unmapped entity is SKIPPED with a recorded reason (R-85), never
 * an abort.
 */
import { parseAndValidate, apiTarget } from '@registry/core';
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
 * Resolve publisher and consumer variants for a set of same-entity contracts.
 *
 * When exactly two sources carry the entity, the alphabetically-first source
 * is treated as publisher and the second as consumer — a stable, deterministic
 * assignment (R-88). Any other count is not a valid compat pair.
 */
function resolveCompatPair(
  variants: CatalogContract[]
): { pub: CatalogContract; con: CatalogContract } | null {
  const sources = [...new Set(variants.map((v) => v.source))].sort();
  if (sources.length !== 2) return null;
  return {
    pub: variants.find((v) => v.source === sources[0])!,
    con: variants.find((v) => v.source === sources[1])!,
  };
}

export function generateArtifacts(catalog: CatalogContract[]): ArtifactSet {
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

  // --- Compat: one per entity with exactly two sources (R-84) ---
  const entities = [...new Set(catalog.map((c) => c.entity))].sort();
  for (const entity of entities) {
    const variants = catalog.filter((c) => c.entity === entity);
    const pair = resolveCompatPair(variants);

    if (!pair) {
      const only = variants.map((v) => v.source).join(',');
      skipped.push({ kind: 'compat', target: entity, reason: `single-source (${only} only)` });
      continue;
    }
    const { pub, con } = pair;
    if (pub.validation !== 'valid' || con.validation !== 'valid') {
      const bad = [pub, con]
        .filter((v) => v.validation !== 'valid')
        .map((v) => v.source)
        .join(',');
      skipped.push({ kind: 'compat', target: entity, reason: `variant invalid (${bad})` });
      continue;
    }
    const result = checkCompat(parseAndValidate(con.rawYaml).parsed, parseAndValidate(pub.rawYaml).parsed);
    compat.push({
      kind: 'compat',
      entity,
      publisher: { source: pub.source, contractId: pub.id, contentHash: pub.contentHash, declaredVersion: pub.declaredVersion },
      consumer: { source: con.source, contractId: con.id, contentHash: con.contentHash, declaredVersion: con.declaredVersion },
      rule: 'consumer-can-read-publisher',
      consumerRequired: result.consumerRequired,
      publisherProps: result.publisherProps,
    });
  }

  // --- Deterministic ordering (R-88) ---
  conformance.sort((a, b) => `${a.source}.${a.entity}.${a.contractId}`.localeCompare(`${b.source}.${b.entity}.${b.contractId}`));
  compat.sort((a, b) => a.entity.localeCompare(b.entity));
  skipped.sort((a, b) => `${a.kind}.${a.target}`.localeCompare(`${b.kind}.${b.target}`));

  const tests: GeneratedTest[] = [...conformance, ...compat];
  const manifest: Manifest = { manifestVersion: 1, generator: GENERATOR_ID, tests, skipped };

  // --- Emit files (paths sorted, R-92) ---
  const files = tests
    .map((t, i) =>
      t.kind === 'conformance'
        ? { path: `conformance/${t.source}.${t.entity}.generated.test.ts`, contents: emitConformanceTest(t, i) }
        : { path: `compat/${t.entity}.generated.test.ts`, contents: emitCompatTest(t, i) }
    )
    .sort((a, b) => a.path.localeCompare(b.path));

  return { manifest, files };
}

/** Serialise a manifest deterministically (R-88) — used by handlers + CLI. */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}
