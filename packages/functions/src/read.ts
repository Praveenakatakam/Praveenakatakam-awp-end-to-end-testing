/**
 * Read API handlers (T-13 · R-50…R-55). All are reader-authorised by the Lambda
 * authorizer (T-09) before they run. Responses are served from the pre-crawled
 * catalog (trigger-then-cache — D-7), never a live crawl.
 *
 * T-05 additions: GET handlers for pipeline/prompt list + detail routes, and
 * `GET /runs/{runId}` with lazy lease-expiry detection (R-25, R-26-loop, R-35–R-37).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Bucket } from 'sst/node/bucket';
import { parseAndValidate, diffContracts } from '@registry/core';
import type { RunStepDetail, StepInputSnapshot } from '@registry/core';
import {
  repository,
  getPipeline,
  listPipelines,
  getPrmpt,
  listPrmpts,
  listPrmptVers,
  getPrun,
  listPrunSteps,
  listPruns,
  updatePrun,
} from './repository.js';
import { json, notFound } from './http.js';
import { handleListPromptVersions, handleGetPromptVersion } from './prompt-versions.js';

/** Module-scoped DDB client for the standalone pipeline/prompt CRUD helpers (T-05). */
const _ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
/** Module-scoped S3 client for run artifacts (v0.4.0 · R-65). */
const _s3 = new S3Client({});

/** GET /contracts?source=&entity=&validation= (R-50). */
export async function contracts(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const q = event.queryStringParameters ?? {};
  const items = await repository.listEntries({
    source: q.source,
    entity: q.entity,
    validation: q.validation,
  });
  return json(200, { items });
}

/** GET /contracts/{source}/{id} (R-51, R-54). */
export async function contract(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { source, id } = event.pathParameters ?? {};
  if (!source || !id) return notFound();
  const found = await repository.getEntry(source, id);
  if (!found) return notFound(`no contract ${source}/${id}`);
  return json(200, found);
}

/** GET /contracts/{source}/{id}/raw?version= (R-52, R-54). */
export async function raw(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { source, id } = event.pathParameters ?? {};
  if (!source || !id) return notFound();
  const versionParam = event.queryStringParameters?.version;
  const version = versionParam ? Number(versionParam) : undefined;
  const body = await repository.getRaw(source, id, version);
  if (body === undefined) return notFound(`no contract ${source}/${id}`);
  return { statusCode: 200, headers: { 'content-type': 'application/yaml' }, body };
}

/** GET /entities/{entity} — variants + divergence + semantic diff (R-53, D-18). */
export async function entity(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const name = event.pathParameters?.entity;
  if (!name) return notFound();
  const result = await repository.getEntityVariants(name);
  if (result.variants.length === 0) return notFound(`no entity ${name}`);

  // Order variants publisher-first so the diff's A/B (onlyInA = publisher-only,
  // onlyInB = consumer-only) is deterministic and matches the producer→consumer
  // framing (D-24) and the SPA labels — the `byEntity` GSI returns them
  // source-ascending (consumer before publisher), which would otherwise flip it.
  const variants = [...result.variants].sort((x, y) =>
    x.source === y.source ? 0 : x.source === 'publisher' ? -1 : y.source === 'publisher' ? 1 : x.source.localeCompare(y.source)
  );

  let divergent = result.divergent;
  let diff: unknown;
  if (variants.length === 2) {
    const [a, b] = variants;
    const rawA = await repository.getRaw(a.source, a.id);
    const rawB = await repository.getRaw(b.source, b.id);
    if (rawA && rawB) {
      const d = diffContracts(parseAndValidate(rawA).parsed, parseAndValidate(rawB).parsed);
      diff = d;
      // Publisher-only fields (onlyInA) are expected projections — the consumer
      // intentionally omits envelope/implementation fields. Only flag divergent
      // when the consumer references a field the publisher doesn't produce
      // (onlyInB) or when a shared field has conflicting type/required (changed).
      divergent = d.onlyInB.length > 0 || d.changed.length > 0;
    }
  }
  return json(200, { entity: result.entity, variants, divergent, diff });
}

/** GET /crawls (R-55). */
export async function crawls(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return json(200, { runs: await repository.listRuns() });
}

/** GET /crawls/{runId} (R-55, R-54). */
export async function crawl(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  if (!runId) return notFound();
  const run = await repository.getRun(runId);
  if (!run) return notFound(`no crawl ${runId}`);
  return json(200, run);
}

/** GET /test-artifacts — list generation runs newest-first (T-22 · R-90). */
export async function testArtifacts(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return json(200, { runs: await repository.listGenRuns() });
}

/** GET /test-artifacts/latest — newest run record + inline artifact set (R-90, D-32). */
export async function testArtifactsLatest(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const run = await repository.getLatestGenRun();
  if (!run) return notFound('no generation runs');
  const artifacts = await repository.getArtifacts(run.runId);
  return json(200, { run, artifacts });
}

/** GET /test-artifacts/{runId} — one run record + inline artifact set (R-90, R-54). */
export async function testArtifact(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  if (!runId) return notFound();
  const run = await repository.getGenRun(runId);
  if (!run) return notFound(`no generation run ${runId}`);
  const artifacts = await repository.getArtifacts(runId);
  return json(200, { run, artifacts });
}

// ---- Functional-test-generation jobs (T-37 · §3.11, R-125) ---------------

/** GET /functional-test-jobs — list functional-gen jobs newest-first (R-125). */
export async function functionalJobs(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return json(200, { jobs: await repository.listFunctionalJobs() });
}

/** GET /functional-test-jobs/latest — newest job + inline artifact set (R-125, R-126). */
export async function functionalJobLatest(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const job = await repository.getLatestFunctionalJob();
  if (!job) return notFound('no functional-test-generation jobs');
  const artifacts = await repository.getFunctionalArtifacts(job.jobId);
  return json(200, { job, artifacts });
}

/** GET /functional-test-jobs/{jobId} — one job record + inline artifact set (R-125, R-126). */
export async function functionalJob(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) return notFound();
  const job = await repository.getFunctionalJob(jobId);
  if (!job) return notFound(`no functional-test-generation job ${jobId}`);
  const artifacts = await repository.getFunctionalArtifacts(jobId);
  return json(200, { job, artifacts });
}

// ---- Requirements catalog reads (T-30 · §3.10, R-109…R-112) --------------

/** GET /requirements?source=&earsType=&conforming= (R-109). */
export async function requirements(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const q = event.queryStringParameters ?? {};
  // `conforming` is an optional tri-state: "true"/"false" filter, else unset.
  const conforming = q.conforming === undefined ? undefined : q.conforming === 'true';
  const items = await repository.listRequirements({ source: q.source, earsType: q.earsType, conforming });
  return json(200, { items });
}

/** GET /requirements/{source} — a source's requirement set + spec metadata (R-110, R-112). */
export async function requirementsForSource(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const source = event.pathParameters?.source;
  if (!source) return notFound();
  const found = await repository.getRequirementsForSource(source);
  if (!found) return notFound(`no requirements for ${source}`);
  return json(200, found);
}

/** GET /requirements/{source}/{id} — one requirement (R-111, R-112). */
export async function requirement(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { source, id } = event.pathParameters ?? {};
  if (!source || !id) return notFound();
  const found = await repository.getRequirement(source, id);
  if (!found) return notFound(`no requirement ${source}/${id}`);
  return json(200, found);
}

// ---- Prompt versions (T-08 · prompt-versioning-experiments) ----------------

/** GET /prompt-versions — list all prompt versions, omitting the `text` field. */
export const promptVersions = handleListPromptVersions;

/** GET /prompt-versions/{promptVersion} — fetch one prompt version with full text. */
export const promptVersion = handleGetPromptVersion;

// ---- Experiments (T-10 · prompt-versioning-experiments) --------------------

/** GET /experiments — list all experiments newest-first. */
export async function experiments(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const items = await repository.listExperiments();
  return json(200, { experiments: items });
}

/** GET /experiments/{experimentId} — one experiment record. */
export async function experiment(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { experimentId } = event.pathParameters ?? {};
  if (!experimentId) return notFound();
  const record = await repository.getExperiment(experimentId);
  if (!record) return notFound();
  return json(200, record);
}

/** GET /experiments/{experimentId}/artifact — artifact payload, only when succeeded. */
export async function experimentArtifact(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { experimentId } = event.pathParameters ?? {};
  if (!experimentId) return notFound();
  const record = await repository.getExperiment(experimentId);
  if (!record) return notFound();
  if (record.status !== 'succeeded') return notFound();
  const artifact = await repository.getExperimentArtifact(experimentId);
  if (!artifact) return notFound();
  return json(200, {
    experimentId: record.experimentId,
    promptVersion: record.promptVersion,
    status: record.status,
    planCount: record.planCount,
    skipCount: record.skipCount,
    artifact,
  });
}

// ---- Pipeline GET handlers (T-05 · R-35, R-36, R-37) -----------------------

/** GET /pipelines — list active pipelines, paginated (R-37). */
export async function getPipelinesHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const nextToken = event.queryStringParameters?.nextToken;
  const result = await listPipelines(_ddb, nextToken);
  return json(200, result);
}

/** GET /pipelines/{id} — one pipeline config (R-35). */
export async function getPipelineHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const id = event.pathParameters?.id;
  if (!id) return notFound();
  const pipeline = await getPipeline(_ddb, id);
  if (!pipeline) return notFound(`no pipeline ${id}`);
  return json(200, pipeline);
}

// ---- Prompt GET handlers (T-05 · R-35, R-36, R-37) -------------------------

/** GET /prompts — list active prompts, paginated (R-37). */
export async function getPromptsHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const nextToken = event.queryStringParameters?.nextToken;
  const result = await listPrmpts(_ddb, nextToken);
  return json(200, result);
}

/** GET /prompts/{key} — one prompt header (R-35). */
export async function getPromptHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const key = event.pathParameters?.key;
  if (!key) return notFound();
  const prompt = await getPrmpt(_ddb, key);
  if (!prompt) return notFound(`no prompt ${key}`);
  return json(200, prompt);
}

/** GET /prompts/{key}/versions — version history for one prompt (R-36, R-42). */
export async function getPromptVersionsHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const key = event.pathParameters?.key;
  if (!key) return notFound();
  const versions = await listPrmptVers(_ddb, key);
  return json(200, { versions });
}

// ---- Pipeline run GET handler with lazy lease-expiry (T-05 · R-25, R-26-loop) ---

/** Terminal run statuses — no expiry check needed for these. */
const TERMINAL_RUN_STATUSES = new Set(['completed', 'completed_with_warnings', 'failed', 'timed_out']);

/**
 * GET /runs/{runId} — fetch a pipeline run plus its step records.
 *
 * Lazy lease-expiry detection (R-25, R-26-loop, design §Lazy expiry detection):
 * when the run is still `running`, all STEP#* records are queried. If any step
 * has a `leaseExpiresAt` in the past, a conditional UpdateItem transitions the
 * run to `timed_out` (condition: `status = 'running'`, so it is idempotent and
 * a second fetch of an already-timed-out run does not re-transition — TS-17b).
 * At most one conditional UpdateItem is issued per response path.
 */
export async function getPipelineRunHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  if (!runId) return notFound();

  let run = await getPrun(_ddb, runId);
  if (!run) return notFound(`no pipeline run ${runId}`);

  // Lazy lease-expiry check — only when run is non-terminal (R-26-loop).
  if (!TERMINAL_RUN_STATUSES.has(run.status)) {
    const steps = await listPrunSteps(_ddb, runId);
    const now = new Date().toISOString();
    const hasExpiredLease = steps.some((s) => s.leaseExpiresAt !== undefined && s.leaseExpiresAt < now);

    if (hasExpiredLease) {
      try {
        // Conditional update: only transitions when status is still 'running'.
        // ConditionalCheckFailedException means another path already transitioned
        // the run — silently ignored (idempotent, TS-17b).
        await updatePrun(_ddb, runId, {
          status: 'timed_out',
          completedAt: now,
        });
      } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
        // Already transitioned by another path — safe to ignore.
      }
      // Re-fetch to return the authoritative post-transition state.
      run = (await getPrun(_ddb, runId)) ?? run;
    }

    // Return the run (possibly updated) with the steps already queried above.
    return json(200, { run, steps });
  }

  // Terminal run: return run + steps without any expiry check.
  const steps = await listPrunSteps(_ddb, runId);
  return json(200, { run, steps });
}

/** GET /runs — list pipeline runs newest-first, paginated. */
export async function getPipelineRunsHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const nextToken = event.queryStringParameters?.nextToken;
  const result = await listPruns(_ddb, nextToken);
  return json(200, result);
}

/**
 * GET /runs/{runId}/artifact — the run's emitted test file (R-65, D-26).
 * Returns `{ path, content }`; 404 when the run is unknown, has no `artifact`,
 * or the S3 object is missing.
 */
export async function runArtifact(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  if (!runId) return notFound();
  const run = await getPrun(_ddb, runId);
  if (!run) return notFound(`no pipeline run ${runId}`);
  if (!run.artifact) return notFound(`pipeline run ${runId} has no artifact`);
  try {
    const obj = await _s3.send(new GetObjectCommand({ Bucket: Bucket.Contracts.bucketName, Key: run.artifact.s3Key }));
    const content = obj.Body ? await (obj.Body as { transformToString(): Promise<string> }).transformToString() : '';
    return json(200, { path: run.artifact.path, content });
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return notFound(`artifact for run ${runId} not found`);
    throw err;
  }
}

/** Read an S3 object as a string; `null` when the key does not exist. */
async function readS3StringOrNull(key: string): Promise<string | null> {
  try {
    const obj = await _s3.send(new GetObjectCommand({ Bucket: Bucket.Contracts.bucketName, Key: key }));
    return obj.Body ? await (obj.Body as { transformToString(): Promise<string> }).transformToString() : '';
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * GET /runs/{runId}/steps/{stepIndex} — one step's record, input snapshot and
 * output (R-75, D-29). `input` is the parsed `StepInputSnapshot` or `null` when
 * the step has no `inputRef` (pre-v0.5.0) or the object is missing; `output` is
 * resolved from inline or S3, or `null`. 404 for an unknown run or step, or a
 * non-numeric `stepIndex`.
 */
export async function runStep(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  const rawIndex = event.pathParameters?.stepIndex;
  if (!runId || !rawIndex || !/^\d+$/.test(rawIndex)) return notFound();
  const stepIndex = Number(rawIndex);

  const run = await getPrun(_ddb, runId);
  if (!run) return notFound(`no pipeline run ${runId}`);
  const step = (await listPrunSteps(_ddb, runId)).find((s) => s.stepIndex === stepIndex);
  if (!step) return notFound(`no step ${stepIndex} in pipeline run ${runId}`);

  const outputRef = step.outputRef;
  const [inputRaw, output] = await Promise.all([
    step.inputRef ? readS3StringOrNull(step.inputRef.s3Key) : Promise.resolve(null),
    !outputRef
      ? Promise.resolve(null)
      : 'inline' in outputRef
        ? Promise.resolve(outputRef.inline)
        : readS3StringOrNull(outputRef.s3Key),
  ]);
  const input = inputRaw === null ? null : (JSON.parse(inputRaw) as StepInputSnapshot);

  const detail: RunStepDetail = { step, input, output };
  return json(200, detail);
}
