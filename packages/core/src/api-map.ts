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
  'get-ready': {
    TaskPublished: { path: '/api/grdy/assignments/getTasks', baseUrlEnv: 'GET_READY_API_URL', tokenEnv: 'GET_READY_TOKEN', recordsAt: '' },
  },
};

/** One entity's declared publisher → consumer flow (R-84b, D-84). */
export interface EntityFlow {
  publisher: string;
  consumer: string;
  /** Publisher property → consumer property, for fields renamed across the flow (R-84c, D-85). */
  fields?: Record<string, string>;
}

export type EntityFlows = Record<string, EntityFlow>;

/** Resolved roles for one entity; `fields` is always present (possibly empty). */
export interface ResolvedRoles {
  publisher: string;
  consumer: string;
  fields: Record<string, string>;
}

/**
 * Declared publisher → consumer flows, per entity (D-84). Lives beside `API_MAP`
 * because a flow spans two sources while `API_MAP` is keyed by one. Declare
 * `fields` only for real renames: the live get-ready contract sources every
 * TaskPublished field from the same-named create field (verified 2026-10-09, D-85).
 */
export const ENTITY_FLOWS: EntityFlows = {
  TaskPublished: { publisher: 'create', consumer: 'get-ready' },
  // Directions read off the contract ids: each consumer contract is the `-consumer` counterpart of the
  // publisher's (deliver.class-assignment-monitor-api → frontend.…-consumer, deliver.result-package →
  // score.result-package-consumer, score.student-scored-task → report.…-consumer). No `fields`: a field
  // map is declared only for a verified rename (D-85). No API_MAP entry is added for these entities,
  // since their live paths are unknown, so only the static compat test is generated for them.
  ClassAssignment: { publisher: 'deliver', consumer: 'frontend' },
  ResultPackage: { publisher: 'deliver', consumer: 'score' },
  StudentTaskScoredEvent: { publisher: 'score', consumer: 'report' },
};

/**
 * Resolve an entity's roles from the sources that carry it (R-84b):
 * 1. a declared flow whose two sources both carry the entity;
 * 2. else exactly the literal `publisher` + `consumer` labels (D-60);
 * 3. else undefined. Never inferred from label order.
 */
export function resolveRoles(entity: string, sources: string[], flows: EntityFlows = ENTITY_FLOWS): ResolvedRoles | undefined {
  const present = new Set(sources);
  const flow = flows[entity];
  if (flow && present.has(flow.publisher) && present.has(flow.consumer)) {
    return { publisher: flow.publisher, consumer: flow.consumer, fields: { ...(flow.fields ?? {}) } };
  }
  if (present.size === 2 && present.has('publisher') && present.has('consumer')) {
    return { publisher: 'publisher', consumer: 'consumer', fields: {} };
  }
  return undefined;
}

/** Resolve the API target for a {source, entity}, or undefined when unmapped (R-83b). */
export function apiTarget(source: string, entity: string): EntityApiTarget | undefined {
  return API_MAP[source]?.[entity];
}
