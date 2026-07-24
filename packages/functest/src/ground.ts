/**
 * Grounding: decide whether a requirement can yield a cross-service functional
 * test, and if so assemble the exact inputs the LLM is allowed to see (R-117)
 * plus the input hash that keys the plan cache (R-119).
 *
 * A requirement is groundable only when it references a cataloged entity that
 * (a) exists in ≥2 sources — i.e. genuinely crosses services (D-54) — and
 * (b) has at least one live API mapping so a plan can point at a real endpoint.
 * Anything else is skipped WITH A REASON (R-121), never silently dropped:
 *   - "references no cataloged entity"  (infra-only / entity-less requirement)
 *   - "single-service entity …"         (no cross-service counterpart)
 *   - "no API mapping for entity …"     (nothing to target at runtime)
 *
 * The core is pure and offline (NFR-8): the LLM and the cache are injected; this
 * module only reads the catalog snapshot passed in. The input hash is a SHA-256
 * over the requirement text, the entity's contract content hashes, the entity's
 * api-map entries, the model id, and the prompt version — so any change to what
 * the model would see busts the cache (R-119); nothing else does.
 */
import { createHash } from 'node:crypto';
import { normalizeContractSchema, parseAndValidate, type NormProp } from '@registry/core';
import type { EntityApiTarget } from '@registry/core';

/** One requirement from the catalog (R-107 shape, trimmed to what grounding needs). */
export interface RequirementInput {
  source: string;
  id: string;
  text: string;
  earsType: string;
  section: string;
}

/** One contract from the catalog (R-81/R-82 shape, trimmed). */
export interface ContractInput {
  source: string;
  entity: string;
  id: string;
  contentHash: string;
  rawYaml: string;
}

/** Everything the LLM is permitted to see for one requirement (R-117). */
export interface GroundedContext {
  requirement: RequirementInput;
  entity: string;
  /** Sources that publish/consume this entity (the allowed `trigger.source` set). */
  sources: string[];
  /** The entity's contract properties (schema[0]), from one canonical variant. */
  schema: NormProp[];
  /** Live API coordinates for the entity, per source (may be one side only). */
  apiTargets: { source: string; target: EntityApiTarget }[];
  inputHash: string;
}

export type GroundResult = { ok: true; context: GroundedContext } | { ok: false; reason: string };

/** api-map slice: `source → entity → target`. */
export type ApiMapLike = Record<string, Record<string, EntityApiTarget>>;

/** Does `text` mention `entity` as a whole word (case-insensitive)? */
function mentions(text: string, entity: string): boolean {
  return new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(text);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * Ground one requirement against the catalog. `entities` is the set of entity
 * names actually present in `contracts`; grounding picks the referenced entity
 * with an API mapping (deterministic: first by sorted entity name).
 */
export function ground(
  req: RequirementInput,
  contracts: ContractInput[],
  apiMap: ApiMapLike,
  modelId: string,
  promptVersion: string
): GroundResult {
  const entities = [...new Set(contracts.map((c) => c.entity))].sort();
  const referenced = entities.filter((e) => mentions(req.text, e));
  if (referenced.length === 0) {
    return { ok: false, reason: 'references no cataloged entity' };
  }

  // Prefer a referenced entity that is both cross-service AND mapped; if none
  // qualifies, report the most specific reason for the first referenced entity.
  const groundable = referenced.find((e) => {
    const sources = [...new Set(contracts.filter((c) => c.entity === e).map((c) => c.source))];
    const mapped = sources.some((s) => apiMap[s]?.[e]);
    return sources.length >= 2 && mapped;
  });

  const entity = groundable ?? referenced[0];
  const sources = [...new Set(contracts.filter((c) => c.entity === entity).map((c) => c.source))].sort();
  if (sources.length < 2) {
    return { ok: false, reason: `single-service entity '${entity}' (no cross-service counterpart)` };
  }
  const apiTargets = sources
    .map((s) => ({ source: s, target: apiMap[s]?.[entity] }))
    .filter((t): t is { source: string; target: EntityApiTarget } => Boolean(t.target));
  if (apiTargets.length === 0) {
    return { ok: false, reason: `no API mapping for entity '${entity}'` };
  }

  // Canonical schema variant: the publisher's if present, else the first source.
  const variants = contracts.filter((c) => c.entity === entity).sort((a, b) => a.source.localeCompare(b.source));
  const canonical = variants.find((c) => c.source === 'publisher') ?? variants[0];
  const parsed = parseAndValidate(canonical.rawYaml).parsed;
  const schema = [...normalizeContractSchema(parsed).props.values()].sort((a, b) => a.name.localeCompare(b.name));

  const contentHashes = variants.map((c) => `${c.source}:${c.contentHash}`).sort();
  const inputHash = createHash('sha256')
    .update(
      stableStringify({
        text: req.text,
        entity,
        contentHashes,
        apiTargets,
        modelId,
        promptVersion,
      })
    )
    .digest('hex');

  return {
    ok: true,
    context: { requirement: req, entity, sources, schema, apiTargets, inputHash },
  };
}
