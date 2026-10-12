/**
 * Experiment handler and worker for prompt-versioning experiments (T-09 · R-20…R-34).
 *
 * Two-part async job: the API handler (`POST /experiments`) validates the prompt
 * version synchronously, writes an `EXP#{}` record in `pending` state, and
 * dispatches the `ExperimentWorker` via async Lambda invoke — returning `202`
 * immediately. The worker loads the experiment + prompt records, runs the full
 * functest pipeline against the specified prompt, stores the artifact to
 * `experiments/{experimentId}/artifacts.json`, and stamps the terminal status.
 *
 * The worker NEVER throws — all errors are caught and persisted as `failed` with
 * a redacted message (R-33, NFR-2/NFR-4). The handler ONLY writes the EXP#{}
 * record after `getPromptVersion` confirms the version exists (R-21).
 */
import {
  generateFunctionalPlans,
  emitFunctionalTests,
  type LlmClient,
} from '@registry/functest';
import type { ExperimentStatus, PromptVersionRecord } from '@registry/core';
import { repository } from './repository.js';
import { buildFunctionalInputs, repoPlanCache, type FunctionalGenRepo } from './functional-gen.js';
import { log, redact } from './log.js';

// ---- Repository interface the experiment runner needs ----------------------

export interface ExperimentRepo extends FunctionalGenRepo {
  getPromptVersion(promptVersion: string): Promise<PromptVersionRecord | undefined>;
  putExperiment(record: {
    experimentId: string;
    kind: 'EXPERIMENT';
    status: ExperimentStatus;
    promptVersion: string;
    createdAt: string;
    startedAt: string;
    createdBy: string;
    planCount?: number;
    skipCount?: number;
    skips?: string[];
    artifactKey?: string;
    error?: string;
  }): Promise<void>;
  updateExperiment(
    experimentId: string,
    patch: Partial<{
      status: ExperimentStatus;
      planCount: number;
      skipCount: number;
      skips: string[];
      artifactKey: string;
      error: string;
    }>
  ): Promise<void>;
  getExperiment(experimentId: string): Promise<
    | {
        experimentId: string;
        kind: 'EXPERIMENT';
        status: ExperimentStatus;
        promptVersion: string;
        createdAt: string;
        startedAt: string;
        createdBy: string;
      }
    | undefined
  >;
  putExperimentArtifact(experimentId: string, artifact: unknown): Promise<string>;
}

// ---- HTTP result type -------------------------------------------------------

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ---- Core logic (injectable — offline-testable) ----------------------------

/**
 * Build `FunctionalGenInputs` overriding the modelId, promptVersion, and system
 * prompt text from the given `PromptVersionRecord`. This is the experiment's
 * equivalent of `buildFunctionalInputs`, but with per-experiment prompt binding.
 */
export async function buildExperimentInputs(
  repo: FunctionalGenRepo,
  promptRecord: PromptVersionRecord
) {
  const base = await buildFunctionalInputs(repo);
  return {
    ...base,
    modelId: promptRecord.modelId,
    promptVersion: promptRecord.promptVersion,
  };
}

/**
 * Run one experiment end-to-end. Returns counts and the artifact S3 key.
 * The LLM client is built from the prompt record so the model + prompt text
 * can differ per-experiment (R-20, R-22).
 */
export async function runExperiment(
  experimentId: string,
  promptRecord: PromptVersionRecord,
  repo: ExperimentRepo
): Promise<{ planCount: number; skipCount: number; skips: string[]; artifactKey: string }> {
  // Import lazily — the offline test suite stubs `createBedrockClient` directly
  // so the Bedrock SDK is never loaded in tests (NFR-8).
  const { createBedrockClient } = await import('./llm.js');
  const llm: LlmClient = createBedrockClient(
    promptRecord.modelId,
    process.env.AWS_REGION,
    promptRecord.promptVersion,
    promptRecord.text
  );

  const inputs = await buildExperimentInputs(repo, promptRecord);
  const { plans, skipped } = await generateFunctionalPlans(inputs, llm, repoPlanCache(repo));

  const artifact = {
    manifest: {
      manifestVersion: 1,
      promptVersion: promptRecord.promptVersion,
      modelId: promptRecord.modelId,
      plans,
      skipped,
    },
    files: emitFunctionalTests(plans),
  };

  const artifactKey = await repo.putExperimentArtifact(experimentId, artifact);

  return {
    planCount: plans.length,
    skipCount: skipped.length,
    skips: skipped.map((s) => s.requirement),
    artifactKey,
  };
}

/**
 * Handler business logic (injectable for offline tests). Validates the
 * `promptVersion`, writes `EXP#{}` in `pending`, dispatches the worker, and
 * returns `202`. If the worker dispatch throws, the record is left in `pending`
 * and `500` is returned — no status update, matching the fault-isolation model.
 */
export async function handlePostExperiment(
  repo: ExperimentRepo,
  dispatch: (experimentId: string) => Promise<void>,
  experimentId: string,
  promptVersion: string,
  createdBy: string,
  now: string
): Promise<HttpResult> {
  const promptRecord = await repo.getPromptVersion(promptVersion);
  if (!promptRecord) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: `Unknown promptVersion: ${promptVersion}` }),
    };
  }

  await repo.putExperiment({
    experimentId,
    kind: 'EXPERIMENT',
    status: 'pending',
    promptVersion,
    createdAt: now,
    startedAt: now,
    createdBy,
  });

  try {
    await dispatch(experimentId);
  } catch (err) {
    log.error('experiment.dispatch_failed', { experimentId, error: redact((err as Error).message ?? 'unknown') });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to dispatch experiment worker' }),
    };
  }

  log.info('experiment.accepted', { experimentId, promptVersion });
  return {
    statusCode: 202,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ experimentId, statusUrl: `/experiments/${experimentId}` }),
  };
}

// ---- Lambda entrypoints ----------------------------------------------------

/** POST /experiments entry: mint an experiment id and dispatch the worker. */
export async function handler(event: {
  body?: string;
  requestContext?: { authorizer?: { lambda?: { username?: string } } };
}): Promise<HttpResult> {
  let promptVersion: string | undefined;
  try {
    const parsed = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    promptVersion = typeof parsed.promptVersion === 'string' ? parsed.promptVersion : undefined;
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  if (!promptVersion) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'promptVersion is required' }),
    };
  }

  const experimentId = crypto.randomUUID();
  const createdBy = event.requestContext?.authorizer?.lambda?.username ?? 'unknown';
  const now = new Date().toISOString();

  return handlePostExperiment(repository as unknown as ExperimentRepo, dispatchExperimentWorker, experimentId, promptVersion, createdBy, now);
}

/** Async worker entry: `{ experimentId }` event → run experiment to terminal state. */
export async function worker(event: { experimentId: string }): Promise<void> {
  const { experimentId } = event;

  const exp = await repository.getExperiment(experimentId);
  if (!exp) {
    log.error('experiment.worker_no_record', { experimentId });
    return;
  }

  await repository.updateExperiment(experimentId, { status: 'running' });
  log.info('experiment.running', { experimentId, promptVersion: exp.promptVersion });

  const promptRecord = await repository.getPromptVersion(exp.promptVersion);
  if (!promptRecord) {
    await repository.updateExperiment(experimentId, {
      status: 'failed',
      error: redact(`promptVersion not found: ${exp.promptVersion}`),
    });
    return;
  }

  try {
    const result = await runExperiment(experimentId, promptRecord, repository as unknown as ExperimentRepo);
    await repository.updateExperiment(experimentId, {
      status: 'succeeded',
      planCount: result.planCount,
      skipCount: result.skipCount,
      skips: result.skips,
      artifactKey: result.artifactKey,
    });
    log.info('experiment.succeeded', { experimentId, planCount: result.planCount, skipCount: result.skipCount });
  } catch (err) {
    const errorMsg = redact((err as Error).message ?? 'unknown error');
    await repository.updateExperiment(experimentId, {
      status: 'failed',
      error: errorMsg,
    });
    log.error('experiment.failed', { experimentId, error: errorMsg });
  }
}

/** Real dispatch: async-invoke the ExperimentWorker Lambda (name from the SST-bound env). */
async function dispatchExperimentWorker(experimentId: string): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const FunctionName = process.env.EXPERIMENT_WORKER_FUNCTION_NAME;
  if (!FunctionName) throw new Error('EXPERIMENT_WORKER_FUNCTION_NAME is not set');
  const client = new LambdaClient({});
  await client.send(
    new InvokeCommand({
      FunctionName,
      InvocationType: 'Event', // fire-and-forget async (R-21)
      Payload: Buffer.from(JSON.stringify({ experimentId })),
    })
  );
}
