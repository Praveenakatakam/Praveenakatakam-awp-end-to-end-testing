/**
 * Shared metadata + public surface for the ODCS Contract Registry core package.
 *
 * `packages/core` is pure logic (no AWS SDK): the GitHub source client, the
 * ODCS validator, the metadata extractor, and the semantic differ. It is the
 * single place the registry's contract-handling rules live, so the crawl
 * handler and the read API share one implementation.
 *
 * Module re-exports are added here as each core task lands (T-02…T-05).
 */
export const PROJECT = {
  name: 'odcs-contract-registry',
  odcsVersion: 'v3.1.0',
  /** Source repositories crawled by the registry (R-01, D-5). */
  oneRosterEntities: ['org', 'user', 'class', 'enrollment'] as const,
} as const;

export type ProjectMeta = typeof PROJECT;

export * from './sources.js';
export * from './odcs-validator.js';
export * from './metadata.js';
export * from './github.js';
export * from './diff.js';
export * from './schema-model.js';
export * from './api-map.js';
export * from './requirements.js';
export * from './prompt-versioning.js';
export * from './pipeline.js';
