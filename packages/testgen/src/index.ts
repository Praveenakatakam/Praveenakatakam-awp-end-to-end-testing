/**
 * @registry/testgen — pure contract-driven test generator (design §9).
 *
 * catalog (discovered ODCS contracts) → { manifest, emitted Vitest files }.
 * No AWS, no network, no clock: deterministic and offline-testable (NFR-8).
 * Consumed by the `POST /generate-tests` handler and the `generate-tests` CLI.
 */
export * from './manifest.js';
export * from './derive-schema.js';
export * from './compat.js';
export * from './emit.js';
export * from './generate.js';
