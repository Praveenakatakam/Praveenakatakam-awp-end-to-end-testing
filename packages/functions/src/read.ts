/**
 * Read API handlers (T-13 · R-50…R-55). All are reader-authorised by the Lambda
 * authorizer (T-09) before they run. Responses are served from the pre-crawled
 * catalog (trigger-then-cache — D-7), never a live crawl.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { parseAndValidate, diffContracts } from '@registry/core';
import { repository } from './repository.js';
import { json, notFound } from './http.js';
import { handleListPromptVersions, handleGetPromptVersion } from './prompt-versions.js';

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

/**
 * The adversarial summary of a run/job, for the response top level (§3.12,
 * R-143): `{verdict, counts}` from the record plus the full `report` from the
 * artifact object. Undefined for a run/job that predates the review stage.
 */
function adversarialOf(record: { adversarial?: unknown } | undefined, artifacts: { report?: unknown } | undefined) {
  if (!record?.adversarial) return undefined;
  return { ...(record.adversarial as object), report: artifacts?.report };
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
  return json(200, { run, artifacts, adversarial: adversarialOf(run, artifacts) });
}

/** GET /test-artifacts/{runId} — one run record + inline artifact set (R-90, R-54). */
export async function testArtifact(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const runId = event.pathParameters?.runId;
  if (!runId) return notFound();
  const run = await repository.getGenRun(runId);
  if (!run) return notFound(`no generation run ${runId}`);
  const artifacts = await repository.getArtifacts(runId);
  return json(200, { run, artifacts, adversarial: adversarialOf(run, artifacts) });
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
  return json(200, { job, artifacts, adversarial: adversarialOf(job, artifacts) });
}

/** GET /functional-test-jobs/{jobId} — one job record + inline artifact set (R-125, R-126). */
export async function functionalJob(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) return notFound();
  const job = await repository.getFunctionalJob(jobId);
  if (!job) return notFound(`no functional-test-generation job ${jobId}`);
  const artifacts = await repository.getFunctionalArtifacts(jobId);
  return json(200, { job, artifacts, adversarial: adversarialOf(job, artifacts) });
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
