# DynamoDB — `Registry` Table

Single-table design. On-demand capacity, `TableEncryption.AWS_MANAGED` (SSE-KMS).

## Item kinds

| Kind | PK | SK | Key attributes |
|---|---|---|---|
| **Catalog entry** — current state of `{source, id}` | `SRC#{source}` | `CON#{id}` | `entity`, `name`, `filePath`, `currentVersion` (int), `currentHash` (git blob SHA), `declaredVersion`, `validation` (`valid`\|`invalid`), `validationErrors?`, `commitSha`, `lastCrawledAt` |
| **Version** — immutable history row | `VER#{source}#{id}` | `V#{000n}` (zero-padded) | `versionNumber`, `hash`, `declaredVersion`, `versionNotBumped` (bool), `commitSha`, `crawledAt`, `validation`, `s3Key` |
| **Crawl run** | `RUN#{runId}` | `RUN` | `kind:"CRAWL"`, `startedAt`, `endedAt`, `sources[]` (label, outcome, counts), `collisions[]` |
| **Single-flight lock** | `LOCK` | `CRAWL` | `runId`, `acquiredAt`, `ttl` (DynamoDB TTL attribute) |
| **Requirement** — latest snapshot of `{source, R-id}` | `REQ#{source}` | `R#{id}` | `text`, `earsType` (event/unwanted/state/optional/ubiquitous), `modality` (SHALL/SHOULD/MAY/null), `section`, `earsConforming` (bool), `changedInLastCrawl` (bool), `specHash`, `specVersion?`, `lastCrawledAt` |
| **Generation run** | `GEN#{runId}` | `GEN` | `kind:"GENERATION"`, `startedAt`, `endedAt`, `counts`, `skipped[]`, `catalogContext`, `artifactS3Key` |
| **Functional job** | `FJOB#{jobId}` | `FJOB` | `kind:"FUNCTIONAL_GEN"`, `status` (pending/running/succeeded/failed), `startedAt`, `finishedAt?`, `modelId`, `promptVersion`, `planCount`, `skipCount`, `skips[]`, `artifactKey`, `error?` |
| **Pipeline config** | `PIPELINE#{pipelineId}` | `PIPELINE` | `kind:"PIPELINE"`, `pipelineId`, `name`, `steps[]`, `maxSteps`, `maxAgeMinutes`, `active`, `defaultSampling`, `defaultMode`, `version`, `createdAt`, `updatedAt` |
| **Pipeline run** | `PRUN#{runId}` | `PRUN` | `kind:"PRUN"`, `runId`, `pipelineId`, `pipelineConfigVersion`, `status`, `startedAt`, `completedAt?`, `sampling`, `mode`, `requirementIds[]`, `experimentId?`, `artifact?`, `warnings[]` |
| **Step record** — child of PRUN, shares PK | `PRUN#{runId}` | `STEP#{nn}` (zero-padded) | `stepId`, `stepIndex`, `label`, `model`, `promptKey`, `promptVersion`, `status`, `outputRef?`, `inputRef?`, `leaseExpiresAt?`, `cacheKey`, `durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `costEstimateUsd`, `errorMessage?` |
| **Prompt header** | `PRMPT#{promptKey}` | `PRMPT` | `kind:"PRMPT"`, `promptKey`, `currentVersion`, `body?` (≤64KB), `s3Ref?` (>64KB), `active`, `createdAt`, `updatedAt` |
| **Prompt version** — immutable | `PRMPTVER#{promptKey}#{nnnnn}` (5-digit zero-padded) | `PRMPTVER` | `kind:"PRMPTVER"`, `promptKey`, `version`, `body?`, `s3Ref?`, `createdAt` |
| **Step cache entry** | `STEPCACHE#{cacheKey}` | `CACHE` | `outputRef`, `createdAt` |
| **Pipeline experiment** — groups runs of one trigger | `PEXP#{experimentId}` | `PEXP` | `kind:"PEXP"`, `experimentId`, `pipelineId`, `pipelineName`, `pipelineConfigVersion`, `sampling`, `mode`, `runs[]`, `skipped[]`, `createdAt`, `startedAt` |
| **System config** — model allowlist | `SYSCONFIG` | `MODEL_ALLOWLIST` | `allowedModels[]`, `pricing{}` (per-model input/output price), `updatedAt` |

## GSIs

### `byEntity`
- PK: `entity`, SK: `source`
- Only catalog-entry items populate `entity`
- Backs `GET /entities/{entity}` — returns all source variants of an entity
- Read handler re-orders publisher-first before diffing so A/B is deterministic

### `byKind`
- PK: `kind`, SK: `startedAt`
- Partitions: `CRAWL`, `GENERATION`, `FUNCTIONAL_GEN`, `PROMPT` (legacy prompt versions), `EXPERIMENT` (legacy experiments), `PRUN`, `PEXP`
- Only items with `startedAt` are indexed — `PIPELINE`, `PRMPT`, and `PRMPTVER` have no `startedAt` and are listed via PK-prefix Scans instead (writing a new kind without `startedAt` and querying it here returns nothing; this bit PIPELINE, PRMPT and PRMPTVER in turn)
- Backs `GET /crawls`, `GET /test-artifacts`, `GET /functional-test-jobs`, `GET /prompt-versions`, `GET /experiments`, `GET /runs`, `GET /experiment-index` — newest-first via SK sort

## Key semantics

**Catalog key:** `{source label, contract id}`. Same `id` from two different sources = two distinct entries (never merged).

**Version transitions:**
- Fresh hash ≠ stored `currentHash` → append a new `Version` row, bump `currentVersion`
- Fresh hash = stored `currentHash` → unchanged; bump `lastCrawledAt`/`commitSha` only
- Content changed but declared `version` field unchanged → `versionNotBumped: true` on the new version row

**Lock:** Conditional write (`attribute_not_exists`) at crawl start, release at end. TTL fallback frees a crashed crawl's lock automatically.

**Requirements:** No `REQVER#` history rows — latest snapshot only. Wholesale BatchWrite replace (puts for current + deletes for removed ids). Collisions (same `R-nn` twice) keep-first with a logged warning.

**Pipelines:** Config items (`PIPELINE`, `PRMPT`) are not indexed by `byKind` (no `startedAt`); list operations use PK-prefix scans. Run items (`PRUN`, `PEXP`) have `startedAt` and are indexed.

**Step records:** Child items of a PRUN, sharing the PRUN's PK. Queried via `pk = PRUN#{runId} AND begins_with(sk, 'STEP#')`.

**Prompt versions:** Immutable once written; version numbers are zero-padded to 5 digits. Not in `byKind`; `GET /prompts/{key}/versions` Scans `begins_with(PK, 'PRMPTVER#{key}#')` and sorts by `version`.

**Step cache:** Keyed by SHA-256 hash of `{inputHash, pipelineId, pipelineConfigVersion, stepId, promptKey, promptVersion, instructionsVersion?}`. Concurrent writes use conditional `attribute_not_exists(pk)` — second writer reads existing entry.
