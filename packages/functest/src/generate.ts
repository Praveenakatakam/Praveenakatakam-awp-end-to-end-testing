/**
 * Orchestrate functional-test generation (R-117…R-123, D-51/D-52).
 *
 * Pipeline, per requirement: ground → (cache hit? reuse : synthesize + validate
 * + cache) → collect. The LLM and cache are injected (`LlmClient`, `PlanCache`)
 * so the core stays pure and offline (NFR-8): unit tests pass a stub LLM and an
 * in-memory cache, no network. Cross-service determinism is reconciled with LLM
 * nondeterminism the "lockfile" way (D-52): a cached plan for an unchanged input
 * hash is reused verbatim, and `emitFunctionalTests` renders plans
 * byte-identically (R-119a). The LLM only runs when inputs actually change.
 *
 * Nothing here fails the whole run: a synthesis error or a malformed/hallucinated
 * plan skips that ONE requirement with a reason (R-120, NFR-4).
 */
import { ground, type ApiMapLike, type ContractInput, type GroundedContext, type RequirementInput } from './ground.js';
import { validatePlan, stampPlan, planBodyOf, type FunctionalTestPlan } from './plan.js';
import { emitFunctionalTest } from './emit.js';
import { compareCodePoint, compareNatural, type EntityFlows } from '@registry/core';

export type { FunctionalTestPlan, PlanBody, PlanStep, PlanAssertion, PlanTarget, Expected, Role } from './plan.js';
export { PLAN_SCHEMA, validatePlan, stampPlan, planBodyOf, envStem, PLAN_SCHEMA_VERSION } from './plan.js';
export * from './ground.js';
export * from './emit.js';

export const FUNCTIONAL_GENERATOR_ID = '@registry/functest';

/**
 * The LLM boundary (R-118, D-51). One method: synthesize a plan body from a
 * grounded context. Implementations are offline-stubbable; the Anthropic-backed
 * one lives in a separate module so the core never imports the SDK. Returns
 * `unknown` — the core re-validates every response with `validatePlan`.
 */
export interface LlmClient {
  synthesizePlan(context: GroundedContext): Promise<unknown>;
}

/**
 * The plan cache (R-119). Keyed by the grounded input hash. Async because real
 * implementations are S3/DynamoDB-backed; the in-memory test double is trivially
 * async. A hit is reused verbatim — the LLM is not called.
 */
export interface PlanCache {
  get(inputHash: string): Promise<FunctionalTestPlan | undefined>;
  set(inputHash: string, plan: FunctionalTestPlan): Promise<void>;
}

export interface FunctionalGenInputs {
  requirements: RequirementInput[];
  contracts: ContractInput[];
  apiMap: ApiMapLike;
  modelId: string;
  promptVersion: string;
  /** Declared entity flows (R-117c); defaults to `ENTITY_FLOWS`. */
  flows?: EntityFlows;
}

export interface FunctionalSkip {
  /** `source/id` of the requirement that was skipped. */
  requirement: string;
  reason: string;
}

export interface FunctionalManifest {
  manifestVersion: 1;
  generator: string;
  modelId: string;
  promptVersion: string;
  plans: FunctionalTestPlan[];
  skipped: FunctionalSkip[];
  /** Deterministic adversarial findings stamped by the §3.12 review stage (R-131); absent if never reviewed. */
  adversarial?: { findings: object[] };
}

export interface FunctionalArtifactFile {
  /** Repo-relative path under `generated-tests/`. */
  path: string;
  contents: string;
}

export interface FunctionalArtifactSet {
  manifest: FunctionalManifest;
  /** Emitted `*.generated.test.ts` (manifest.json is written by the caller). */
  files: FunctionalArtifactFile[];
}

/** Stable ordering: by first requirement id (natural), then title. */
function planOrder(a: FunctionalTestPlan, b: FunctionalTestPlan): number {
  const ai = a.requirementIds[0] ?? '';
  const bi = b.requirementIds[0] ?? '';
  return compareNatural(ai, bi) || compareCodePoint(a.title, b.title);
}

/**
 * Run the pipeline. Requirements are processed in a stable sorted order so the
 * skip list and any cache-population order are deterministic. Returns the plans
 * (cache-reused or freshly synthesized), the reasoned skips, and each plan's
 * grounded context (the adversarial stage checks plans against exactly what the
 * model was shown, R-133). Contexts are keyed by the requirement's `{source}/{id}`
 * — two requirements with identical text share an input hash, so the hash alone
 * would let the second overwrite the first — and also by input hash, for callers
 * that look a plan up that way.
 */
export async function generateFunctionalPlans(
  inputs: FunctionalGenInputs,
  llm: LlmClient,
  cache: PlanCache
): Promise<{ plans: FunctionalTestPlan[]; skipped: FunctionalSkip[]; contexts: Map<string, GroundedContext> }> {
  const plans: FunctionalTestPlan[] = [];
  const skipped: FunctionalSkip[] = [];
  const contexts = new Map<string, GroundedContext>();

  const requirements = [...inputs.requirements].sort((a, b) => compareNatural(`${a.source}/${a.id}`, `${b.source}/${b.id}`));

  for (const req of requirements) {
    const label = `${req.source}/${req.id}`;
    const g = ground(req, inputs.contracts, inputs.apiMap, inputs.modelId, inputs.promptVersion, undefined, inputs.flows);
    if (!g.ok) {
      skipped.push({ requirement: label, reason: g.reason });
      continue;
    }

    contexts.set(label, g.context);
    contexts.set(g.context.inputHash, g.context);
    const grounded = { entity: g.context.entity, sources: g.context.sources, publisher: g.context.roles.publisher };
    const cached = await cache.get(g.context.inputHash);
    // A cached plan is reused only if it still passes today's validation: rules added after it was
    // cached would otherwise never apply to it. A stale one falls through to re-synthesis (R-119).
    if (cached && validatePlan(planBodyOf(cached), grounded).ok) {
      // The cache key covers the text, not the id: re-stamp the id for THIS requirement (R-117d, T-59 F-04).
      plans.push({ ...cached, kind: 'functional', requirementIds: [label] });
      continue;
    }

    let raw: unknown;
    try {
      raw = await llm.synthesizePlan(g.context);
    } catch (err) {
      skipped.push({ requirement: label, reason: `LLM synthesis failed: ${(err as Error).message}` });
      continue;
    }

    const v = validatePlan(raw, grounded);
    if (!v.ok) {
      skipped.push({ requirement: label, reason: v.reason });
      continue;
    }

    const plan = stampPlan(v.body, g.context);
    await cache.set(g.context.inputHash, plan);
    plans.push(plan);
  }

  plans.sort(planOrder);
  skipped.sort((a, b) => compareNatural(a.requirement, b.requirement));
  return { plans, skipped, contexts };
}

/** Render plans → emitted Vitest files, deterministically (R-122, R-119a). */
export function emitFunctionalTests(plans: FunctionalTestPlan[]): FunctionalArtifactFile[] {
  const ordered = [...plans].sort(planOrder);
  return ordered.map((plan, i) => ({
    path: `functional/${fileSlug(plan)}.generated.test.ts`,
    contents: emitFunctionalTest(plan, i),
  }));
}

/** Deterministic file slug from the first requirement's bare id (after its `source/`) + entity (R-117d). */
function fileSlug(plan: FunctionalTestPlan): string {
  const bare = (plan.requirementIds[0] ?? 'REQ').split('/').pop() || 'REQ';
  const id = bare.replace(/[^A-Za-z0-9]+/g, '-');
  return `${id}-${plan.trigger.entity}`.toLowerCase();
}

/** Assemble the full artifact set from a completed run. */
export function buildFunctionalArtifacts(manifest: FunctionalManifest): FunctionalArtifactSet {
  return { manifest, files: emitFunctionalTests(manifest.plans) };
}

/** Serialize the manifest byte-stably (sorted-ish via construction; 2-space JSON). */
export function serializeFunctionalManifest(manifest: FunctionalManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}
