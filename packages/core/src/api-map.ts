/**
 * Entity → live API mapping for conformance test generation (T-18 · R-83b, D-31).
 *
 * The registry catalogs contracts, but a *conformance* test also needs to know
 * WHERE each app serves that entity's records and HOW to authenticate. That
 * runtime coordinate is not reliably present in the ODCS document, so it lives
 * here as fixed configuration, co-located with `sources.ts` (D-31).
 *
 * Only entities an app actually serves as a per-entity record list are mapped;
 * everything else is intentionally absent, and the generator SKIPS conformance
 * for it with a recorded reason (R-83b, R-85, E-27) rather than emit an
 * unrunnable test. Today only the publisher's `org` (`GET /orgs`) and the
 * consumer's `class` (`GET /me/classes`) expose such a list — the other
 * OneRoster entities are stored but not served as raw entity collections.
 *
 * `recordsAt` is a dot path into the JSON response locating the record array
 * (e.g. `{ "items": [...] }` → `"items"`; `""` means the response body itself
 * is the array). Env-var names are what the FUTURE runner sets (R-83a, D-26);
 * with them unset the emitted test skips rather than fails.
 */

export interface EntityApiTarget {
  /** HTTP path (appended to the app's base URL) that returns the entity's records. */
  path: string;
  /** Env var holding the app's API base URL at run time. */
  baseUrlEnv: string;
  /** Env var holding a Cognito access token at run time. */
  tokenEnv: string;
  /** Dot path to the record array in the JSON response ("" = body is the array). */
  recordsAt: string;
}

/** `source label → entity → target`. Absent entities are skipped for conformance. */
export const API_MAP: Record<string, Record<string, EntityApiTarget>> = {
  publisher: {
    org: { path: '/orgs', baseUrlEnv: 'PUBLISHER_API_URL', tokenEnv: 'PUBLISHER_TOKEN', recordsAt: 'items' },
  },
  consumer: {
    class: { path: '/me/classes', baseUrlEnv: 'CONSUMER_API_URL', tokenEnv: 'CONSUMER_TOKEN', recordsAt: 'items' },
  },
};

/** Resolve the API target for a {source, entity}, or undefined when unmapped (R-83b). */
export function apiTarget(source: string, entity: string): EntityApiTarget | undefined {
  return API_MAP[source]?.[entity];
}
