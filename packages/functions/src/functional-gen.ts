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
  ground,
  FUNCTIONAL_GENERATOR_ID,
  type FunctionalGenInputs,
  type FunctionalManifest,
  type LlmClient,
  type PlanCache,
  type ContractInput,
  type RequirementInput,
} from '@registry/functest';
import { API_MAP, type PromptVersionRecord } from '@registry/core';
import type {
  PipelineConfig,
  PipelineRun,
  SamplingConfig,
  ExecutionMode,
  SkippedRequirement,
  GeneratePipelineResponse,
} from '@registry/core';
import { selectRequirements } from '@registry/core';
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

/**
 * Extended repo interface for the pipeline dispatch path (T-08, R-17).
 * Adds pipeline config fetch and PRUN write capabilities on top of the base
 * functional-gen repo so the pipeline path remains injectable and testable.
 */
export interface PipelineDispatchDeps extends FunctionalGenRepo {
  /** Fetch a pipeline config item by pipelineId; returns undefined if not found. */
  getPipelineConfig(pipelineId: string): Promise<PipelineConfig | undefined>;
  /** Persist a new pipeline run record to DDB. */
  writePrun(prun: PipelineRun): Promise<void>;
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
 * Create a PRUN record in DDB and then dispatch Step 0 asynchronously.
 *
 * CRITICAL ordering: the DDB write MUST complete before the Lambda invoke to
 * avoid a race where the step worker wakes up before the run record exists.
 * Returns the runId of the created run.
 *
 * Design refs: design.md §Backward Compatibility, §Sampling and Execution Mode
 * Requirements: R-17, R-48, R-49
 */
export async function createAndDispatchPrun(
  deps: Pick<PipelineDispatchDeps, 'writePrun'>,
  dispatchStep: (runId: string) => Promise<void>,
  pipeline: PipelineConfig,
  requirementIds: string[],
  sampling: SamplingConfig,
  mode: ExecutionMode,
  runId: string,
  startedAt: string
): Promise<string> {
  const prun: PipelineRun = {
    pk: `PRUN#${runId}`,
    sk: 'PRUN',
    kind: 'PRUN',
    runId,
    pipelineId: pipeline.pipelineId,
    pipelineConfigVersion: pipeline.version,
    status: 'running',
    startedAt,
    sampling,
    mode,
    requirementIds,
    executedSteps: 0,
    warnings: [],
  };
  // Write DDB record first — step worker must see the run before it begins (R-17).
  await deps.writePrun(prun);
  // Fire-and-forget async dispatch (InvocationType: 'Event').
  await dispatchStep(runId);
  return runId;
}

/** `<source>/<id>` — requirement IDs are only unique within a source (R-57, D-24). */
export function qualifiedRequirementId(r: { source: string; id: string }): string {
  return `${r.source}/${r.id}`;
}

/**
 * Resolve a requirement identifier (qualified `<source>/<id>` or bare `<id>`)
 * against a list of qualified IDs (R-57, R-58). Returns the single match, no
 * match, or every candidate when a bare ID is ambiguous across sources.
 */
export function resolveRequirementId(
  id: string,
  qualifiedIds: string[]
): { kind: 'found'; id: string } | { kind: 'missing' } | { kind: 'ambiguous'; candidates: string[] } {
  if (qualifiedIds.includes(id)) return { kind: 'found', id };
  if (id.includes('/')) return { kind: 'missing' };
  const candidates = qualifiedIds.filter((q) => q.slice(q.indexOf('/') + 1) === id).sort();
  if (candidates.length === 0) return { kind: 'missing' };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  return { kind: 'found', id: candidates[0] };
}

/** Placeholder prompt version for eligibility grounding — only feeds `inputHash` (design §v0.4.0). */
const ELIGIBILITY_PROMPT_VERSION = 'eligibility';

function jsonResult(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * Handle the pipeline path of `POST /generate-functional-tests` (T-08, R-17).
 *
 * Grounds every catalog requirement first and samples only from the groundable
 * subset (R-55, D-23); requirement IDs are source-qualified `<source>/<id>`
 * end to end (R-57, D-24). Then dispatches:
 * - `per_requirement` (R-48): N independent PRUN records, one per selected req.
 * - `batch` (R-49): one PRUN record with all selected requirements.
 *
 * Returns HTTP 202 with `{ runIds, skipped }` for per_requirement or
 * `{ runId, skipped }` for batch. HTTP 422 `{ error, skipped }` when nothing
 * groundable is selected (R-56); HTTP 422 `{ error, candidates }` when an `ids`
 * entry is a bare ID shared by several sources (R-58).
 *
 * Legacy path (no pipelineId): caller falls through to the existing FJOB path
 * unchanged (D-13, backward compatibility).
 */
export async function handleGeneratePipeline(
  repo: PipelineDispatchDeps,
  dispatchStep: (runId: string) => Promise<void>,
  body: { pipelineId: string; sampling?: SamplingConfig; mode?: ExecutionMode },
  makeRunId: () => string,
  clock: { now(): string }
): Promise<HttpResult> {
  const { pipelineId, sampling: samplingOverride, mode: modeOverride } = body;
  // 1. Fetch and validate pipeline config.
  const pipeline = await repo.getPipelineConfig(pipelineId);
  if (!pipeline || !pipeline.active) {
    return jsonResult(422, { error: `Pipeline '${pipelineId}' not found or inactive` });
  }

  // 2. Resolve sampling and mode (run-request override merges over pipeline default, R-47, R-50).
  const resolvedSampling: SamplingConfig = samplingOverride ?? pipeline.defaultSampling;
  const resolvedMode: ExecutionMode = modeOverride ?? pipeline.defaultMode;

  // 3. Ground every catalog requirement BEFORE sampling (R-55, D-23). Eligibility
  //    does not depend on model/prompt version (those only feed inputHash).
  const inputs = await buildFunctionalInputs(repo);
  const model = pipeline.steps[0]?.model ?? MODEL_ID;
  const groundable: string[] = [];
  const ungroundable = new Map<string, string>();
  const allQualified: string[] = [];
  for (const req of inputs.requirements) {
    const qid = qualifiedRequirementId(req);
    allQualified.push(qid);
    const g = ground(req, inputs.contracts, inputs.apiMap, model, ELIGIBILITY_PROMPT_VERSION);
    if (g.ok) groundable.push(qid);
    else ungroundable.set(qid, g.reason);
  }
  groundable.sort();
  const byQid = (a: SkippedRequirement, b: SkippedRequirement) => a.requirement.localeCompare(b.requirement);

  // 4. Apply sampling strategy to the groundable subset (R-48, R-49, R-58).
  let selectedIds: string[];
  let skipped: SkippedRequirement[];
  if (resolvedSampling.strategy === 'ids') {
    // Each entry may be qualified or bare; a bare ID shared by several sources is
    // rejected (R-58). Named-but-ungroundable / unknown entries go into `skipped`.
    const resolved: string[] = [];
    skipped = [];
    for (const raw of resolvedSampling.ids) {
      const r = resolveRequirementId(raw, allQualified);
      if (r.kind === 'ambiguous') {
        return jsonResult(422, {
          error: `Ambiguous requirement id '${raw}' matches: ${r.candidates.join(', ')}`,
          candidates: r.candidates,
        });
      }
      if (r.kind === 'missing') {
        skipped.push({ requirement: raw, reason: 'not found in catalog' });
        continue;
      }
      const reason = ungroundable.get(r.id);
      if (reason !== undefined) {
        if (!skipped.some((s) => s.requirement === r.id)) skipped.push({ requirement: r.id, reason });
        continue;
      }
      resolved.push(r.id);
    }
    skipped.sort(byQid);
    selectedIds = selectRequirements(groundable, { strategy: 'ids', ids: resolved });
  } else {
    skipped = [...ungroundable.entries()].map(([requirement, reason]) => ({ requirement, reason })).sort(byQid);
    selectedIds = selectRequirements(groundable, resolvedSampling);
  }

  // 5. Nothing groundable selected → 422, no PRUN written (R-56).
  if (selectedIds.length === 0) {
    log.warn('functional.pipeline.nothing_groundable', { pipelineId, skippedCount: skipped.length });
    return jsonResult(422, { error: 'no groundable requirements', skipped });
  }

  const startedAt = clock.now();

  if (resolvedMode === 'per_requirement') {
    // 5a. per_requirement: one PRUN per selected requirement, N step chains (R-48, TS-30).
    const runIds: string[] = [];
    for (const reqId of selectedIds) {
      const runId = makeRunId();
      await createAndDispatchPrun(
        repo,
        dispatchStep,
        pipeline,
        [reqId],
        resolvedSampling,
        resolvedMode,
        runId,
        startedAt
      );
      runIds.push(runId);
    }
    log.info('functional.pipeline.accepted', {
      pipelineId,
      mode: resolvedMode,
      samplingStrategy: resolvedSampling.strategy,
      runCount: runIds.length,
      skippedCount: skipped.length,
    });
    const response: GeneratePipelineResponse = { runIds, skipped };
    return jsonResult(202, response);
  } else {
    // 5b. batch: one PRUN with all selected requirements (R-49, TS-31).
    const runId = makeRunId();
    await createAndDispatchPrun(
      repo,
      dispatchStep,
      pipeline,
      selectedIds,
      resolvedSampling,
      resolvedMode,
      runId,
      startedAt
    );
    log.info('functional.pipeline.accepted', {
      pipelineId,
      mode: resolvedMode,
      samplingStrategy: resolvedSampling.strategy,
      requirementCount: selectedIds.length,
      skippedCount: skipped.length,
      runId,
    });
    const response: GeneratePipelineResponse = { runId, skipped };
    return jsonResult(202, response);
  }
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
  const body = event.body
    ? (JSON.parse(event.body) as {
        promptVersion?: unknown;
        pipelineId?: unknown;
        sampling?: unknown;
        mode?: unknown;
      })
    : {};

  // New pipeline path — pipelineId present in body (D-13, R-17).
  if (typeof body.pipelineId === 'string') {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    const { getPipeline, putPrun: putPrunFn } = await import('./repository.js');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

    // Use Object.create so prototype methods from the Repository class are
    // accessible (spread would only copy own enumerable properties, missing
    // all prototype methods like listEntries, getRaw, etc.).
    const pipelineDeps = Object.assign(Object.create(repository) as FunctionalGenRepo, {
      getPipelineConfig: async (id: string) => getPipeline(ddb, id),
      writePrun: async (prun: PipelineRun) => putPrunFn(ddb, prun),
    }) as PipelineDispatchDeps;

    const samplingOverride =
      body.sampling && typeof body.sampling === 'object'
        ? (body.sampling as SamplingConfig)
        : undefined;
    const modeOverride =
      body.mode === 'per_requirement' || body.mode === 'batch'
        ? (body.mode as ExecutionMode)
        : undefined;

    return handleGeneratePipeline(
      pipelineDeps,
      dispatchStepZero,
      { pipelineId: body.pipelineId, sampling: samplingOverride, mode: modeOverride },
      () => crypto.randomUUID(),
      { now: () => new Date().toISOString() }
    );
  }

  // Legacy FJOB path — unchanged (backward compatibility, D-13).
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

/**
 * Dispatch Step 0 of a pipeline run asynchronously (fire-and-forget, R-17).
 * AWS SDK is lazily imported so offline tests never load it (NFR-8).
 */
async function dispatchStepZero(runId: string): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const FunctionName = process.env.STEP_WORKER_FUNCTION_NAME;
  if (!FunctionName) throw new Error('STEP_WORKER_FUNCTION_NAME is not set');
  const client = new LambdaClient({});
  await client.send(
    new InvokeCommand({
      FunctionName,
      InvocationType: 'Event', // fire-and-forget async (R-17)
      Payload: Buffer.from(JSON.stringify({ runId, stepIndex: 0 })),
    })
  );
}
