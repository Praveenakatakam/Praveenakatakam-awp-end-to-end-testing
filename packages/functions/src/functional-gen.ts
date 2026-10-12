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
import { API_MAP, type PromptVersionRecord } from '@registry/core';
import { repository, type CatalogEntry, type RequirementRecord, type FunctionalJobRecord } from './repository.js';
import { log, redact } from './log.js';

/**
 * Model + prompt version defaults used when no explicit values are provided. The
 * model is a Bedrock model id / inference-profile id (default: the granted US
 * Sonnet 4.6 cross-region profile), overridable per-stage via `BEDROCK_MODEL_ID`
 * without a code change (D-55). The resolved modelId comes from the DDB prompt
 * record (T-07); MODEL_ID is kept as a fallback for offline tests.
 */
export const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
export const PROMPT_VERSION = 'v1';

/** The repository surface the job needs (injected so it is offline-testable). */
export interface FunctionalGenRepo {
  listEntries(filters?: Record<string, string>): Promise<CatalogEntry[]>;
  getRaw(source: string, id: string): Promise<string | undefined>;
  listRequirements(filters?: Record<string, unknown>): Promise<RequirementRecord[]>;
  writeFunctionalJob(job: FunctionalJobRecord): Promise<void>;
  /** Optional — only required in production; tests that do not exercise the DDB
   *  prompt-lookup path may omit this method. */
  getFunctionalJob?(jobId: string): Promise<FunctionalJobRecord | undefined>;
  putFunctionalArtifacts(jobId: string, artifacts: unknown): Promise<string>;
  getCachedPlan(inputHash: string): Promise<unknown>;
  putCachedPlan(inputHash: string, plan: unknown): Promise<void>;
  /** Optional — only required in production; tests that do not exercise the DDB
   *  prompt-lookup path may omit this method. */
  getPromptVersion?(promptVersion: string): Promise<PromptVersionRecord | undefined>;
}

/** Build the generator inputs from the CURRENT catalog snapshot (R-116). */
export async function buildFunctionalInputs(
  repo: FunctionalGenRepo,
  modelId = MODEL_ID,
  promptVersion = PROMPT_VERSION
): Promise<FunctionalGenInputs> {
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
  return { requirements, contracts, apiMap: API_MAP, modelId, promptVersion };
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
  modelId = MODEL_ID,
  promptVersion = PROMPT_VERSION
): Promise<FunctionalJobRecord> {
  const base: FunctionalJobRecord = {
    jobId,
    status: 'running',
    startedAt: clock.now(),
    modelId,
    promptVersion,
  };
  try {
    await repo.writeFunctionalJob(base);
    log.info('functional.start', { jobId });

    const inputs = await buildFunctionalInputs(repo, modelId, promptVersion);
    const { plans, skipped } = await generateFunctionalPlans(inputs, llm, repoPlanCache(repo));

    const manifest: FunctionalManifest = {
      manifestVersion: 1,
      generator: FUNCTIONAL_GENERATOR_ID,
      modelId,
      promptVersion,
      plans,
      skipped,
    };
    const artifacts = { manifest, files: emitFunctionalTests(plans) };
    const artifactKey = await repo.putFunctionalArtifacts(jobId, artifacts);

    const done: FunctionalJobRecord = {
      ...base,
      status: 'succeeded',
      finishedAt: clock.now(),
      planCount: plans.length,
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
    };
    await repo.writeFunctionalJob(done);
    log.info('functional.done', { jobId, planCount: plans.length, skipCount: skipped.length });
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
 *
 * When `repo.getPromptVersion` is available (production), the supplied
 * `promptVersion` is validated against DDB and the resolved `modelId` is stored
 * on the job record. When the method is absent (legacy test fakes), the module-
 * level `MODEL_ID` constant is used as a fallback so existing tests remain green.
 */
export async function handleGenerateFunctional(
  repo: FunctionalGenRepo,
  dispatch: (jobId: string) => Promise<void>,
  jobId: string,
  startedAt: string,
  promptVersion = PROMPT_VERSION
): Promise<HttpResult> {
  let resolvedModelId = MODEL_ID;

  if (repo.getPromptVersion) {
    const promptRecord = await repo.getPromptVersion(promptVersion);
    if (!promptRecord) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: `prompt version '${promptVersion}' not found` }),
      };
    }
    resolvedModelId = promptRecord.modelId;
  }

  await repo.writeFunctionalJob({
    jobId,
    status: 'pending',
    startedAt,
    modelId: resolvedModelId,
    promptVersion,
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
export async function handler(event: { body?: string }): Promise<HttpResult> {
  const body = event.body ? (JSON.parse(event.body) as { promptVersion?: unknown }) : {};
  const promptVersion = typeof body.promptVersion === 'string' ? body.promptVersion : PROMPT_VERSION;
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return handleGenerateFunctional(repository, dispatchWorker, jobId, new Date().toISOString(), promptVersion);
}

/** Async worker entry: `{ jobId }` event → run the job to a terminal state. */
export async function worker(event: { jobId: string }): Promise<void> {
  // Import the Bedrock client lazily so the offline suite never loads the SDK.
  // Auth is the Lambda role (SigV4) — no secret to read; a Bedrock access/model
  // error surfaces through runFunctionalJob's catch as a `failed` job (R-124).
  const { createBedrockClient } = await import('./llm.js');
  const { jobId } = event;

  // Load the job record so we know which prompt version (and hence model) to use.
  const jobRecord = await repository.getFunctionalJob(jobId);
  if (!jobRecord) {
    log.error('functional.worker.job-not-found', { jobId });
    return;
  }

  const { promptVersion, modelId } = jobRecord;

  // Fetch the prompt text from DDB — the handler already validated it exists,
  // but guard defensively and mark the job failed if somehow it is gone.
  const promptRecord = await repository.getPromptVersion(promptVersion);
  if (!promptRecord) {
    const failed: FunctionalJobRecord = {
      ...jobRecord,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `prompt version '${promptVersion}' not found in registry`,
    };
    await repository.writeFunctionalJob(failed);
    log.error('functional.worker.prompt-not-found', { jobId, promptVersion });
    return;
  }

  const llm = createBedrockClient(modelId, process.env.AWS_REGION, promptVersion, promptRecord.text);
  await runFunctionalJob(jobId, repository, llm, { now: () => new Date().toISOString() }, modelId, promptVersion);
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
