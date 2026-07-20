/**
 * Catalog repository — DynamoDB single-table + S3 blob store (T-11).
 *
 * Implements the version model (R-30…R-34, D-10, D-16), the single-flight lock
 * (R-15, D-15), and raw-document storage/retrieval (R-41). Item key shapes are
 * per design §2.1. Table/bucket names come from the SST resource bindings via
 * `sst/node` (the offline suite stubs these — see vitest.setup.ts).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Table } from "sst/node/table";
import { Bucket } from "sst/node/bucket";
import type { ValidationError, ParsedRequirement } from "@registry/core";

const TABLE = Table.Registry.tableName;
const BUCKET = Bucket.Contracts.bucketName;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

// ---- Key builders (design §2.1) ----
const entryPk = (source: string) => `SRC#${source}`;
const entrySk = (id: string) => `CON#${id}`;
const versionPk = (source: string, id: string) => `VER#${source}#${id}`;
const versionSk = (n: number) => `V#${String(n).padStart(4, "0")}`;
const runPk = (runId: string) => `RUN#${runId}`;
const genPk = (runId: string) => `GEN#${runId}`;
const reqPk = (source: string) => `REQ#${source}`;
const reqSk = (id: string) => `R#${id}`;
const reqSpecKey = (source: string) => `requirements/${source}/spec.md`;
const s3Key = (source: string, id: string, version: number, hash: string) =>
  `contracts/${source}/${id}/${version}-${hash.slice(0, 12)}.odcs.yaml`;
const artifactKey = (runId: string) => `test-artifacts/${runId}/artifacts.json`;
const fjobPk = (jobId: string) => `FJOB#${jobId}`;
const fjobArtifactKey = (jobId: string) => `functional-tests/${jobId}/artifacts.json`;
const planCacheKey = (inputHash: string) => `functional-tests/plan-cache/${inputHash}.json`;

export class LockHeldError extends Error {
  override readonly name = "LockHeldError";
  /** The in-flight crawl's run id, surfaced in the `409` body (R-15, E-11). */
  constructor(message: string, public readonly runId?: string) {
    super(message);
  }
}

export type IngestOutcome = "new" | "unchanged" | "new-version";

interface CurrentVersion {
  hash: string;
  declaredVersion?: string;
  version: number;
}

/**
 * Pure version-transition decision (R-31/R-32/R-33/R-33a, D-16). Content hash is
 * the change signal; the declared `version` field only drives the no-bump flag.
 */
export function decideIngest(
  current: CurrentVersion | undefined,
  incoming: { hash: string; declaredVersion?: string },
): { outcome: IngestOutcome; nextVersion: number; versionNotBumped: boolean } {
  if (!current) return { outcome: "new", nextVersion: 1, versionNotBumped: false };
  if (current.hash === incoming.hash)
    return { outcome: "unchanged", nextVersion: current.version, versionNotBumped: false };
  return {
    outcome: "new-version",
    nextVersion: current.version + 1,
    versionNotBumped: current.declaredVersion === incoming.declaredVersion,
  };
}

export interface IngestInput {
  source: string;
  id: string;
  entity: string;
  name?: string;
  path: string;
  blobSha: string;
  commitSha: string;
  bytes: string;
  declaredVersion?: string;
  validation: "valid" | "invalid";
  validationErrors: ValidationError[];
}

export interface CatalogEntry {
  source: string;
  id: string;
  entity: string;
  name?: string;
  currentVersion: number;
  currentHash: string;
  declaredVersion?: string;
  validation: string;
  validationErrors?: ValidationError[];
  commitSha: string;
  filePath: string;
  lastCrawledAt: string;
}

/** A cataloged EARS requirement (design §2.1 · R-106). Latest-snapshot only (D-45). */
export interface RequirementRecord {
  source: string;
  id: string;
  text: string;
  section: string;
  earsType: string;
  modality: string | null;
  earsConforming: boolean;
  changedInLastCrawl: boolean;
  specHash: string;
  specVersion?: string;
  lastCrawledAt: string;
}

/** Per-source requirement crawl counts, folded into the run summary (R-108). */
export interface RequirementCounts {
  discovered: number;
  conforming: number;
  nonConforming: number;
  changed: number;
  removed: number;
  /** Requirement ids that appeared more than once in the source's `docs/spec.md` (first kept — D-49, E-38). */
  collisions?: string[];
  /** Set by the crawl when requirements extraction/storage failed in isolation (R-105a). */
  failed?: boolean;
  reason?: string;
}

/** A functional-test-generation job record (§3.11, R-124). */
export interface FunctionalJobRecord {
  jobId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt?: string;
  modelId: string;
  promptVersion: string;
  /** Populated on success (R-124). */
  planCount?: number;
  skipCount?: number;
  artifactKey?: string;
  /**
   * The catalog snapshot the job ran against (R-124, mirrors R-89's run-record
   * provenance): per-contract content hash + the requirement set, so a reader
   * can tell whether a stored job is stale relative to the current catalog.
   */
  catalogContext?: {
    contractCount: number;
    requirementCount: number;
    contracts: { source: string; id: string; entity: string; contentHash: string }[];
    requirements: { source: string; id: string }[];
  };
  /** Per-requirement skips with their reasons (R-124: "skipped WITH reasons"). */
  skips?: { requirement: string; reason: string }[];
  /** Populated on failure — a redacted, human-readable reason (R-124, NFR-2). */
  error?: string;
}

class Repository {
  /** Acquire the single-flight crawl lock or throw LockHeldError (R-15, D-15). */
  async acquireLock(runId: string, ttlSeconds: number): Promise<void> {
    const now = Math.floor(nowMs() / 1000);
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: { PK: "LOCK", SK: "CRAWL", runId, acquiredAt: new Date(nowMs()).toISOString(), ttl: now + ttlSeconds },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
        // Surface the in-flight run's id so the caller's 409 can name it (R-15/E-11).
        const held = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: "LOCK", SK: "CRAWL" } }));
        throw new LockHeldError("a crawl is already in progress", held.Item?.runId as string | undefined);
      }
      throw err;
    }
  }

  async releaseLock(): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: "LOCK", SK: "CRAWL" } }));
  }

  /** Ingest one crawled contract, applying the version model. */
  async ingestContract(input: IngestInput): Promise<{ outcome: IngestOutcome; version: number; versionNotBumped: boolean }> {
    const existing = await ddb.send(
      new GetCommand({ TableName: TABLE, Key: { PK: entryPk(input.source), SK: entrySk(input.id) } }),
    );
    const current = existing.Item
      ? { hash: existing.Item.currentHash as string, declaredVersion: existing.Item.declaredVersion as string | undefined, version: existing.Item.currentVersion as number }
      : undefined;

    const decision = decideIngest(current, { hash: input.blobSha, declaredVersion: input.declaredVersion });
    const at = new Date(nowMs()).toISOString();

    if (decision.outcome === "unchanged") {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: entryPk(input.source), SK: entrySk(input.id) },
          UpdateExpression: "SET lastCrawledAt = :at, commitSha = :c",
          ExpressionAttributeValues: { ":at": at, ":c": input.commitSha },
        }),
      );
      return { outcome: "unchanged", version: decision.nextVersion, versionNotBumped: false };
    }

    // new / new-version: store the exact bytes, append an immutable version row,
    // then upsert the entry to point at the new current version.
    const key = s3Key(input.source, input.id, decision.nextVersion, input.blobSha);
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: input.bytes, ContentType: "application/yaml" }));

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: versionPk(input.source, input.id),
          SK: versionSk(decision.nextVersion),
          versionNumber: decision.nextVersion,
          hash: input.blobSha,
          declaredVersion: input.declaredVersion,
          versionNotBumped: decision.versionNotBumped,
          commitSha: input.commitSha,
          crawledAt: at,
          validation: input.validation,
          s3Key: key,
        },
      }),
    );

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: entryPk(input.source),
          SK: entrySk(input.id),
          source: input.source,
          id: input.id,
          entity: input.entity,
          name: input.name,
          currentVersion: decision.nextVersion,
          currentHash: input.blobSha,
          declaredVersion: input.declaredVersion,
          validation: input.validation,
          validationErrors: input.validationErrors,
          commitSha: input.commitSha,
          filePath: input.path,
          lastCrawledAt: at,
        },
      }),
    );

    return { outcome: decision.outcome, version: decision.nextVersion, versionNotBumped: decision.versionNotBumped };
  }

  /** List catalog entries (R-50), optionally filtered. */
  async listEntries(filters: { source?: string; entity?: string; validation?: string } = {}): Promise<CatalogEntry[]> {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "begins_with(SK, :con)",
        ExpressionAttributeValues: { ":con": "CON#" },
      }),
    );
    let items = (res.Items ?? []) as CatalogEntry[];
    if (filters.source) items = items.filter((i) => i.source === filters.source);
    if (filters.entity) items = items.filter((i) => i.entity === filters.entity);
    if (filters.validation) items = items.filter((i) => i.validation === filters.validation);
    return items;
  }

  /** Get one entry + its full version history (R-51). */
  async getEntry(source: string, id: string): Promise<{ entry: CatalogEntry; versions: any[] } | undefined> {
    const got = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: entryPk(source), SK: entrySk(id) } }));
    if (!got.Item) return undefined;
    const versions = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": versionPk(source, id) },
      }),
    );
    return { entry: got.Item as CatalogEntry, versions: (versions.Items ?? []) as any[] };
  }

  /** All source variants of an entity + a divergence flag (R-34, R-53). */
  async getEntityVariants(entity: string): Promise<{ entity: string; variants: any[]; divergent: boolean }> {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "byEntity",
        KeyConditionExpression: "entity = :e",
        ExpressionAttributeValues: { ":e": entity },
      }),
    );
    const variants = (res.Items ?? []) as any[];
    const hashes = new Set(variants.map((v) => v.currentHash));
    return { entity, variants, divergent: variants.length > 1 && hashes.size > 1 };
  }

  /** Raw ODCS bytes for a version (default: current) from S3 (R-52, R-41). */
  async getRaw(source: string, id: string, version?: number): Promise<string | undefined> {
    const entry = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: entryPk(source), SK: entrySk(id) } }));
    if (!entry.Item) return undefined;
    const v = version ?? (entry.Item.currentVersion as number);
    const ver = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: versionPk(source, id), SK: versionSk(v) } }));
    if (!ver.Item) return undefined;
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: ver.Item.s3Key as string }));
    return obj.Body ? await (obj.Body as any).transformToString() : undefined;
  }

  async writeRun(run: { runId: string; startedAt: string }): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: runPk(run.runId), SK: "RUN", kind: "CRAWL", ...(run as Record<string, unknown>) },
      }),
    );
  }

  async listRuns(): Promise<any[]> {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "byKind",
        KeyConditionExpression: "kind = :k",
        ExpressionAttributeValues: { ":k": "CRAWL" },
        ScanIndexForward: false,
      }),
    );
    return (res.Items ?? []) as any[];
  }

  async getRun(runId: string): Promise<any | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: runPk(runId), SK: "RUN" } }));
    return res.Item;
  }

  // ---- Test-generation runs (T-20 · R-89, R-90) --------------------------
  // GENRUN items reuse the byKind GSI with kind="GENERATION", disjoint from the
  // crawl runs' kind="CRAWL", so listGenRuns and listRuns never intersect.

  /** Persist a generation-run record (R-89). */
  async writeGenRun(run: { runId: string; startedAt: string }): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: genPk(run.runId), SK: "GEN", kind: "GENERATION", ...(run as Record<string, unknown>) },
      }),
    );
  }

  /** List generation runs newest-first (R-90). */
  async listGenRuns(): Promise<any[]> {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "byKind",
        KeyConditionExpression: "kind = :k",
        ExpressionAttributeValues: { ":k": "GENERATION" },
        ScanIndexForward: false,
      }),
    );
    return (res.Items ?? []) as any[];
  }

  async getGenRun(runId: string): Promise<any | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: genPk(runId), SK: "GEN" } }));
    return res.Item;
  }

  /** The most recent generation run, or undefined when none exist (R-90 `/latest`). */
  async getLatestGenRun(): Promise<any | undefined> {
    return (await this.listGenRuns())[0];
  }

  /** Store a run's artifact set (manifest + files) as one S3 JSON object (R-89, D-32). */
  async putArtifacts(runId: string, artifacts: unknown): Promise<string> {
    const key = artifactKey(runId);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(artifacts),
        ContentType: "application/json",
      }),
    );
    return key;
  }

  /** Fetch a run's artifact set, or undefined when absent (R-90). */
  async getArtifacts(runId: string): Promise<any | undefined> {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: artifactKey(runId) }));
      const body = obj.Body ? await (obj.Body as any).transformToString() : undefined;
      return body ? JSON.parse(body) : undefined;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  // ---- Functional-test-generation jobs (T-35 · §3.11, R-124, R-119) ------
  // FJOB items reuse the byKind GSI with kind="FUNCTIONAL_GEN", disjoint from
  // CRAWL and GENERATION, so the three job listings never intersect. Plans are
  // cached in S3 by input hash so an unchanged input reuses a plan (R-119, D-52).

  /** Create or overwrite a functional-gen job record (R-124). */
  async writeFunctionalJob(job: FunctionalJobRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: fjobPk(job.jobId), SK: "FJOB", kind: "FUNCTIONAL_GEN", ...(job as unknown as Record<string, unknown>) },
      }),
    );
  }

  /** List functional-gen jobs newest-first (R-125). */
  async listFunctionalJobs(): Promise<FunctionalJobRecord[]> {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "byKind",
        KeyConditionExpression: "kind = :k",
        ExpressionAttributeValues: { ":k": "FUNCTIONAL_GEN" },
        ScanIndexForward: false,
      }),
    );
    return (res.Items ?? []) as FunctionalJobRecord[];
  }

  async getFunctionalJob(jobId: string): Promise<FunctionalJobRecord | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: fjobPk(jobId), SK: "FJOB" } }));
    return res.Item as FunctionalJobRecord | undefined;
  }

  /** The most recent functional-gen job, or undefined (R-125 `/latest`). */
  async getLatestFunctionalJob(): Promise<FunctionalJobRecord | undefined> {
    return (await this.listFunctionalJobs())[0];
  }

  /** Store a job's artifact set (manifest + emitted files) as one S3 JSON object (R-124). */
  async putFunctionalArtifacts(jobId: string, artifacts: unknown): Promise<string> {
    const key = fjobArtifactKey(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(artifacts),
        ContentType: "application/json",
      }),
    );
    return key;
  }

  /** Fetch a job's artifact set, or undefined when absent (R-125, R-126). */
  async getFunctionalArtifacts(jobId: string): Promise<any | undefined> {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: fjobArtifactKey(jobId) }));
      const body = obj.Body ? await (obj.Body as any).transformToString() : undefined;
      return body ? JSON.parse(body) : undefined;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  /** Read a cached plan by input hash, or undefined on a miss (R-119, D-52). */
  async getCachedPlan(inputHash: string): Promise<any | undefined> {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: planCacheKey(inputHash) }));
      const body = obj.Body ? await (obj.Body as any).transformToString() : undefined;
      return body ? JSON.parse(body) : undefined;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  /** Persist a synthesized plan under its input hash — the "lockfile" store (R-119, D-52). */
  async putCachedPlan(inputHash: string, plan: unknown): Promise<void> {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: planCacheKey(inputHash),
        Body: JSON.stringify(plan),
        ContentType: "application/json",
      }),
    );
  }

  // ---- Requirements catalog (T-28 · §3.10, R-106…R-108, R-114) ------------
  // Latest-snapshot per source (no history — D-45): each crawl replaces the
  // source's requirement set wholesale, flagging text that changed since last
  // crawl, and stores the raw docs/spec.md in S3 for provenance.

  /**
   * Replace a source's requirement snapshot; flag each requirement whose text
   * differs from (or is absent in) the prior snapshot, delete requirements no
   * longer present, and store the raw spec bytes in S3. Returns the counts the
   * crawl-run summary carries (R-108).
   */
  async putRequirements(
    source: string,
    parsed: ParsedRequirement[],
    opts: { specHash: string; specVersion?: string; rawSpec: string },
  ): Promise<RequirementCounts> {
    // Prior snapshot: id → text, to compute changedInLastCrawl (R-107).
    const prior = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": reqPk(source) },
      }),
    );
    const priorText = new Map<string, string>();
    for (const it of (prior.Items ?? []) as any[]) priorText.set(it.id as string, it.text as string);

    // Enforce the {source, id} catalog key (R-106): if a source's docs/spec.md
    // declares the same R-nn twice, keep the first and record the collision
    // (mirrors the contract in-source id-collision rule, R-30a — D-49, E-38) so
    // the snapshot batch never carries duplicate keys (which BatchWrite rejects).
    const seenIds = new Set<string>();
    const collisions: string[] = [];
    const deduped = parsed.filter((r) => {
      if (seenIds.has(r.id)) {
        if (!collisions.includes(r.id)) collisions.push(r.id);
        return false;
      }
      seenIds.add(r.id);
      return true;
    });

    const lastCrawledAt = new Date(nowMs()).toISOString();
    const newIds = new Set(deduped.map((r) => r.id));
    let changed = 0;
    let conforming = 0;

    const putItems = deduped.map((r) => {
      const changedInLastCrawl = !priorText.has(r.id) || priorText.get(r.id) !== r.text;
      if (changedInLastCrawl) changed++;
      if (r.earsConforming) conforming++;
      const item: RequirementRecord & { PK: string; SK: string } = {
        PK: reqPk(source),
        SK: reqSk(r.id),
        source,
        id: r.id,
        text: r.text,
        section: r.section,
        earsType: r.earsType,
        modality: r.modality,
        earsConforming: r.earsConforming,
        changedInLastCrawl,
        specHash: opts.specHash,
        lastCrawledAt,
        ...(opts.specVersion ? { specVersion: opts.specVersion } : {}),
      };
      return { PutRequest: { Item: item } };
    });

    // Requirements present before but absent now are dropped (R-107).
    const removedKeys = [...priorText.keys()].filter((id) => !newIds.has(id));
    const deleteItems = removedKeys.map((id) => ({
      DeleteRequest: { Key: { PK: reqPk(source), SK: reqSk(id) } },
    }));

    // Snapshot replace: puts for current + deletes for removed, chunked and
    // retried until DynamoDB accepts every item (R-107, NFR-4).
    await batchWriteAll([...putItems, ...deleteItems]);

    // Raw docs/spec.md snapshot in S3 (R-114, latest only — overwrite).
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: reqSpecKey(source),
        Body: opts.rawSpec,
        ContentType: "text/markdown",
      }),
    );

    return {
      discovered: deduped.length,
      conforming,
      nonConforming: deduped.length - conforming,
      changed,
      removed: removedKeys.length,
      ...(collisions.length ? { collisions } : {}),
    };
  }

  /**
   * Wipe a source's requirement snapshot — used when its `docs/spec.md` is
   * absent (source reachable): the source now declares zero requirements, so
   * its prior requirements are removed wholesale (latest-snapshot, R-105/D-45).
   */
  async wipeRequirements(source: string): Promise<RequirementCounts> {
    const prior = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": reqPk(source) },
        ProjectionExpression: "id",
      }),
    );
    const ids = ((prior.Items ?? []) as { id: string }[]).map((i) => i.id);
    await batchWriteAll(ids.map((id) => ({ DeleteRequest: { Key: { PK: reqPk(source), SK: reqSk(id) } } })));
    // Drop the stored raw spec snapshot too (DeleteObject is idempotent).
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: reqSpecKey(source) }));
    return { discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: ids.length };
  }

  /** List cataloged requirements (R-109), optionally filtered. */
  async listRequirements(
    filters: { source?: string; earsType?: string; conforming?: boolean } = {},
  ): Promise<RequirementRecord[]> {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: "begins_with(SK, :r)",
        ExpressionAttributeValues: { ":r": "R#" },
      }),
    );
    let items = (res.Items ?? []) as RequirementRecord[];
    if (filters.source) items = items.filter((i) => i.source === filters.source);
    if (filters.earsType) items = items.filter((i) => i.earsType === filters.earsType);
    if (filters.conforming !== undefined) items = items.filter((i) => i.earsConforming === filters.conforming);
    // Scan order is undefined; return a deterministic order — by source, then
    // requirement id in natural (numeric) order (R-109). Sort a copy (never
    // mutate the SDK's returned array).
    return [...items].sort((a, b) => a.source.localeCompare(b.source) || byRequirementId(a, b));
  }

  /** A source's full requirement set + spec metadata (R-110); undefined if none. */
  async getRequirementsForSource(
    source: string,
  ): Promise<{ source: string; specVersion?: string; specHash?: string; lastCrawledAt?: string; requirements: RequirementRecord[] } | undefined> {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": reqPk(source) },
      }),
    );
    const requirements = [...((res.Items ?? []) as RequirementRecord[])].sort(byRequirementId);
    if (requirements.length === 0) return undefined;
    const first = requirements[0];
    return { source, specVersion: first.specVersion, specHash: first.specHash, lastCrawledAt: first.lastCrawledAt, requirements };
  }

  /** One requirement, or undefined → 404 (R-111, R-112). */
  async getRequirement(source: string, id: string): Promise<RequirementRecord | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: reqPk(source), SK: reqSk(id) } }));
    return res.Item as RequirementRecord | undefined;
  }
}

// `Date.now()` isolated so it is the single wall-clock touch point.
function nowMs(): number {
  return Date.now();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Natural (numeric) ordering for requirement ids: `R-nn[suffix]` sorts by the
 * number then the letter suffix, so `R-2` < `R-10` < `R-100` < `R-100a` (R-109).
 */
function byRequirementId(a: { id: string }, b: { id: string }): number {
  const key = (id: string): [number, string] => {
    const m = /^R-(\d+)([a-z]*)$/.exec(id);
    return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, id];
  };
  const [an, as] = key(a.id);
  const [bn, bs] = key(b.id);
  return an - bn || as.localeCompare(bs);
}

/**
 * Send BatchWrite requests in 25-item chunks, retrying any `UnprocessedItems`
 * DynamoDB declines (throttling / size) until none remain — so a requirement
 * snapshot replace is never left partially applied (R-107, NFR-4). Bounded
 * retries with exponential backoff avoid a hot loop; a batch still unprocessed
 * after them throws (which the crawl isolates as a requirements failure — R-105a).
 */
async function batchWriteAll(requests: unknown[]): Promise<void> {
  for (let i = 0; i < requests.length; i += 25) {
    let batch = requests.slice(i, i + 25);
    for (let attempt = 0; batch.length > 0 && attempt < 8; attempt++) {
      if (attempt > 0) await sleep(Math.min(1000, 25 * 2 ** attempt)); // backoff before a retry
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: batch as any[] } }));
      batch = (res.UnprocessedItems?.[TABLE] ?? []) as unknown[];
    }
    if (batch.length > 0) throw new Error(`BatchWrite left ${batch.length} unprocessed item(s) after retries`);
  }
}

export const repository = new Repository();
