/**
 * Async LLM functional-test generation (T-36 · §3.11, R-115, R-116, R-124).
 *
 * Two-part async job (D-53): the API handler creates a job record and dispatches
 * a worker, returning `202` immediately (LLM synthesis exceeds the 29s gateway
 * limit); the worker loads the current catalog, runs the pure `@registry/functest`
 * pipeline (LLM + plan-cache injected), stores artifacts to S3, and stamps the
 * job's terminal status. Like `generate.ts`, it NEVER crawls (R-116) and the
 * testable logic is separated from the Lambda entrypoints so the offline suite
 * runs with a stub LLM and an in-memory cache — the Anthropic SDK is imported
 * lazily by the worker entrypoint only, so no unit test ever loads it (NFR-8).
 */
import {
  generateFunctionalPlans,
  emitFunctionalTests,
  FUNCTIONAL_GENERATOR_ID,
  type FunctionalGenInputs,
  type FunctionalManifest,
  type LlmClient,
  type PlanCache,
  type ContractInput,
  type RequirementInput,
} from '@registry/functest';
import { API_MAP, compareNatural } from '@registry/core';
import {
  reviewFunctional,
  DEFAULT_MUTATION_THRESHOLD,
  type CriticCache,
  type CriticClient,
  type CriticPlanResult,
} from '@registry/adversary';
import { repository, type CatalogEntry, type RequirementRecord, type FunctionalJobRecord } from './repository.js';
import { log, redact } from './log.js';

/**
 * Model + prompt pinned here; both feed the plan-cache input hash (R-119). The
 * model is a Bedrock model id / inference-profile id (default: the granted US
 * Sonnet 4.6 cross-region profile; Opus 4.8 once its access grant lands),
 * overridable per-stage via `BEDROCK_MODEL_ID` without a code change (D-55).
 */
export const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
export const PROMPT_VERSION = 'v3';

/** The repository surface the job needs (injected so it is offline-testable). */
export interface FunctionalGenRepo {
  listEntries(filters?: Record<string, string>): Promise<CatalogEntry[]>;
  getRaw(source: string, id: string): Promise<string | undefined>;
  listRequirements(filters?: Record<string, unknown>): Promise<RequirementRecord[]>;
  writeFunctionalJob(job: FunctionalJobRecord): Promise<void>;
  putFunctionalArtifacts(jobId: string, artifacts: unknown): Promise<string>;
  getCachedPlan(inputHash: string): Promise<unknown>;
  putCachedPlan(inputHash: string, plan: unknown): Promise<void>;
  /** Critic-result cache (§3.12, R-142). Optional: without it, results are cached for one job only. */
  getCachedCritic?(key: string): Promise<CriticPlanResult | undefined>;
  putCachedCritic?(key: string, result: CriticPlanResult): Promise<void>;
}

/** §3.11 static-mutation threshold (D-77), from the worker env; falls back to the default on a bad value. */
export function mutationThreshold(raw = process.env.ADVERSARIAL_MUTATION_THRESHOLD): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_MUTATION_THRESHOLD;
}

/** Adapt the repo's S3-backed critic store to `CriticCache` (R-142), or a per-job memory cache. */
export function repoCriticCache(repo: FunctionalGenRepo): CriticCache {
  if (repo.getCachedCritic && repo.putCachedCritic) {
    return {
      get: (k) => repo.getCachedCritic!(k),
      set: (k, v) => repo.putCachedCritic!(k, v),
    };
  }
  const m = new Map<string, CriticPlanResult>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

/** Build the generator inputs from the CURRENT catalog snapshot (R-116). */
export async function buildFunctionalInputs(repo: FunctionalGenRepo): Promise<FunctionalGenInputs> {
  const entries = await repo.listEntries();
  const contracts: ContractInput[] = [];
  for (const e of entries) {
    contracts.push({
      source: e.source,
      entity: e.entity,
      id: e.id,
      contentHash: e.currentHash,
      rawYaml: (await repo.getRaw(e.source, e.id)) ?? '',
    });
  }
  const requirements: RequirementInput[] = (await repo.listRequirements()).map((r) => ({
    source: r.source,
    id: r.id,
    text: r.text,
    earsType: r.earsType,
    section: r.section,
  }));
  return { requirements, contracts, apiMap: API_MAP, modelId: MODEL_ID, promptVersion: PROMPT_VERSION };
}

/** Adapt the repo's S3-backed plan store to the `PlanCache` interface (R-119). */
export function repoPlanCache(repo: FunctionalGenRepo): PlanCache {
  return {
    async get(inputHash) {
      return (await repo.getCachedPlan(inputHash)) as any;
    },
    async set(inputHash, plan) {
      await repo.putCachedPlan(inputHash, plan);
    },
  };
}

/**
 * Run one functional-generation job end to end. Marks the job running, executes
 * the pipeline, stores artifacts + terminal status. Any whole-job failure
 * (e.g. a missing credential) is caught and recorded as `failed` with a redacted
 * reason (R-124, NFR-2/NFR-4) — never thrown out of the worker.
 */
export async function runFunctionalJob(
  jobId: string,
  repo: FunctionalGenRepo,
  llm: LlmClient,
  clock: { now(): string },
  critic?: CriticClient
): Promise<FunctionalJobRecord> {
  const base: FunctionalJobRecord = {
    jobId,
    status: 'running',
    startedAt: clock.now(),
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
  };
  try {
    await repo.writeFunctionalJob(base);
    log.info('functional.start', { jobId });

    const inputs = await buildFunctionalInputs(repo);
    const { plans, skipped: groundingSkips, contexts } = await generateFunctionalPlans(inputs, llm, repoPlanCache(repo));

    // Adversarial review BEFORE persisting (R-127): render the candidates, attack
    // them, withhold any plan with a deterministic Critical (R-129), then render
    // only the kept plans. The critic is report-only (R-130) and isolated (R-141).
    const review = await reviewFunctional(plans, contexts, emitFunctionalTests(plans), {
      critic,
      criticCache: repoCriticCache(repo),
      synthModelId: MODEL_ID,
      threshold: mutationThreshold(),
    });
    const skipped = [...groundingSkips, ...review.withheld.map((w) => ({ requirement: w.requirement, reason: w.reason }))].sort((a, b) =>
      compareNatural(a.requirement, b.requirement)
    );
    log.info('functional.adversarial', {
      jobId,
      verdict: review.report.verdict,
      withheld: review.withheld.length,
      critic: review.report.critic.status,
    });

    const manifest: FunctionalManifest = {
      manifestVersion: 1,
      generator: FUNCTIONAL_GENERATOR_ID,
      modelId: MODEL_ID,
      promptVersion: PROMPT_VERSION,
      plans: review.kept,
      skipped,
      adversarial: review.block,
    };
    const artifacts = { manifest, files: emitFunctionalTests(review.kept), report: review.report };
    const artifactKey = await repo.putFunctionalArtifacts(jobId, artifacts);

    const done: FunctionalJobRecord = {
      ...base,
      status: 'succeeded',
      finishedAt: clock.now(),
      planCount: review.kept.length,
      skipCount: skipped.length,
      // Persist the catalog context + per-skip reasons on the job record itself
      // (R-124), not just in the S3 artifact manifest, mirroring R-89's run record.
      catalogContext: {
        contractCount: inputs.contracts.length,
        requirementCount: inputs.requirements.length,
        contracts: inputs.contracts.map((c) => ({ source: c.source, id: c.id, entity: c.entity, contentHash: c.contentHash })),
        requirements: inputs.requirements.map((r) => ({ source: r.source, id: r.id })),
      },
      skips: skipped,
      artifactKey,
      adversarial: { verdict: review.report.verdict, counts: review.report.counts },
    };
    await repo.writeFunctionalJob(done);
    log.info('functional.done', { jobId, planCount: review.kept.length, skipCount: skipped.length });
    return done;
  } catch (err) {
    const failed: FunctionalJobRecord = {
      ...base,
      status: 'failed',
      finishedAt: clock.now(),
      error: redact((err as Error).message ?? 'unknown error'),
    };
    await repo.writeFunctionalJob(failed);
    log.error('functional.failed', { jobId, error: failed.error });
    return failed;
  }
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * POST /generate-functional-tests — create a job, dispatch the worker, return
 * `202` immediately (R-115). Writer-only; the authorizer has already enforced
 * the group (R-115a). `dispatch` is injected so the offline test asserts the
 * job was created + dispatched without a real Lambda invoke.
 */
export async function handleGenerateFunctional(
  repo: FunctionalGenRepo,
  dispatch: (jobId: string) => Promise<void>,
  jobId: string,
  startedAt: string
): Promise<HttpResult> {
  await repo.writeFunctionalJob({
    jobId,
    status: 'pending',
    startedAt,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
  });
  await dispatch(jobId);
  log.info('functional.accepted', { jobId });
  return {
    statusCode: 202,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, status: 'pending', statusUrl: `/functional-test-jobs/${jobId}` }),
  };
}

// ---- Lambda entrypoints ----------------------------------------------------

/** POST entry: mint a job id and dispatch the worker asynchronously. */
export async function handler(): Promise<HttpResult> {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return handleGenerateFunctional(repository, dispatchWorker, jobId, new Date().toISOString());
}

/** Async worker entry: `{ jobId }` event → run the job to a terminal state. */
export async function worker(event: { jobId: string }): Promise<void> {
  // Import the Bedrock client lazily so the offline suite never loads the SDK.
  // Auth is the Lambda role (SigV4) — no secret to read; a Bedrock access/model
  // error surfaces through runFunctionalJob's catch as a `failed` job (R-124).
  const { createBedrockClient } = await import('./llm.js');
  const { createBedrockCritic } = await import('./critic-llm.js');
  const llm = createBedrockClient(MODEL_ID, process.env.AWS_REGION, PROMPT_VERSION);
  // The adversarial critic: a different model (CRITIC_MODEL_ID), same IAM role (R-139).
  const critic = createBedrockCritic({ region: process.env.AWS_REGION });
  await runFunctionalJob(event.jobId, repository, llm, { now: () => new Date().toISOString() }, critic);
}

/** Real dispatch: async-invoke the worker Lambda (name from the SST-bound env). */
async function dispatchWorker(jobId: string): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const FunctionName = process.env.FUNCTIONAL_WORKER_FUNCTION_NAME;
  if (!FunctionName) throw new Error('FUNCTIONAL_WORKER_FUNCTION_NAME is not set');
  const client = new LambdaClient({});
  await client.send(
    new InvokeCommand({
      FunctionName,
      InvocationType: 'Event', // fire-and-forget async (R-115)
      Payload: Buffer.from(JSON.stringify({ jobId })),
    })
  );
}
