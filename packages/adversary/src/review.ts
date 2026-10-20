/**
 * The adversarial review stage (R-127…R-132) — composes the attacks for each
 * generator and decides what may be emitted.
 *
 * Both entry points return:
 *   - `block`  — the deterministic findings, stamped into the COMMITTED manifest
 *                (R-131). Never includes critic output or a verdict, so an
 *                unchanged input re-yields byte-identical bytes;
 *   - `report` — everything (deterministic + critic + mutation detail + verdict),
 *                persisted beside the artifacts, never committed (R-130).
 *
 * Gating (R-129): only §3.11 plans with a deterministic Critical are withheld.
 * §3.9 tests are never withheld — their findings target the generator.
 */
import { resolveRoles } from '@registry/core';
import type { ArtifactSet, CatalogContract, CompatTest, ConformanceTest } from '@registry/testgen';
import type { FunctionalTestPlan, GroundedContext } from '@registry/functest';
import { countFindings, finalizeFindings, type Attack, type DraftFinding, type Finding, type Severity } from './finding.js';
import { verdictOf, type Verdict } from './verdict.js';
import { criticIndependence, runCritic, type CriticCache, type CriticClient, type CriticPlanResult } from './critic.js';
import { manifestTierEvaluator, mutateTestgenBatched, type BatchEvaluator, type CompatOutcome, type Roles } from './mutate-testgen.js';
import { DEFAULT_MUTATION_THRESHOLD, scorePlan } from './mutate-functest.js';
import { groundPlan } from './grounding.js';
import { lintCompat, lintConformance, lintFunctional } from './vacuity.js';
import { planRef, type EmittedFile, type FunctionalUnderReview } from './subject.js';

export interface AdversarialReport {
  generator: 'testgen' | 'functest';
  verdict: Verdict;
  counts: Record<Attack, Record<Severity, number>>;
  withheld: { requirement: string; findings: string[] }[];
  deterministic: Finding[];
  critic: {
    status: 'ok' | 'partial' | 'failed' | 'unavailable' | 'skipped';
    independence?: 'ok' | 'degraded';
    modelId?: string;
    droppedByPostureLint: number;
    malformed: number;
    findings: Finding[];
    perPlan: { ref: string; status: 'ok' | 'failed' | 'unavailable' | 'skipped'; reason?: string }[];
  };
  mutation: {
    tier: 'manifest' | 'executed';
    testgen?: { entity: string; applicable: boolean; total: number; killed: number; survivors: string[] }[];
    functional?: { ref: string; score: number; survivors: string[] }[];
  };
  notes: string[];
}

/** The committed, deterministic block stamped into a manifest (R-131). */
export interface ManifestAdversarialBlock {
  findings: Finding[];
}

const SKIPPED_CRITIC: AdversarialReport['critic'] = {
  status: 'skipped',
  droppedByPostureLint: 0,
  malformed: 0,
  findings: [],
  perPlan: [],
};

// ---- §3.9 ------------------------------------------------------------------

/**
 * Live roles come from the declared flows (R-135 v0.8.0, D-84), never from the
 * manifest under review, so a generator that disagrees with the declaration is
 * caught on live data too.
 */
function declaredRoles(catalog: CatalogContract[]): Roles {
  const roles: Roles = {};
  for (const entity of [...new Set(catalog.map((c) => c.entity))].sort()) {
    const sources = [...new Set(catalog.filter((c) => c.entity === entity).map((c) => c.source))];
    if (sources.length < 2) continue;
    const r = resolveRoles(entity, sources);
    if (r) roles[entity] = r;
  }
  return roles;
}

const manifestBatch: BatchEvaluator = async (cases) => cases.map((c) => manifestTierEvaluator(c.catalog, c.entity) as CompatOutcome);

export async function reviewTestgen(
  artifacts: ArtifactSet,
  catalog: CatalogContract[],
  opts: { roles?: Roles; runBatch?: BatchEvaluator; tier?: 'manifest' | 'executed' } = {}
): Promise<{ block: ManifestAdversarialBlock; report: AdversarialReport }> {
  const drafts: DraftFinding[] = [];
  for (const t of artifacts.manifest.tests) {
    if (t.kind === 'conformance') {
      const c = t as ConformanceTest;
      const file = artifacts.files.find((f) => f.path === `conformance/${c.source}.${c.entity}.generated.test.ts`);
      if (file) drafts.push(...lintConformance(c, file));
    } else {
      drafts.push(...lintCompat(t as CompatTest));
    }
  }

  const notes: string[] = [];
  const roles = opts.roles ?? declaredRoles(catalog);
  const tier = opts.tier ?? 'manifest';
  const mutation = await mutateTestgenBatched(catalog, roles, opts.runBatch ?? manifestBatch, tier);
  drafts.push(...mutation.findings);

  const findings = finalizeFindings(drafts);
  return {
    block: { findings },
    report: {
      generator: 'testgen',
      verdict: verdictOf(findings, 0),
      counts: countFindings(findings),
      withheld: [],
      deterministic: findings,
      critic: SKIPPED_CRITIC,
      mutation: { tier, testgen: mutation.entities },
      notes,
    },
  };
}

// ---- §3.11 -----------------------------------------------------------------

export interface FunctionalReviewOptions {
  critic?: CriticClient;
  criticCache?: CriticCache;
  /** The synthesiser's model id — for the independence check (R-139). */
  synthModelId?: string;
  /** Static-mutation score threshold (D-77). */
  threshold?: number;
}

function memoryCriticCache(): CriticCache {
  const m = new Map<string, CriticPlanResult>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

/**
 * The emitted file for a plan, matched by the header lines the emitter writes. The input hash
 * covers the requirement text, not its id, so two requirements with identical text share one:
 * the requirement ids on the header's first line are what tell their files apart.
 */
function fileFor(plan: FunctionalTestPlan, files: EmittedFile[], index: number): EmittedFile {
  const hash = `inputHash ${plan.inputHash.slice(0, 16)}`;
  const own = `functional test for ${plan.requirementIds.join(', ')}.`;
  return files.find((f) => f.contents.includes(own) && f.contents.includes(hash)) ?? files.find((f) => f.contents.includes(hash)) ?? files[index];
}

/** The context a plan was grounded from: by requirement first (unambiguous), then by input hash. */
function contextFor(plan: FunctionalTestPlan, contexts: Map<string, GroundedContext>): GroundedContext | undefined {
  return contexts.get(plan.requirementIds[0]) ?? contexts.get(plan.inputHash);
}

function aggregateCriticStatus(perPlan: AdversarialReport['critic']['perPlan']): AdversarialReport['critic']['status'] {
  if (perPlan.some((p) => p.status === 'unavailable')) return 'unavailable';
  const ran = perPlan.filter((p) => p.status !== 'skipped');
  if (ran.length === 0) return 'skipped';
  if (ran.every((p) => p.status === 'ok')) return 'ok';
  if (ran.every((p) => p.status === 'failed')) return 'failed';
  return 'partial';
}

export async function reviewFunctional(
  plans: FunctionalTestPlan[],
  contexts: Map<string, GroundedContext>,
  files: EmittedFile[],
  opts: FunctionalReviewOptions = {}
): Promise<{
  kept: FunctionalTestPlan[];
  withheld: { plan: FunctionalTestPlan; requirement: string; reason: string }[];
  block: ManifestAdversarialBlock;
  report: AdversarialReport;
}> {
  const threshold = opts.threshold ?? DEFAULT_MUTATION_THRESHOLD;
  const subjects: FunctionalUnderReview[] = plans.map((plan, i) => {
    const context = contextFor(plan, contexts);
    if (!context) throw new Error(`no grounded context for plan ${plan.requirementIds.join(', ')} (inputHash ${plan.inputHash})`);
    return { plan, context, file: fileFor(plan, files, i) };
  });

  // Deterministic attacks (these, and only these, gate — R-129).
  const drafts: DraftFinding[] = [];
  const scores: NonNullable<AdversarialReport['mutation']['functional']> = [];
  for (const u of subjects) {
    const score = scorePlan(u, threshold);
    drafts.push(...groundPlan(u), ...lintFunctional(u), ...score.findings);
    scores.push({ ref: planRef(u), score: score.score, survivors: score.survivors });
  }
  const deterministic = finalizeFindings(drafts);

  const withheld: { plan: FunctionalTestPlan; requirement: string; reason: string }[] = [];
  const kept: FunctionalTestPlan[] = [];
  for (const u of subjects) {
    const ref = planRef(u);
    const critical = deterministic.filter((f) => f.target.ref === ref && f.severity === 'Critical').map((f) => f.id);
    if (critical.length) withheld.push({ plan: u.plan, requirement: ref, reason: `adversarial: ${critical.join(', ')}` });
    else kept.push(u.plan);
  }

  // The critic — report-only, on every plan (withheld ones included), isolated (R-130, R-141).
  let critic: AdversarialReport['critic'] = SKIPPED_CRITIC;
  if (opts.critic) {
    const cache = opts.criticCache ?? memoryCriticCache();
    const perPlan: AdversarialReport['critic']['perPlan'] = [];
    const criticDrafts: DraftFinding[] = [];
    let dropped = 0;
    let malformed = 0;
    let unavailable = false;
    for (const u of subjects) {
      const ref = planRef(u);
      if (unavailable) {
        perPlan.push({ ref, status: 'skipped', reason: 'critic model unavailable' });
        continue;
      }
      const own = deterministic.filter((f) => f.target.ref === ref);
      const r = await runCritic(u, own, opts.critic, cache);
      perPlan.push({ ref, status: r.status, ...(r.reason ? { reason: r.reason } : {}) });
      criticDrafts.push(...r.findings);
      dropped += r.droppedByPostureLint;
      malformed += r.malformed;
      if (r.status === 'unavailable') unavailable = true;
    }
    critic = {
      status: aggregateCriticStatus(perPlan),
      ...(opts.synthModelId ? { independence: criticIndependence(opts.critic.modelId, opts.synthModelId) } : {}),
      modelId: opts.critic.modelId,
      droppedByPostureLint: dropped,
      malformed,
      findings: finalizeFindings(criticDrafts, 'C'),
      perPlan,
    };
  }

  // A withheld plan's file is never written (R-129), so its committed findings must not point at it:
  // drop `file` and mark them withheld. The local report keeps the path, since the file was rendered for review.
  const withheldRefs = new Set(withheld.map((w) => w.requirement));
  const committed = deterministic.map((f) => {
    if (!withheldRefs.has(f.target.ref)) return f;
    const { file: _file, ...rest } = f.target;
    return { ...f, target: { ...rest, withheld: true as const } };
  });

  const all = [...deterministic, ...critic.findings];
  return {
    kept,
    withheld,
    block: { findings: committed },
    report: {
      generator: 'functest',
      verdict: verdictOf(all, withheld.length),
      counts: countFindings(all),
      withheld: withheld.map((w) => ({ requirement: w.requirement, findings: w.reason.replace('adversarial: ', '').split(', ') })),
      deterministic,
      critic,
      mutation: { tier: 'manifest', functional: scores },
      notes: [],
    },
  };
}
