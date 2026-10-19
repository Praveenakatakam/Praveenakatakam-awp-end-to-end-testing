/**
 * Pipeline CRUD handlers and step worker for the configurable LLM pipeline.
 *
 * T-03 adds the HTTP CRUD handlers for pipelines (listPipelines, createPipeline,
 * getPipeline, updatePipeline, deletePipeline).
 * T-04 adds the HTTP CRUD handlers for prompts (listPrompts, createPrompt,
 * getPrompt, updatePrompt, deletePrompt, listPromptVersions).
 * T-06 adds the `stepWorker` Lambda handler that executes a single pipeline step
 * using the 19-step sequence defined in design.md §"Execution sequence within
 * the step Lambda".
 *
 * Design refs: specs/active/configurable-llm-pipeline/design.md
 * Requirements: R-01–R-10, R-12…R-24, R-27–R-29, R-31–R-37, R-46, R-51, R-52
 */
import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { Table } from 'sst/node/table';
import { Bucket } from 'sst/node/bucket';
import type {
  PipelineConfig,
  PipelineStep,
  PromptItem,
  PromptVersionItem,
  SamplingConfig,
  ExecutionMode,
  StepOutputRef,
  StepOutputType,
} from '@registry/core';
import { STEP_OUTPUT_TYPES, resolveOutputType } from '@registry/core';
import type { GroundedContext } from '@registry/functest';
import { PLAN_SCHEMA, CRITIQUE_SCHEMA, validatePlan, validateCritique } from '@registry/functest';
import {
  getPrun,
  updatePrun,
  getPipeline,
  putPipeline,
  updatePipeline as updatePipelineRepo,
  listPipelines as listPipelinesRepo,
  listPrunSteps,
  getStepcache,
  putStepcacheConditional,
  getSysconfig,
  getPrmpt,
  putPrmpt,
  updatePrmpt,
  listPrmpts,
  putPrmptVer,
  listPrmptVers,
  getPrmptVer,
  stepSk,
  prunPk,
  pipelinePk,
  listActiveRunsByPipelineId,
  repository,
} from './repository.js';
import { json, notFound } from './http.js';
import { log, redact } from './log.js';

// ── Module-level AWS clients ──────────────────────────────────────────────────
const _ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const _s3 = new S3Client({});
const TABLE = Table.Registry.tableName;
const BUCKET = Bucket.Contracts.bucketName;

// ── T-06: Module constants (D-18) ────────────────────────────────────────────
/**
 * Hard circuit-breaker: runs older than this are timed_out regardless of
 * per-pipeline `maxAgeMinutes`. Not configurable per-pipeline (D-18, R-46).
 */
const SYSTEM_MAX_RUN_AGE_MINUTES = 5;

/** Duration each lease covers before expiry (5 minutes, R-18). */
const LEASE_DURATION_MS = 5 * 60 * 1_000;

/** Maximum transient Bedrock retries before reclassifying as terminal (R-21a). */
const MAX_TRANSIENT_RETRIES = 3;

/** Output size threshold: above this the step output is written to S3 (R-19). */
const OUTPUT_S3_THRESHOLD = 64 * 1_024; // 64 KB

/**
 * Total character budget for prior step outputs injected into a step's context
 * (R-63). Oldest outputs are truncated first when exceeded. Supersedes the
 * v0.3.0 fixed 2 000-character per-output cut.
 */
export const PRIOR_OUTPUT_BUDGET_CHARS = 60_000;

// ── T-03: Pipeline CRUD constants ────────────────────────────────────────────

/** Hard cap on maxSteps per pipeline (R-04). */
const SYSTEM_MAX_STEPS = 20;

/** Default maxSteps when not specified on create (R-05). */
const DEFAULT_MAX_STEPS = 10;

/** Default maxAgeMinutes when not specified. */
const DEFAULT_MAX_AGE_MINUTES = 60;

/** Default sampling config when not specified (R-45). */
const DEFAULT_SAMPLING: SamplingConfig = { strategy: 'first_n', n: 3 };

/** Default execution mode when not specified (R-45). */
const DEFAULT_MODE: ExecutionMode = 'per_requirement';

// ── T-04: Prompt CRUD constants ───────────────────────────────────────────────

/**
 * S3 key prefix for stored prompt bodies (R-34).
 * Full key pattern: `prompts/<promptKey>/<version>.txt`
 */
const PROMPT_S3_PREFIX = 'prompts';

/** Maximum inline body size (64 KB). Bodies larger than this are stored in S3 (R-34). */
const BODY_SIZE_THRESHOLD_BYTES = 64 * 1024;

// ── T-06: Internal types ──────────────────────────────────────────────────────
type PriorOutput = { stepId: string; label: string; output: string };
type GroundedContextWithPrior = GroundedContext & { priorOutputs?: PriorOutput[] };

interface BedrockStepResult {
  output: unknown;
  inputTokens: number;
  outputTokens: number;
}

/**
 * A step output that failed its output-type contract (R-64). Its `name` is not
 * in the transient set, so the retry loop treats it as terminal (non-retryable).
 */
export class StepValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepValidationError';
  }
}

// ── T-03: Shared event shape ──────────────────────────────────────────────────

interface ApiEvent {
  body?: string;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
}

// ── T-03: Validation helpers ──────────────────────────────────────────────────

/**
 * Validate pipeline steps against the model allowlist and prompt existence.
 * Also enforces the maxSteps hard cap (R-04) and steps.length ≤ maxSteps (R-03).
 * Returns an error string on failure, null on success.
 */
async function validatePipelineSteps(
  steps: PipelineStep[],
  maxSteps: number
): Promise<string | null> {
  if (maxSteps > SYSTEM_MAX_STEPS) {
    return `maxSteps cannot exceed the system hard cap of ${SYSTEM_MAX_STEPS}`;
  }

  if (steps.length > maxSteps) {
    return `steps.length (${steps.length}) exceeds maxSteps (${maxSteps})`;
  }

  // Fetch model allowlist (R-10)
  const sysconfig = await getSysconfig(_ddb);
  if (!sysconfig) {
    return 'model allowlist not found in system config; cannot validate step models';
  }

  const allowedModels = new Set(sysconfig.allowedModels);

  // outputType is optional (absent → 'plan', R-59) but must be a known value.
  for (const step of steps) {
    if (step.outputType !== undefined && !STEP_OUTPUT_TYPES.includes(step.outputType)) {
      return `step "${step.stepId}" has unknown outputType "${String(step.outputType)}" (expected one of: ${STEP_OUTPUT_TYPES.join(', ')})`;
    }
  }

  for (const step of steps) {
    if (!allowedModels.has(step.model)) {
      return `step "${step.stepId}" references model "${step.model}" which is not in the model allowlist`;
    }

    // Validate promptKey resolves to an active PRMPT item (R-06, R-52)
    const prompt = await getPrmpt(_ddb, step.promptKey);
    if (!prompt || !prompt.active) {
      return `step "${step.stepId}" references promptKey "${step.promptKey}" which does not resolve to an active prompt`;
    }
  }

  return null;
}

/**
 * Check whether a pipeline has any runs currently in status `running`.
 * Used by deletePipeline to enforce the active-run guard (R-09).
 */
async function pipelineHasActiveRuns(pipelineId: string): Promise<boolean> {
  const runs = await listActiveRunsByPipelineId(_ddb, pipelineId);
  return runs.length > 0;
}

// ── T-03: Handler: GET /pipelines ─────────────────────────────────────────────

/**
 * List active pipelines (paginated).
 * Returns summary shape: { pipelineId, name, stepCount, active, version, updatedAt }
 * Design: GET /pipelines response shape
 */
export async function listPipelines(event: ApiEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const nextToken = event.queryStringParameters?.nextToken ?? undefined;
  log.info('pipeline.list', {});

  const result = await listPipelinesRepo(_ddb, nextToken);

  const items = result.items
    .filter((p) => p.active)
    .map((p) => ({
      pipelineId: p.pipelineId,
      name: p.name,
      stepCount: p.steps.length,
      active: p.active,
      version: p.version,
      updatedAt: p.updatedAt,
    }));

  return json(200, {
    items,
    ...(result.nextToken ? { nextToken: result.nextToken } : {}),
  });
}

// ── T-03: Handler: POST /pipelines ────────────────────────────────────────────

/**
 * Create a pipeline config with validation.
 * Validates maxSteps cap, steps.length, model allowlist, and promptKey existence.
 * Sets defaults for maxSteps, defaultSampling, defaultMode, version, active.
 * Returns HTTP 201 on success, 422 on validation failure.
 */
export async function createPipeline(event: ApiEvent): Promise<APIGatewayProxyStructuredResultV2> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const name = typeof body.name === 'string' ? body.name : undefined;
  if (!name) {
    return json(422, { error: 'name is required' });
  }

  const steps = Array.isArray(body.steps) ? (body.steps as PipelineStep[]) : [];
  const maxSteps = typeof body.maxSteps === 'number' ? body.maxSteps : DEFAULT_MAX_STEPS;
  const maxAgeMinutes =
    typeof body.maxAgeMinutes === 'number' ? body.maxAgeMinutes : DEFAULT_MAX_AGE_MINUTES;

  const validationError = await validatePipelineSteps(steps, maxSteps);
  if (validationError) {
    return json(422, { error: validationError });
  }

  const defaultSampling: SamplingConfig =
    body.defaultSampling != null ? (body.defaultSampling as SamplingConfig) : DEFAULT_SAMPLING;

  const defaultMode: ExecutionMode =
    body.defaultMode === 'per_requirement' || body.defaultMode === 'batch'
      ? body.defaultMode
      : DEFAULT_MODE;

  const pipelineId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { pk, sk } = pipelinePk(pipelineId);

  const item: PipelineConfig = {
    pk,
    sk,
    kind: 'PIPELINE',
    pipelineId,
    name,
    steps,
    maxSteps,
    maxAgeMinutes,
    active: true,
    defaultSampling,
    defaultMode,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  await putPipeline(_ddb, item);
  log.info('pipeline.created', { pipelineId, stepCount: steps.length });

  return json(201, { pipelineId, version: 1, createdAt: now });
}

// ── T-03: Handler: GET /pipelines/{id} ───────────────────────────────────────

/**
 * Return the full pipeline config for the given pipelineId.
 * Returns HTTP 200 with the full config, or 404 when not found.
 */
export async function getPipelineById(
  event: ApiEvent
): Promise<APIGatewayProxyStructuredResultV2> {
  const pipelineId = event.pathParameters?.id;
  if (!pipelineId) {
    return notFound('pipelineId path parameter is required');
  }

  const pipeline = await getPipeline(_ddb, pipelineId);
  if (!pipeline) {
    return notFound(`pipeline ${pipelineId} not found`);
  }

  log.info('pipeline.get', { pipelineId });
  return json(200, pipeline);
}

// SST route registration uses the export name from design.md: getPipeline
export { getPipelineById as getPipeline };

// ── T-03: Handler: PUT /pipelines/{id} ───────────────────────────────────────

/**
 * Update a pipeline config.
 * Applies same validations as create (model allowlist, maxSteps cap, steps count,
 * promptKey existence). Increments version and sets updatedAt (R-07).
 * Returns HTTP 200 with new version, 404 when not found, 422 on validation failure.
 */
export async function updatePipeline(event: ApiEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const pipelineId = event.pathParameters?.id;
  if (!pipelineId) {
    return notFound('pipelineId path parameter is required');
  }

  const existing = await getPipeline(_ddb, pipelineId);
  if (!existing) {
    return notFound(`pipeline ${pipelineId} not found`);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  // Resolve the final state by merging body fields over existing config
  const steps = Array.isArray(body.steps) ? (body.steps as PipelineStep[]) : existing.steps;
  const maxSteps = typeof body.maxSteps === 'number' ? body.maxSteps : existing.maxSteps;

  const validationError = await validatePipelineSteps(steps, maxSteps);
  if (validationError) {
    return json(422, { error: validationError });
  }

  const now = new Date().toISOString();
  const newVersion = existing.version + 1;

  const patch: Partial<PipelineConfig> = {
    version: newVersion,
    updatedAt: now,
    steps,
    maxSteps,
  };

  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.maxAgeMinutes === 'number') patch.maxAgeMinutes = body.maxAgeMinutes;
  if (body.defaultSampling != null) patch.defaultSampling = body.defaultSampling as SamplingConfig;
  if (body.defaultMode === 'per_requirement' || body.defaultMode === 'batch') {
    patch.defaultMode = body.defaultMode;
  }
  if (typeof body.active === 'boolean') patch.active = body.active;

  await updatePipelineRepo(_ddb, pipelineId, patch);
  log.info('pipeline.updated', { pipelineId, newVersion });

  return json(200, { pipelineId, version: newVersion, updatedAt: now });
}

// ── T-03: Handler: DELETE /pipelines/{id} ────────────────────────────────────

/**
 * Soft-delete a pipeline by setting active:false (R-08).
 * Rejects with HTTP 409 if the pipeline has any runs in status `running` (R-09).
 * Returns HTTP 200 on success, 404 when not found, 409 on active-run conflict.
 */
export async function deletePipeline(event: ApiEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const pipelineId = event.pathParameters?.id;
  if (!pipelineId) {
    return notFound('pipelineId path parameter is required');
  }

  const existing = await getPipeline(_ddb, pipelineId);
  if (!existing) {
    return notFound(`pipeline ${pipelineId} not found`);
  }

  // Guard: reject if any run is currently running (R-09)
  const activeRunsExist = await pipelineHasActiveRuns(pipelineId);
  if (activeRunsExist) {
    return json(409, {
      error: `pipeline ${pipelineId} has active runs in status "running"; stop all runs before deleting`,
    });
  }

  const now = new Date().toISOString();
  await updatePipelineRepo(_ddb, pipelineId, { active: false, updatedAt: now });
  log.info('pipeline.deleted', { pipelineId });

  return json(200, { pipelineId, active: false });
}

// ── T-04: Prompt CRUD helpers ─────────────────────────────────────────────────

/** Zero-pad a version number to 5 digits (e.g. `1` → `00001`). */
function padVersion(v: number): string {
  return String(v).padStart(5, '0');
}

/**
 * Store a prompt body in S3 and return the S3 object key (R-34).
 * Key format: `prompts/<promptKey>/<padded-version>.txt`
 */
async function storeBodyInS3(promptKey: string, version: number, body: string): Promise<string> {
  const key = `${PROMPT_S3_PREFIX}/${promptKey}/${padVersion(version)}.txt`;
  await _s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'text/plain; charset=utf-8',
    })
  );
  return key;
}

/** Fetch the body of a prompt stored in S3; returns empty string on an absent body stream. */
async function fetchBodyFromS3(s3Key: string): Promise<string> {
  const obj = await _s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  if (!obj.Body) return '';
  return (obj.Body as { transformToString(): Promise<string> }).transformToString();
}

/**
 * Determine storage disposition for a prompt body (R-34).
 * Returns `{ inlineBody, s3Ref }` where exactly one is defined.
 */
async function resolveBodyStorage(
  promptKey: string,
  version: number,
  body: string
): Promise<{ inlineBody?: string; s3Ref?: string }> {
  const bytes = Buffer.byteLength(body, 'utf-8');
  if (bytes > BODY_SIZE_THRESHOLD_BYTES) {
    const s3Ref = await storeBodyInS3(promptKey, version, body);
    log.info('pipeline.prompt.largeBodyStoredInS3', { promptKey, version, s3Ref, bytes });
    return { s3Ref };
  }
  return { inlineBody: body };
}

/**
 * Scan one page of active pipelines and return a promptKey → pipelineId[] map
 * (best-effort; pagination beyond the first page is intentionally skipped — R-37).
 */
async function computeUsedByPipelines(
  promptKeys: string[]
): Promise<Record<string, string[]>> {
  if (promptKeys.length === 0) return {};

  const keySet = new Set(promptKeys);
  const usedBy: Record<string, string[]> = {};
  for (const k of promptKeys) usedBy[k] = [];

  try {
    const { items: pipelines } = await listPipelinesRepo(_ddb);
    for (const pipeline of pipelines as PipelineConfig[]) {
      if (!pipeline.active) continue;
      for (const step of pipeline.steps) {
        if (keySet.has(step.promptKey)) {
          const list = (usedBy[step.promptKey] ??= []);
          if (!list.includes(pipeline.pipelineId)) {
            list.push(pipeline.pipelineId);
          }
        }
      }
    }
  } catch (err) {
    // Best-effort — do not fail the list response if the pipeline scan fails.
    log.warn('pipeline.listPrompts.usedByPipelinesScanFailed', { error: String(err) });
  }

  return usedBy;
}

/**
 * Return the pipeline IDs of every active pipeline that has at least one step
 * referencing `promptKey` (R-52 reference check).
 */
async function findActivePipelineRefs(promptKey: string): Promise<string[]> {
  try {
    const { items: pipelines } = await listPipelinesRepo(_ddb);
    return (pipelines as PipelineConfig[])
      .filter((p) => p.active && p.steps.some((s) => s.promptKey === promptKey))
      .map((p) => p.pipelineId);
  } catch {
    // Conservative: if we cannot confirm refs, treat as safe (return empty).
    return [];
  }
}

// ── T-04: GET /prompts — list active prompts (R-37, R-52) ────────────────────

/**
 * List active prompts, paginated via `nextToken`.
 * Includes a best-effort `usedByPipelines` field on each item.
 * Soft-deleted prompts (active: false) are excluded (R-52).
 */
export async function listPrompts(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const nextToken = event.queryStringParameters?.nextToken;
  const { items, nextToken: responseNextToken } = await listPrmpts(_ddb, nextToken);

  const promptKeys = items.map((i) => i.promptKey);
  const usedByMap = await computeUsedByPipelines(promptKeys);

  const responseItems = items.map((item) => ({
    promptKey: item.promptKey,
    currentVersion: item.currentVersion,
    updatedAt: item.updatedAt,
    usedByPipelines: usedByMap[item.promptKey] ?? [],
  }));

  return json(200, {
    items: responseItems,
    ...(responseNextToken ? { nextToken: responseNextToken } : {}),
  });
}

// ── T-04: POST /prompts — create a prompt (R-31, R-34) ───────────────────────

/**
 * Create a new prompt. Writes a PRMPT header record (currentVersion: 1,
 * active: true) and an immutable PRMPTVER#key#00001 version record.
 * Bodies larger than 64 KB are stored in S3 (R-34).
 * Returns HTTP 201.
 */
export async function createPrompt(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  let parsed: { promptKey?: unknown; body?: unknown };
  try {
    parsed = JSON.parse(event.body ?? '{}') as typeof parsed;
  } catch {
    return json(400, { error: 'request body is not valid JSON' });
  }

  const { promptKey, body: promptBody } = parsed;
  if (!promptKey || typeof promptKey !== 'string') {
    return json(422, { error: 'promptKey is required and must be a string' });
  }
  if (typeof promptBody !== 'string') {
    return json(422, { error: 'body is required and must be a string' });
  }

  const now = new Date().toISOString();
  const version = 1;
  const { inlineBody, s3Ref } = await resolveBodyStorage(promptKey, version, promptBody);

  const promptItem: PromptItem = {
    pk: `PRMPT#${promptKey}`,
    sk: 'PRMPT',
    kind: 'PRMPT',
    promptKey,
    currentVersion: version,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };

  const versionItem: PromptVersionItem = {
    pk: `PRMPTVER#${promptKey}#${padVersion(version)}`,
    sk: 'PRMPTVER',
    kind: 'PRMPTVER',
    promptKey,
    version,
    createdAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };

  await putPrmpt(_ddb, promptItem);
  await putPrmptVer(_ddb, versionItem);

  log.info('pipeline.createPrompt', { promptKey, version });
  return json(201, { promptKey, currentVersion: version, createdAt: now });
}

// ── T-04: GET /prompts/{key} — get current prompt with body (R-34) ───────────

/**
 * Fetch the current version of a prompt including its body.
 * If the body is stored in S3 (s3Ref set on the header item), it is fetched
 * and included in the response (R-34).
 * Returns 404 if the prompt is not found or is soft-deleted (R-52).
 */
export async function getPrompt(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const { key } = event.pathParameters ?? {};
  if (!key) return notFound();

  const item = await getPrmpt(_ddb, key);
  if (!item || !item.active) return notFound(`prompt '${key}' not found`);

  // Resolve body: inline on DDB item takes precedence; fall back to S3 fetch.
  let body: string | undefined = item.body;
  if (!body && item.s3Ref) {
    body = await fetchBodyFromS3(item.s3Ref);
  }

  return json(200, {
    promptKey: item.promptKey,
    currentVersion: item.currentVersion,
    active: item.active,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    body,
  });
}

// ── T-04: PUT /prompts/{key} — update prompt (R-32) ──────────────────────────

/**
 * Update a prompt by writing a new immutable PRMPTVER record and incrementing
 * `currentVersion` on the PRMPT header. The previous version body is never
 * overwritten (R-32). Returns HTTP 200.
 */
export async function updatePrompt(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const { key } = event.pathParameters ?? {};
  if (!key) return notFound();

  const existing = await getPrmpt(_ddb, key);
  if (!existing || !existing.active) return notFound(`prompt '${key}' not found`);

  let parsed: { body?: unknown };
  try {
    parsed = JSON.parse(event.body ?? '{}') as typeof parsed;
  } catch {
    return json(400, { error: 'request body is not valid JSON' });
  }

  const { body: promptBody } = parsed;
  if (typeof promptBody !== 'string') {
    return json(422, { error: 'body is required and must be a string' });
  }

  const now = new Date().toISOString();
  const newVersion = existing.currentVersion + 1;
  const { inlineBody, s3Ref } = await resolveBodyStorage(key, newVersion, promptBody);

  // Write new immutable version record (R-32).
  const versionItem: PromptVersionItem = {
    pk: `PRMPTVER#${key}#${padVersion(newVersion)}`,
    sk: 'PRMPTVER',
    kind: 'PRMPTVER',
    promptKey: key,
    version: newVersion,
    createdAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };
  await putPrmptVer(_ddb, versionItem);

  // Overwrite the header item to update currentVersion and body/s3Ref cleanly.
  // Using putPrmpt (full overwrite) rather than updatePrmpt so that switching
  // between inline and S3 storage correctly removes the stale field — there is
  // no REMOVE expression path in updatePrmpt (D-11 immutability note).
  const updatedHeader: PromptItem = {
    pk: existing.pk,
    sk: existing.sk,
    kind: 'PRMPT',
    promptKey: key,
    currentVersion: newVersion,
    active: existing.active,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(inlineBody !== undefined ? { body: inlineBody } : {}),
    ...(s3Ref !== undefined ? { s3Ref } : {}),
  };
  await putPrmpt(_ddb, updatedHeader);

  log.info('pipeline.updatePrompt', { promptKey: key, version: newVersion });
  return json(200, { promptKey: key, currentVersion: newVersion, updatedAt: now });
}

// ── T-04: DELETE /prompts/{key} — soft-delete prompt (R-52, R-33) ────────────

/**
 * Soft-delete a prompt by setting `active: false` on the PRMPT header item.
 * Version records are NOT deleted (R-32).
 * Returns HTTP 422 if any active pipeline step references this promptKey (R-52).
 * Returns HTTP 200 on success.
 */
export async function deletePrompt(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const { key } = event.pathParameters ?? {};
  if (!key) return notFound();

  const existing = await getPrmpt(_ddb, key);
  if (!existing) return notFound(`prompt '${key}' not found`);

  // R-52: block soft-delete if any active pipeline has a step using this prompt.
  const refs = await findActivePipelineRefs(key);
  if (refs.length > 0) {
    log.warn('pipeline.deletePrompt.blockedByPipelineRefs', { promptKey: key, pipelineIds: refs });
    return json(422, {
      error: `prompt '${key}' is referenced by active pipeline(s): ${refs.join(', ')}`,
    });
  }

  await updatePrmpt(_ddb, key, { active: false, updatedAt: new Date().toISOString() });

  log.info('pipeline.deletePrompt', { promptKey: key });
  return json(200, { promptKey: key, active: false });
}

// ── T-04: GET /prompts/{key}/versions — list version records (R-32, R-37) ────

/**
 * List all immutable version records for a prompt.
 * Returns `{ promptKey, versions: [{ version, createdAt }] }`.
 * Returns 404 if the prompt does not exist.
 */
export async function listPromptVersions(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  const { key } = event.pathParameters ?? {};
  if (!key) return notFound();

  const existing = await getPrmpt(_ddb, key);
  if (!existing) return notFound(`prompt '${key}' not found`);

  const versions = await listPrmptVers(_ddb, key);

  return json(200, {
    promptKey: key,
    versions: versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
    })),
  });
}

// ── T-06: Helpers ─────────────────────────────────────────────────────────────

/**
 * Find a run's requirement in the catalog by its source-qualified ID (R-57).
 * Bare IDs (runs created before v0.4.0) resolve only when unambiguous.
 */
export function resolveRunRequirement<R extends { source: string; id: string }>(
  requirementId: string,
  requirements: R[]
): { ok: true; requirement: R } | { ok: false; error: string } {
  const qualified = requirements.find((r) => `${r.source}/${r.id}` === requirementId);
  if (qualified) return { ok: true, requirement: qualified };
  if (!requirementId.includes('/')) {
    const bare = requirements.filter((r) => r.id === requirementId);
    if (bare.length === 1) return { ok: true, requirement: bare[0] };
    if (bare.length > 1) {
      const candidates = bare.map((r) => `${r.source}/${r.id}`).sort();
      return { ok: false, error: `Ambiguous requirement id '${requirementId}' matches: ${candidates.join(', ')}` };
    }
  }
  return { ok: false, error: `Requirement '${requirementId}' not found in catalog` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format the user-turn message for Bedrock from a GroundedContext.
 * Mirrors the private `userPrompt` function in `llm.ts` so the step worker
 * can call Bedrock directly and capture usage metrics (TS-32).
 */
function userMessageFromContext(ctx: GroundedContextWithPrior): string {
  const schema = ctx.schema
    .map((p) => `  - ${p.name}${p.required ? ' (required)' : ''}: ${p.logicalType ?? 'unknown'}`)
    .join('\n');
  const targets = ctx.apiTargets
    .map((t) => `  - ${t.source}: ${t.target.path} (records at "${t.target.recordsAt}")`)
    .join('\n');

  const parts = [
    `Requirement ${ctx.requirement.id} (${ctx.requirement.earsType}, §${ctx.requirement.section}) from the ${ctx.requirement.source} service:`,
    `  "${ctx.requirement.text}"`,
    ``,
    `Entity under test: ${ctx.entity}`,
    `Sources that handle this entity (allowed trigger.source values): ${ctx.sources.join(', ')}`,
    ``,
    `Contract schema for ${ctx.entity}:`,
    schema || '  (no properties)',
    ``,
    `Live API targets:`,
    targets,
  ];

  if (ctx.priorOutputs && ctx.priorOutputs.length > 0) {
    // Outputs arrive already fitted to PRIOR_OUTPUT_BUDGET_CHARS (R-63).
    parts.push('', 'Prior step outputs (use as context for this step):');
    for (const prior of ctx.priorOutputs) {
      parts.push(`  Step ${prior.stepId} — ${prior.label}:`);
      parts.push(`    ${prior.output}`);
    }
  }

  return parts.join('\n');
}

/**
 * Fit prior step outputs into a total character budget (R-63). Walks newest →
 * oldest keeping each output in full while it fits; the first that does not fit
 * is cut to the remaining budget with a `[truncated N chars]` marker, and every
 * older output is reduced to the marker alone. Order is preserved.
 */
export function buildPriorContext(
  outputs: PriorOutput[],
  budget: number = PRIOR_OUTPUT_BUDGET_CHARS
): { outputs: PriorOutput[]; truncated: boolean } {
  const fitted: PriorOutput[] = new Array(outputs.length);
  let remaining = budget;
  let truncated = false;
  for (let i = outputs.length - 1; i >= 0; i--) {
    const o = outputs[i];
    if (o.output.length <= remaining) {
      fitted[i] = o;
      remaining -= o.output.length;
      continue;
    }
    truncated = true;
    const keep = Math.max(0, remaining);
    const cut = o.output.length - keep;
    const marker = `[truncated ${cut} chars]`;
    fitted[i] = { ...o, output: keep > 0 ? `${o.output.slice(0, keep)}\n${marker}` : marker };
    remaining = 0;
  }
  return { outputs: fitted, truncated };
}

/** Bedrock tool contract per step output type (R-60). `freeform` has none. */
const STEP_TOOLS: Record<Exclude<StepOutputType, 'freeform'>, { name: string; description: string; input_schema: unknown }> = {
  plan: {
    name: 'emit_functional_test_plan',
    description: 'Return the single cross-service functional test plan for the given requirement.',
    input_schema: PLAN_SCHEMA,
  },
  critique: {
    name: 'emit_critique',
    description: 'Return a structured critique of the prior step outputs for the given requirement.',
    input_schema: CRITIQUE_SCHEMA,
  },
};

/**
 * Validate a step's raw output against its output-type contract (R-64). Plans
 * are checked against PLAN_SCHEMA v2 and the grounding (entity, trigger source,
 * every assertion service); critiques against CRITIQUE_SCHEMA. Throws
 * `StepValidationError` (terminal) with the validation reason.
 */
export function validateStepOutput(
  outputType: StepOutputType,
  raw: unknown,
  grounded: { entity: string; sources: string[] }
): void {
  if (outputType === 'plan') {
    const v = validatePlan(raw, grounded);
    if (!v.ok) throw new StepValidationError(v.reason);
  } else if (outputType === 'critique') {
    const v = validateCritique(raw);
    if (!v.ok) throw new StepValidationError(v.reason);
  } else if (typeof raw !== 'string' || raw.length === 0) {
    throw new StepValidationError('freeform step returned no text');
  }
}

/**
 * Invoke Bedrock directly for a pipeline step, returning both the plan output
 * and token usage needed for metrics (TS-32, R-51).
 *
 * Uses the same forced-tool-use pattern as `llm.ts`. AWS SDK is lazily
 * imported so offline unit tests never load it (NFR-8).
 *
 * Spec drift note: the design says "use createBedrockClient from llm.ts" but
 * that interface returns only the plan body (no usage). Calling Bedrock directly
 * here satisfies TS-32's requirement that inputTokens/outputTokens be numeric.
 */
async function callBedrockForStep(
  model: string,
  region: string | undefined,
  systemPrompt: string,
  context: GroundedContextWithPrior,
  outputType: StepOutputType
): Promise<BedrockStepResult> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient(region ? { region } : {});

  // Shape the call by outputType (R-60): plan/critique force their tool;
  // freeform sends no tools and the text blocks are the output.
  const tool = outputType === 'freeform' ? undefined : STEP_TOOLS[outputType];
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessageFromContext(context) }],
    ...(tool
      ? {
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
        }
      : {}),
  };

  const res = await client.send(
    new InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    })
  );

  const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
    content?: { type: string; input?: unknown; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const usage = decoded.usage ?? { input_tokens: 0, output_tokens: 0 };

  if (!tool) {
    const text = (decoded.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    return { output: text, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }

  const block = (decoded.content ?? []).find((b) => b.type === 'tool_use');
  if (!block) {
    throw new Error(`no tool_use block in Bedrock response (stop_reason=${decoded.stop_reason})`);
  }

  return {
    output: block.input,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}

/**
 * Dispatch the next step Lambda asynchronously (fire-and-forget, R-17).
 * AWS SDK is lazily imported so offline tests never load it (NFR-8).
 */
async function dispatchNextStep(runId: string, stepIndex: number): Promise<void> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  // AWS_LAMBDA_FUNCTION_NAME is injected automatically by the Lambda runtime — no CDK self-reference needed.
  const FunctionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!FunctionName) throw new Error('AWS_LAMBDA_FUNCTION_NAME is not set (is this running in Lambda?)');
  const client = new LambdaClient({});
  await client.send(
    new InvokeCommand({
      FunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ runId, stepIndex })),
    })
  );
}

/**
 * Write a terminal status and optional error fields to a step record.
 * Also clears `leaseExpiresAt` (R-19).
 */
async function _writeStepTerminal(
  pkVal: string,
  skVal: string,
  status: 'failed' | 'warning',
  fields: { errorMessage?: string; errorStack?: string; completedAt: string }
): Promise<void> {
  const setParts = ['#status = :status', 'completedAt = :completedAt'];
  const exprValues: Record<string, unknown> = {
    ':status': status,
    ':completedAt': fields.completedAt,
  };
  if (fields.errorMessage) {
    setParts.push('errorMessage = :em');
    exprValues[':em'] = fields.errorMessage;
  }
  if (fields.errorStack) {
    setParts.push('errorStack = :es');
    exprValues[':es'] = fields.errorStack;
  }
  await _ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pkVal, SK: skVal },
      UpdateExpression: `SET ${setParts.join(', ')} REMOVE leaseExpiresAt`,
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: exprValues,
    })
  );
}

/**
 * Mark the run as failed and write error details to the PRUN record.
 * Wraps `updatePrun` in try/catch because the run may already be terminal.
 */
async function _failRun(
  runId: string,
  step: PipelineStep,
  errorMessage: string,
  errorStack?: string
): Promise<void> {
  try {
    await updatePrun(_ddb, runId, {
      status: 'failed',
      failedAt: new Date().toISOString(),
      errorMessage: redact(errorMessage),
      ...(errorStack ? { errorStack: redact(errorStack) } : {}),
    });
  } catch {
    /* ConditionalCheckFailedException — run already in terminal state; ignore */
  }
  log.error('step.worker.step_failed_run', {
    runId,
    stepId: step.stepId,
    error: redact(errorMessage),
  });
}

// ── stepWorker ────────────────────────────────────────────────────────────────

/**
 * Step Lambda handler — executes one step of a pipeline run.
 *
 * Event payload: `{ runId: string; stepIndex: number }`.
 * Invoked via `InvocationType: 'Event'` with `retryAttempts: 0` so AWS never
 * re-invokes on failure (D-10). All errors are caught internally — this
 * function does not throw.
 */
export const stepWorker = async (event: { runId: string; stepIndex: number }): Promise<void> => {
  const { runId, stepIndex } = event;
  try {
    await _stepWorkerCore(runId, stepIndex);
  } catch (err) {
    log.error('step.worker.unhandled_error', {
      runId,
      stepIndex,
      error: redact((err as Error).message ?? 'unknown'),
      stack: redact((err as Error).stack ?? ''),
    });
  }
};

async function _stepWorkerCore(runId: string, stepIndex: number): Promise<void> {
  // ── 1. Read PRUN record ───────────────────────────────────────────────────
  const run = await getPrun(_ddb, runId);
  if (!run) {
    log.error('step.worker.run_not_found', { runId, stepIndex });
    return;
  }

  // ── 0. System cap check — first check after reading run (R-46, D-18, TS-28)
  // No lease is written and no Bedrock call is made if this check fails.
  const workerStartMs = Date.now();
  if (workerStartMs - new Date(run.startedAt).getTime() > SYSTEM_MAX_RUN_AGE_MINUTES * 60_000) {
    log.warn('step.worker.system_cap_exceeded', {
      runId,
      stepIndex,
      maxMinutes: SYSTEM_MAX_RUN_AGE_MINUTES,
    });
    try {
      await updatePrun(_ddb, runId, {
        status: 'timed_out',
        completedAt: new Date(workerStartMs).toISOString(),
      });
    } catch {
      /* already terminal — ConditionalCheckFailedException silently ignored */
    }
    return;
  }

  // ── 2. Read pipeline config ───────────────────────────────────────────────
  const pipeline = await getPipeline(_ddb, run.pipelineId);
  if (!pipeline || !pipeline.active) {
    log.error('step.worker.pipeline_not_found', { runId, pipelineId: run.pipelineId });
    try {
      await updatePrun(_ddb, runId, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: `Pipeline ${run.pipelineId} not found or inactive`,
      });
    } catch {}
    return;
  }

  // ── 3. Resolve step at stepIndex ─────────────────────────────────────────
  const step: PipelineStep | undefined = pipeline.steps[stepIndex];
  if (!step) {
    log.error('step.worker.step_not_found', { runId, stepIndex, totalSteps: pipeline.steps.length });
    try {
      await updatePrun(_ddb, runId, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: `Step index ${stepIndex} out of bounds (pipeline has ${pipeline.steps.length} steps)`,
      });
    } catch {}
    return;
  }

  // ── 4. waitForHuman — log warning and continue (R-14, TS-10) ─────────────
  if (step.waitForHuman) {
    log.warn('step.worker.wait_for_human_noop', {
      runId,
      stepIndex,
      stepId: step.stepId,
      note: 'waitForHuman is a no-op in v1 (R-14)',
    });
    // Execution continues normally — no halt.
  }

  // ── 5. Write lease — before any Bedrock call (R-18, TS-13) ───────────────
  const leaseWriteMs = Date.now();
  const { pk: prunPkVal } = prunPk(runId);
  const stepSkVal = stepSk(stepIndex);

  await _ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: prunPkVal,
        SK: stepSkVal,
        stepId: step.stepId,
        stepIndex,
        label: step.label,
        model: step.model,
        promptKey: step.promptKey,
        promptVersion: 0,  // updated after prompt fetch
        status: 'running',
        leaseExpiresAt: new Date(leaseWriteMs + LEASE_DURATION_MS).toISOString(),
        cacheKey: '',       // updated after cache key computation
        startedAt: new Date(leaseWriteMs).toISOString(),
      },
    })
  );

  // ── Fetch prompt header to obtain current version (needed for cache key) ──
  const promptHeader = await getPrmpt(_ddb, step.promptKey);
  if (!promptHeader || !promptHeader.active) {
    await _writeStepTerminal(prunPkVal, stepSkVal, 'failed', {
      errorMessage: redact(`Prompt '${step.promptKey}' not found or inactive`),
      completedAt: new Date().toISOString(),
    });
    await _failRun(runId, step, `Prompt '${step.promptKey}' not found or inactive`);
    return;
  }
  const promptVersion = promptHeader.currentVersion;

  // Persist resolved promptVersion on step record
  await _ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: prunPkVal, SK: stepSkVal },
      UpdateExpression: 'SET promptVersion = :pv',
      ExpressionAttributeValues: { ':pv': promptVersion },
    })
  );

  // ── 7. Fetch prompt body (inline or S3) ───────────────────────────────────
  // (Cache key is computed after grounding, which needs the prompt version.)
  const promptVerItem = await getPrmptVer(_ddb, step.promptKey, promptVersion);
  if (!promptVerItem) {
    await _writeStepTerminal(prunPkVal, stepSkVal, 'failed', {
      errorMessage: redact(`Prompt version ${promptVersion} for '${step.promptKey}' not found`),
      completedAt: new Date().toISOString(),
    });
    await _failRun(runId, step, `Prompt version ${promptVersion} for '${step.promptKey}' not found`);
    return;
  }

  let promptBody: string;
  if (promptVerItem.s3Ref) {
    const obj = await _s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: promptVerItem.s3Ref })
    );
    promptBody = obj.Body
      ? await (obj.Body as unknown as { transformToString(): Promise<string> }).transformToString()
      : '';
  } else {
    promptBody = promptVerItem.body ?? '';
  }

  // ── 8. Assemble GroundedContext + priorOutputs (R-12) ────────────────────
  // buildFunctionalInputs is imported lazily so tests that don't exercise the
  // catalog-read path can run without the SST binding being resolved (NFR-8).
  const { buildFunctionalInputs } = await import('./functional-gen.js');
  const { ground } = await import('@registry/functest');

  const inputs = await buildFunctionalInputs(
    repository as Parameters<typeof buildFunctionalInputs>[0],
    step.model,
    String(promptVersion)
  );

  // Resolve the requirement for this run (per_requirement mode: single entry).
  // IDs are source-qualified `<source>/<id>` (R-57); a bare ID from a pre-v0.4.0
  // run is accepted only when it matches exactly one source's requirement.
  const requirementId = run.requirementIds[0] ?? '';
  const lookup = resolveRunRequirement(requirementId, inputs.requirements);
  const reqInput = lookup.ok ? lookup.requirement : undefined;

  if (!reqInput) {
    const errMsg = lookup.ok ? '' : lookup.error;
    await _writeStepTerminal(prunPkVal, stepSkVal, 'failed', {
      errorMessage: redact(errMsg),
      completedAt: new Date().toISOString(),
    });
    await _failRun(runId, step, errMsg);
    return;
  }

  const groundResult = ground(reqInput, inputs.contracts, inputs.apiMap, step.model, String(promptVersion));
  if (!groundResult.ok) {
    const errMsg = `Grounding failed: ${groundResult.reason}`;
    await _writeStepTerminal(prunPkVal, stepSkVal, 'failed', {
      errorMessage: redact(errMsg),
      completedAt: new Date().toISOString(),
    });
    await _failRun(runId, step, errMsg);
    return;
  }

  const groundedCtx = groundResult.context;

  // Build priorOutputs (R-12): if includeContext is false, stays [] (TS-08)
  let priorOutputs: PriorOutput[] = [];
  if (step.includeContext && stepIndex > 0) {
    const allPriorSteps = await listPrunSteps(_ddb, runId);
    const completedPriorSteps = allPriorSteps.filter(
      (s) => s.stepIndex < stepIndex && (s.status === 'completed' || s.status === 'cached')
    );
    for (const priorStep of completedPriorSteps) {
      if (priorStep.outputRef) {
        let outputStr: string;
        if ('inline' in priorStep.outputRef) {
          outputStr = priorStep.outputRef.inline;
        } else {
          const obj = await _s3.send(
            new GetObjectCommand({ Bucket: BUCKET, Key: priorStep.outputRef.s3Key })
          );
          outputStr = obj.Body
            ? await (obj.Body as unknown as { transformToString(): Promise<string> }).transformToString()
            : '';
        }
        priorOutputs.push({ stepId: priorStep.stepId, label: priorStep.label, output: outputStr });
      }
    }
  }

  // Fit prior outputs into the total budget, oldest truncated first (R-63).
  const prior = buildPriorContext(priorOutputs);
  priorOutputs = prior.outputs;
  const priorOutputsTruncated = prior.truncated;
  const outputType = resolveOutputType(step); // absent → 'plan' (R-59, TS-45)

  const contextWithPrior: GroundedContextWithPrior = { ...groundedCtx, priorOutputs };

  // ── 9. contextTokenEstimate heuristic (D-15, R-13) ────────────────────────
  const serializedContext = JSON.stringify(contextWithPrior);
  const contextTokenEstimate = Math.ceil(serializedContext.length / 4);
  const inputCharacters = serializedContext.length;

  // ── 6 (deferred). Compute full cache key (R-27, design §Caching) ─────────
  // Deferred until here because inputHash requires the grounded context.
  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify({
        inputHash: groundedCtx.inputHash,
        pipelineId: run.pipelineId,
        pipelineConfigVersion: run.pipelineConfigVersion,
        stepId: step.stepId,
        promptKey: step.promptKey,
        promptVersion,
      })
    )
    .digest('hex');

  await _ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: prunPkVal, SK: stepSkVal },
      UpdateExpression: 'SET cacheKey = :ck',
      ExpressionAttributeValues: { ':ck': cacheKey },
    })
  );

  // ── Cache lookup (R-28, TS-18) ────────────────────────────────────────────
  const cachedEntry = await getStepcache(_ddb, cacheKey);

  let outputRef: StepOutputRef;
  let stepFinalStatus: 'completed' | 'cached' | 'warning' = 'completed';
  let bedrockLatencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let outputCharacters = 0;
  let costEstimateUsd: number | undefined;
  let isWarningPath = false;

  if (cachedEntry) {
    // ── Cache hit: skip LLM (R-28, TS-18) ──────────────────────────────────
    log.info('step.worker.cache_hit', { runId, stepIndex, stepId: step.stepId });
    outputRef = cachedEntry.outputRef;
    stepFinalStatus = 'cached';
  } else {
    // ── 10. Internal retry loop (R-21a, TS-15b) ──────────────────────────
    let rawOutput: unknown;
    let terminalError: Error | undefined;
    let transientRetries = 0;

    while (transientRetries <= MAX_TRANSIENT_RETRIES) {
      const bedrockCallStart = Date.now();
      try {
        const result = await callBedrockForStep(
          step.model,
          process.env.AWS_REGION,
          promptBody,
          contextWithPrior,
          outputType
        );
        bedrockLatencyMs = Date.now() - bedrockCallStart;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
        // Validate before the output is written or cached (R-64). A failure
        // throws StepValidationError → terminal path below (never retried).
        validateStepOutput(outputType, result.output, groundedCtx);
        rawOutput = result.output;
        break; // success
      } catch (err) {
        const errName = (err as { name?: string }).name ?? '';
        const isTransient =
          errName === 'ThrottlingException' ||
          errName === 'ServiceUnavailableException' ||
          errName === 'TimeoutError' ||
          (err as NodeJS.ErrnoException).code === 'ECONNRESET' ||
          (err as NodeJS.ErrnoException).code === 'ETIMEDOUT';

        if (isTransient && transientRetries < MAX_TRANSIENT_RETRIES) {
          transientRetries++;
          log.warn('step.worker.transient_retry', {
            runId,
            stepIndex,
            attempt: transientRetries,
            error: redact((err as Error).message ?? ''),
          });
          // Extend lease before retry (R-21a, TS-15b)
          const extendedLease = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
          try {
            await _ddb.send(
              new UpdateCommand({
                TableName: TABLE,
                Key: { PK: prunPkVal, SK: stepSkVal },
                UpdateExpression: 'SET leaseExpiresAt = :le',
                ExpressionAttributeValues: { ':le': extendedLease },
              })
            );
          } catch {
            /* best-effort lease extension */
          }
          const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, transientRetries));
          await sleep(backoffMs);
          continue;
        }

        // Terminal error (non-retryable or retries exhausted — R-21b/c)
        terminalError = err as Error;
        break;
      }
    }

    if (terminalError) {
      // ── Terminal error handling (R-15, R-16, TS-11, TS-15, TS-33) ──────
      const errMsg = redact(terminalError.message ?? 'unknown error');
      const errStack = redact(terminalError.stack ?? '');

      if (step.optional) {
        // Optional step: 'warning' status, append to PRUN.warnings, continue (R-15, TS-11)
        await _writeStepTerminal(prunPkVal, stepSkVal, 'warning', {
          errorMessage: errMsg,
          errorStack: errStack,
          completedAt: new Date().toISOString(),
        });
        // Append to PRUN.warnings
        try {
          await _ddb.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { PK: prunPkVal, SK: 'PRUN' },
              UpdateExpression:
                'SET warnings = list_append(if_not_exists(warnings, :empty), :w)',
              ConditionExpression: '#status = :running',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':empty': [],
                ':w': [`Step ${stepIndex} (${step.stepId}): ${errMsg}`],
                ':running': 'running',
              },
            })
          );
        } catch {
          /* best-effort warnings append */
        }
        log.warn('step.worker.optional_step_warning', {
          runId,
          stepIndex,
          stepId: step.stepId,
          error: errMsg,
        });
        isWarningPath = true;
        stepFinalStatus = 'warning';
        outputRef = { inline: '' }; // placeholder — step record already written
      } else {
        // Non-optional step: fail run (R-16, TS-15)
        await _writeStepTerminal(prunPkVal, stepSkVal, 'failed', {
          errorMessage: errMsg,
          errorStack: errStack,
          completedAt: new Date().toISOString(),
        });
        await _failRun(runId, step, terminalError.message ?? 'unknown', terminalError.stack);
        return; // halt chain (TS-15)
      }
    } else {
      // ── 11. Write output (R-19) ────────────────────────────────────────
      const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
      outputCharacters = outputStr.length;

      const outputBytes = Buffer.byteLength(outputStr, 'utf-8');
      if (outputBytes > OUTPUT_S3_THRESHOLD) {
        const s3OutputKey = `pipeline-outputs/${runId}/${String(stepIndex).padStart(2, '0')}.json`;
        await _s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: s3OutputKey,
            Body: outputStr,
            ContentType: 'application/json',
          })
        );
        outputRef = { s3Key: s3OutputKey };
      } else {
        outputRef = { inline: outputStr };
      }

      // ── 12. Write cache entry with attribute_not_exists guard (R-28, D-17) ─
      await putStepcacheConditional(_ddb, cacheKey, outputRef);

      // ── 13. Compute costEstimateUsd (R-51, D-21) ──────────────────────
      const sysconfig = await getSysconfig(_ddb);
      const modelPricing = sysconfig?.pricing?.[step.model];
      if (modelPricing) {
        costEstimateUsd =
          (inputTokens * modelPricing.inputPricePerMillionTokens) / 1_000_000 +
          (outputTokens * modelPricing.outputPricePerMillionTokens) / 1_000_000;
      }
    }
  }

  // ── 14. Update step record with all metrics (R-51, TS-32) ─────────────────
  // Skip for the warning path — the step record was already written to terminal.
  if (!isWarningPath) {
    const durationMs = Date.now() - leaseWriteMs;
    const completedAt = new Date().toISOString();

    const setExprParts = [
      '#status = :status',
      'outputRef = :outputRef',
      'durationMs = :durationMs',
      'bedrockLatencyMs = :bedrockLatencyMs',
      'inputTokens = :inputTokens',
      'outputTokens = :outputTokens',
      'inputCharacters = :inputCharacters',
      'outputCharacters = :outputCharacters',
      'contextTokenEstimate = :contextTokenEstimate',
      'completedAt = :completedAt',
    ];
    const exprValues: Record<string, unknown> = {
      ':status': stepFinalStatus,
      ':outputRef': outputRef!,
      ':durationMs': durationMs,
      ':bedrockLatencyMs': bedrockLatencyMs,
      ':inputTokens': inputTokens,
      ':outputTokens': outputTokens,
      ':inputCharacters': inputCharacters,
      ':outputCharacters': outputCharacters,
      ':contextTokenEstimate': contextTokenEstimate,
      ':completedAt': completedAt,
    };
    if (costEstimateUsd !== undefined) {
      setExprParts.push('costEstimateUsd = :costEstimateUsd');
      exprValues[':costEstimateUsd'] = costEstimateUsd;
    }
    if (priorOutputsTruncated) {
      setExprParts.push('priorOutputsTruncated = :pot');
      exprValues[':pot'] = true;
    }

    await _ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: prunPkVal, SK: stepSkVal },
        UpdateExpression: `SET ${setExprParts.join(', ')} REMOVE leaseExpiresAt`,
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: exprValues,
      })
    );
  }

  // ── Post-step guards and next-step dispatch ───────────────────────────────

  // ── 15. Age check (R-23, TS-16) ──────────────────────────────────────────
  const nowAfterStep = Date.now();
  if (nowAfterStep - new Date(run.startedAt).getTime() > pipeline.maxAgeMinutes * 60_000) {
    log.warn('step.worker.run_age_exceeded', {
      runId,
      stepIndex,
      maxAgeMinutes: pipeline.maxAgeMinutes,
    });
    try {
      await updatePrun(_ddb, runId, {
        status: 'timed_out',
        completedAt: new Date(nowAfterStep).toISOString(),
      });
    } catch {
      /* may already be terminal */
    }
    return;
  }

  // ── 16. maxSteps check (R-22) ─────────────────────────────────────────────
  if (run.executedSteps + 1 > pipeline.maxSteps) {
    log.warn('step.worker.max_steps_exceeded', {
      runId,
      stepIndex,
      executedSteps: run.executedSteps + 1,
      maxSteps: pipeline.maxSteps,
    });
    try {
      await updatePrun(_ddb, runId, {
        status: 'timed_out',
        completedAt: new Date().toISOString(),
      });
    } catch {
      /* may already be terminal */
    }
    return;
  }

  // ── 17. Final step → mark run completed (R-20, TS-14) ────────────────────
  if (stepIndex + 1 >= pipeline.steps.length) {
    // Check if any optional steps produced warnings (edge case §5)
    const allStepsDone = await listPrunSteps(_ddb, runId);
    const hasWarnings =
      allStepsDone.some((s) => s.status === 'warning') ||
      (run.warnings && run.warnings.length > 0);
    const finalStatus = hasWarnings ? 'completed_with_warnings' : 'completed';

    try {
      await updatePrun(_ddb, runId, {
        status: finalStatus,
        completedAt: new Date().toISOString(),
      });
    } catch {
      /* may already be terminal */
    }
    log.info('step.worker.run_completed', { runId, stepIndex, status: finalStatus });
    return;
  }

  // ── 18. Increment executedSteps ───────────────────────────────────────────
  try {
    await updatePrun(_ddb, runId, { executedSteps: run.executedSteps + 1 });
  } catch {
    /* ConditionalCheckFailedException — run may have been transitioned */
  }

  // ── 19. Dispatch next step (R-17, async fire-and-forget) ─────────────────
  await dispatchNextStep(runId, stepIndex + 1);
  log.info('step.worker.dispatched_next', {
    runId,
    currentStep: stepIndex,
    nextStep: stepIndex + 1,
  });
}
