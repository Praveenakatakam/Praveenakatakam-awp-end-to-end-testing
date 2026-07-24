/**
 * Test-generation manifest — the artifact set's source of truth (T-19 · R-86, D-28).
 *
 * Every generated test and every skip is enumerated here in a machine-readable
 * form. The emitted `*.generated.test.ts` files are DERIVED from these entries
 * (R-87); a future runner can consume either. The manifest is deliberately free
 * of timestamps / run ids / random values so an unchanged catalog yields a
 * byte-identical manifest (R-88) — run-level metadata lives in the DynamoDB
 * generation-run record instead (R-89).
 */

/** One input contract, as read from the current catalog (R-81, R-82). */
export interface CatalogContract {
  source: string;
  entity: string;
  id: string;
  declaredVersion?: string;
  /** Git blob SHA the test is generated from (R-82). */
  contentHash: string;
  validation: 'valid' | 'invalid';
  /** Raw ODCS YAML — parsed for schema derivation + the compat check. */
  rawYaml: string;
}

/** A minimal JSON-Schema object (embedded per conformance test — D-30). */
export interface JsonSchema {
  type: 'object';
  required: string[];
  properties: Record<string, { type?: string; format?: string; enum?: unknown[] }>;
  additionalProperties: boolean;
}

export interface ConformanceTest {
  kind: 'conformance';
  source: string;
  entity: string;
  contractId: string;
  contentHash: string;
  declaredVersion?: string;
  target: { baseUrlEnv: string; tokenEnv: string; path: string; recordsAt: string };
  /** Records fetched from the live API validate against this (D-30). */
  jsonSchema: JsonSchema;
}

export interface CompatProp {
  name: string;
  logicalType?: string;
}

/** One variant a compat test was generated from — content hash + declared version (R-82). */
export interface CompatVariant {
  source: string;
  contractId: string;
  contentHash: string;
  declaredVersion?: string;
}

export interface CompatTest {
  kind: 'compat';
  entity: string;
  publisher: CompatVariant;
  consumer: CompatVariant;
  rule: 'consumer-can-read-publisher';
  /** Consumer's required properties the publisher must satisfy (R-84). */
  consumerRequired: CompatProp[];
  /** Publisher's properties (name → logicalType) for the run-time assertion. */
  publisherProps: CompatProp[];
}

export type GeneratedTest = ConformanceTest | CompatTest;

export interface Skip {
  kind: 'conformance' | 'compat';
  /** `source/id` for conformance, entity for compat. */
  target: string;
  reason: string;
}

export interface Manifest {
  manifestVersion: 1;
  generator: string;
  tests: GeneratedTest[];
  skipped: Skip[];
}

export interface ArtifactFile {
  /** Repo-relative path under `generated-tests/`. */
  path: string;
  contents: string;
}

export interface ArtifactSet {
  manifest: Manifest;
  /** Emitted `*.generated.test.ts` files (manifest.json is written by the caller). */
  files: ArtifactFile[];
}

export const GENERATOR_ID = '@registry/testgen';
