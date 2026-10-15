# Design — Prompt Versioning & Experiment Tracking

> **Version:** 0.2.0
> **Status:** Draft

## Summary

Extend the existing ODCS Contract Registry with three non-breaking additions to the current SST stacks: (1) a DynamoDB-backed prompt version catalog (`PROMPT#{}` items, `byKind` GSI, `kind = 'PROMPT'`) that lets writers add versioned prompts at runtime without redeploying; (2) migration of the existing hardcoded `v1` prompt from `llm.ts` into DynamoDB as a seed record, making all prompt text runtime-managed; (3) an experiment engine that runs one functional-gen job per experiment using a specified prompt version, stores the result artifact under an `experiments/` S3 prefix (with a 90-day lifecycle rule), and exposes an API + SPA view for listing saved experiment runs and comparing any two side by side. The existing `POST /generate-functional-tests` endpoint gains an optional `promptVersion` parameter that also reads from DynamoDB. All existing routes, Lambda entry points, DynamoDB item kinds, and generated-tests output paths remain completely unchanged.

---

## Open Questions — Resolved

- **OQ-1 — Prompt version string format:** RESOLVED. Enforce `[a-z0-9-_.]{1,64}`. Pure helper `isValidPromptVersion(s: string): boolean` in `packages/core/src/`. Applied in `handleCreatePromptVersion` before any DynamoDB write.
- **OQ-2 — Cell concurrency:** N/A — single-run model; no cells or fan-out.
- **OQ-3 — S3 artifact retention:** RESOLVED. 90-day lifecycle rule on `experiments/` prefix added to stack as part of this feature (R-64).

---

## Existing Patterns to Follow

- `packages/functions/src/functional-gen.ts` — handler/worker split with `InvocationType: 'Event'` async dispatch; `runFunctionalJob` fault-isolation model; `buildFunctionalInputs` parameterisation.
- `packages/functions/src/llm.ts` — `createBedrockClient` factory; forced tool use via `InvokeModel`; `LlmClient` interface injection.
- `packages/functions/src/repository.ts` — single-table key builders; `batchWriteAll()` retry loop; conditional put `attribute_not_exists(PK)` for 409 guard; S3 singleton client.
- `packages/functions/src/authorizer.ts` — `WRITER_ROUTES` Set; `requiredGroup()` + `isAuthorized()` enforcement.
- `packages/functest/src/ground.ts` — `PlanCache` hash; `promptVersion` already a first-class hash field (no structural change needed).
- `packages/web/src/App.tsx` — `view` state union; `setInterval` polling in `useEffect`; `isWriter(token)` gate.
- `specs/docs/data-model/` — single-table GSI conventions (`byKind`, `byEntity`).

---

## Areas Impacted

| Package / File | Nature of change |
|---|---|
| `packages/core/src/` | New file: `isValidPromptVersion` helper + exported types for `PromptVersionRecord`, `ExperimentRecord` |
| `packages/functions/src/authorizer.ts` | Add 2 writer routes to `WRITER_ROUTES` |
| `packages/functions/src/repository.ts` | Add key builders and CRUD helpers for 2 new item kinds; add S3 experiment-artifact helpers |
| `packages/functions/src/llm.ts` | Remove `PROMPTS` registry; extend `createBedrockClient` to accept `rawPromptText` (required when no registry); add DynamoDB prompt lookup helper |
| `packages/functions/src/functional-gen.ts` | Accept optional `promptVersion` param; look up prompt text from DynamoDB (default `'v1'`) |
| `packages/functions/src/prompt-versions.ts` | New file: 3 handler functions |
| `packages/functions/src/experiments.ts` | New file: handler, worker, and helper functions |
| `packages/functions/src/read.ts` | Export 5 new read handlers |
| `stacks/StorageStack.ts` | Add `kind` attribute for `byKind` GSI PROMPT entries; add 90-day lifecycle rule on `experiments/` prefix |
| `stacks/ApiStack.ts` | Add `ExperimentWorker` Function construct; add 7 new routes; add `ExperimentsSeeder` custom resource or deploy hook for PROMPT#v1 seed |
| `packages/web/src/api.ts` | Add 6 new API client methods |
| `packages/web/src/App.tsx` | Add `'experiments'` view entry; inline `ExperimentsView`, `ExperimentDetail`, `NewExperimentForm`, `NewPromptVersionForm` components |
| `stacks/tests/StorageStack.test.ts` | Update lifecycle rule assertions |
| `stacks/tests/ApiStack.test.ts` | Update route count assertion |

---

## Architecture

### Component overview

```
API Gateway HTTP API (existing)
  ├── POST /prompt-versions               → prompt-versions.ts :: handleCreatePromptVersion
  ├── GET  /prompt-versions               → read.ts :: promptVersions
  ├── GET  /prompt-versions/{v}           → read.ts :: promptVersion
  ├── POST /experiments                   → experiments.ts :: handler  (create + async dispatch)
  ├── GET  /experiments                   → read.ts :: experiments
  ├── GET  /experiments/{id}              → read.ts :: experiment
  └── GET  /experiments/{id}/artifact     → read.ts :: experimentArtifact

Lambda: ExperimentWorker (async, event-type)
  └── experiments.ts :: worker
        ├── loads EXP#{id} record from DynamoDB; sets status = 'running'
        ├── looks up PROMPT#{promptVersion} record from DynamoDB
        ├── builds LlmClient via createBedrockClient(model, region, rawPromptText)
        ├── delegates to buildExperimentInputs() + functional-gen execution logic
        ├── writes artifact to S3 experiments/{experimentId}/artifacts.json
        └── updates EXP#{id}: status='succeeded', planCount, skipCount, skips, artifactKey
            (or status='failed', error on any uncaught error)

Lambda: FunctionalGen (existing, extended)
  └── functional-gen.ts :: handler
        ├── accepts optional promptVersion in request body (default 'v1')
        ├── looks up PROMPT#{promptVersion} from DynamoDB
        └── passes rawPromptText to createBedrockClient (existing FJOB#/GEN# flow unchanged)
```

### Key composition rules

- `handleCreatePromptVersion` validates with `isValidPromptVersion()` (core), does a conditional put (`attribute_not_exists(PK)`) for 409 guard, returns 201.
- `experiments.ts :: handler` validates prompt version existence synchronously before writing `EXP#{}`, then dispatches worker with `InvocationType: 'Event'` and returns 202.
- `experiments.ts :: worker` is fault-catching: the entire job is wrapped in try/catch; any failure writes `status: 'failed'` with a redacted error on the experiment record. The worker always writes a terminal status — it never throws.
- `createBedrockClient` is extended: the `rawPromptText` parameter replaces the removed `PROMPTS` in-file lookup. All callers (both the existing functional-gen path and the experiment path) read from DynamoDB before calling the factory.
- `buildExperimentInputs(repo, promptRecord)` in `experiments.ts` mirrors `buildFunctionalInputs` but accepts a `PromptVersionRecord`; overrides `modelId`, `promptVersion`, and `rawPromptText` — importing shared catalog-loading helpers from `functional-gen.ts` to avoid duplication.
- The `PROMPT#v1` seed record is written by a deploy-time hook (Lambda custom resource or SST `Script` construct) using a conditional put — idempotent on re-deploy.

---

## Data Model Changes

Two new item kinds added to the existing single table. No existing items are modified.

### PROMPT#{promptVersion} — Prompt version record

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String | `PROMPT#{promptVersion}` |
| `SK` | String | `PROMPT` (static) |
| `promptVersion` | String | Validated against `[a-z0-9-_.]{1,64}` |
| `text` | String | Full prompt text passed to Bedrock |
| `modelId` | String | Bedrock model id (e.g. `us.anthropic.claude-sonnet-4-6`) |
| `kind` | String | `'PROMPT'` — `byKind` GSI PK |
| `createdAt` | String | ISO-8601 timestamp — `byKind` GSI SK |
| `createdBy` | String | Cognito username from JWT |
| `notes` | String? | Optional author description |

GSI membership: `byKind` (PK: `kind = 'PROMPT'`, SK: `createdAt` descending) — enables newest-first list without a scan.

### EXP#{experimentId} — Experiment record

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String | `EXP#{experimentId}` — uuid v4 |
| `SK` | String | `EXP` (static) |
| `kind` | String | `'EXPERIMENT'` — `byKind` GSI PK |
| `experimentId` | String | uuid v4 |
| `status` | String | `'pending'` → `'running'` → `'succeeded'` / `'failed'` |
| `promptVersion` | String | Single prompt version string used for this run |
| `createdAt` | String | ISO-8601 timestamp — `byKind` GSI SK |
| `createdBy` | String | Cognito username from JWT |
| `planCount` | Number? | Set on `succeeded` |
| `skipCount` | Number? | Set on `succeeded` |
| `skips` | String[]? | Set on `succeeded` |
| `artifactKey` | String? | S3 key — set on `succeeded` |
| `error` | String? | Redacted error message — set on `failed` |

GSI membership: `byKind` (PK: `kind = 'EXPERIMENT'`, SK: `createdAt` descending).

### `byKind` GSI — updated usage

| `kind` value | Item kind | Query use |
|---|---|---|
| `'CRAWL'` | Crawl run | Existing: list crawl runs |
| `'FJOB'` | Functional gen job | Existing: list generation runs |
| `'EXPERIMENT'` | Experiment record | New: `GET /experiments` |
| `'PROMPT'` | Prompt version | New: `GET /prompt-versions` |

No new GSI is required. The `byKind` GSI already exists with `kind` (PK) and `createdAt` / `startedAt` (SK) — both new item kinds use `createdAt` as the SK.

### S3 artifacts

New prefix: `experiments/{experimentId}/artifacts.json`

Content: JSON object with `{ manifest, plans }` matching the shape of the existing functional-gen artifact, but stored under the experiment prefix and never written to `generated-tests/functional/`.

S3 lifecycle rule: 90-day expiry on `experiments/` prefix, added to `StorageStack.ts`.

---

## API Surface Changes

Seven new routes added to the existing API Gateway HTTP API. Auth enforcement is handled by the existing Lambda authorizer. The existing `POST /generate-functional-tests` route gains an optional `promptVersion` body field — no route-level change.

---

### POST /prompt-versions

**Auth:** writer required

**Request body:**
```json
{
  "promptVersion": "v2-concise",
  "text": "You are a test engineer...",
  "modelId": "us.anthropic.claude-sonnet-4-6",
  "notes": "Optional description"
}
```

**Responses:**
- `201 Created` — `{ promptVersion, text, modelId, createdAt, createdBy, notes }`
- `400 Bad Request` — missing/blank required field, or `promptVersion` fails `[a-z0-9-_.]{1,64}` validation
- `409 Conflict` — `promptVersion` already exists

---

### GET /prompt-versions

**Auth:** reader required

**Response `200 OK`:**
```json
{
  "promptVersions": [
    { "promptVersion": "v2-concise", "modelId": "...", "createdAt": "...", "createdBy": "...", "notes": "..." }
  ]
}
```

Ordered newest-first by `createdAt`. Sourced from `byKind` GSI (`kind = 'PROMPT'`). Text field omitted from list response (retrieved on demand via GET single).

---

### GET /prompt-versions/{promptVersion}

**Auth:** reader required

**Response `200 OK`:** full record including `text`
**Response `404 Not Found`:** version does not exist

---

### POST /experiments

**Auth:** writer required

**Request body:**
```json
{
  "promptVersion": "v2-concise"
}
```

**Responses:**
- `202 Accepted` — `{ experimentId, statusUrl: "/experiments/{experimentId}" }`
- `400 Bad Request` — unknown `promptVersion` (names it)

---

### GET /experiments

**Auth:** reader required

**Response `200 OK`:**
```json
{
  "experiments": [
    {
      "experimentId": "...",
      "status": "succeeded",
      "promptVersion": "v2-concise",
      "createdAt": "...",
      "createdBy": "...",
      "planCount": 12,
      "skipCount": 1
    }
  ]
}
```

Ordered newest-first by `createdAt`. Sourced from `byKind` GSI (`kind = 'EXPERIMENT'`).

---

### GET /experiments/{experimentId}

**Auth:** reader required

**Response `200 OK`:** full experiment record including `planCount`, `skipCount`, `skips[]`, `artifactKey`, `error?`
**Response `404 Not Found`:** experiment does not exist

---

### GET /experiments/{experimentId}/artifact

**Auth:** reader required

**Response `200 OK`:** artifact content retrieved from S3:
```json
{
  "experimentId": "...",
  "promptVersion": "v2-concise",
  "manifest": { "..." : "..." },
  "plans": [ "..." ]
}
```

**Response `404 Not Found`:** experiment does not exist or has no artifact (not yet `succeeded`)

---

### POST /generate-functional-tests (existing — extended)

**Auth:** writer required (unchanged)

**Request body addition:** optional `promptVersion: string` field. If omitted, defaults to `'v1'`. Prompt text and modelId are looked up from `PROMPT#{promptVersion}` in DynamoDB. All other behaviour unchanged.

**Additional error:** `400 Bad Request` if `promptVersion` is supplied but does not exist in DynamoDB.

---

## Component Architecture

### `packages/core/src/prompt-versioning.ts` (new)

Exports:
- `isValidPromptVersion(s: string): boolean` — pure regex helper; `[a-z0-9-_.]{1,64}`
- Types: `PromptVersionRecord`, `ExperimentRecord`, `ExperimentStatus`

### `packages/functions/src/prompt-versions.ts` (new)

Exports:
- `handleCreatePromptVersion(event): Promise<APIGatewayProxyResultV2>` — validates, conditional-put to DynamoDB, 201/400/409
- `handleListPromptVersions(event): Promise<APIGatewayProxyResultV2>` — `QueryCommand` on `byKind` GSI with `kind = 'PROMPT'`, sort newest-first, 200
- `handleGetPromptVersion(event): Promise<APIGatewayProxyResultV2>` — direct key lookup, 200/404

### `packages/functions/src/experiments.ts` (new)

Exports:
- `handler` — Lambda entry for `POST /experiments`: validates `promptVersion` existence, writes `EXP#{}` record (`status: 'pending'`), dispatches `ExperimentWorker` via `InvocationType: 'Event'`, returns 202
- `worker` — Lambda entry for `ExperimentWorker`: loads experiment record, looks up `PROMPT#{}` record, sets status `'running'`, calls `runExperiment()`, writes terminal status at completion; always catches all errors
- `runExperiment(experimentId, promptRecord): Promise<void>` — pure, fault-catching; builds `LlmClient` via `createBedrockClient(model, region, rawPromptText)`, delegates to `buildExperimentInputs()` + functional-gen execution logic, writes artifact to S3, updates experiment record with results
- `buildExperimentInputs(repo, promptRecord)` — mirrors `buildFunctionalInputs` but accepts a `PromptVersionRecord`; overrides `modelId`, `promptVersion`, `rawPromptText`

### `packages/functions/src/functional-gen.ts` (modification)

- `handler` accepts optional `promptVersion` in request body; defaults to `'v1'`
- Calls `getPromptVersion(promptVersion)` from `repository.ts` to resolve prompt text and modelId before dispatching worker
- Returns `400` if `promptVersion` does not exist
- Worker receives `rawPromptText` in its event payload; passes it to `createBedrockClient`

### `packages/functions/src/read.ts` (additions)

New exports:
- `promptVersions` — delegates to `handleListPromptVersions`
- `promptVersion` — delegates to `handleGetPromptVersion`
- `experiments` — delegates to `handleListExperiments`
- `experiment` — delegates to `handleGetExperiment`
- `experimentArtifact` — delegates to `handleGetExperimentArtifact` (fetches S3 artifact, merges into response)

### `packages/functions/src/llm.ts` (modification)

- `PROMPTS` in-file registry object **removed**
- `createBedrockClient(model, region, rawPromptText: string)`: `rawPromptText` is now a required parameter (callers always read from DynamoDB before calling the factory). Existing call sites in `functional-gen.ts` updated to pass the resolved text.
- No behaviour change to the Bedrock invocation logic itself

### `packages/functions/src/repository.ts` (additions)

New key builders:
- `promptVersionKey(promptVersion)` → `{ PK: 'PROMPT#{promptVersion}', SK: 'PROMPT' }`
- `experimentKey(experimentId)` → `{ PK: 'EXP#{experimentId}', SK: 'EXP' }`

New CRUD functions:
- `putPromptVersion(record)` — conditional put with `attribute_not_exists(PK)` for 409 guard
- `getPromptVersion(promptVersion)` — `GetCommand` by key
- `listPromptVersions()` — `QueryCommand` on `byKind` GSI with `kind = 'PROMPT'`, SK descending
- `putExperiment(record)` — `PutCommand`
- `updateExperiment(experimentId, patch)` — `UpdateCommand` for status/counts/artifactKey/error
- `getExperiment(experimentId)` — `GetCommand`
- `listExperiments()` — `QueryCommand` on `byKind` GSI with `kind = 'EXPERIMENT'`, SK descending
- `putExperimentArtifact(experimentId, artifact)` — S3 `PutObjectCommand` to `experiments/{experimentId}/artifacts.json`
- `getExperimentArtifact(experimentId)` — S3 `GetObjectCommand`

### `packages/functions/src/authorizer.ts` (modification)

Add to `WRITER_ROUTES` Set:
- `'POST /prompt-versions'`
- `'POST /experiments'`

### `stacks/StorageStack.ts` (modification)

- Ensure `kind` attribute is declared for `byKind` GSI (already exists; verify projection includes new item kinds)
- Add S3 lifecycle rule: `expiration: { days: 90 }` scoped to `prefix: 'experiments/'`

### `stacks/ApiStack.ts` (modification)

- Add `ExperimentWorker` Function construct (async, `timeout: Duration.minutes(15)`)
- Add 7 new API routes
- Add deploy-time seed mechanism (SST `Script` construct or Lambda custom resource) to write `PROMPT#v1` using conditional put; runs after DynamoDB table is provisioned

---

## SPA

### New view entry

`App.tsx` `view` state union gains `'experiments'`. Nav adds an "Experiments" link visible to all authenticated users.

### Component tree

```
App (view='experiments')
  └── ExperimentsView
        ├── NewPromptVersionForm   [writers only, isWriter(token)]
        │     Fields: promptVersion, modelId, text (textarea), notes
        │     Submit: POST /prompt-versions → reset + refresh prompt list
        ├── NewExperimentForm      [writers only, isWriter(token)]
        │     Fields: prompt version single-select (from GET /prompt-versions)
        │     Submit: POST /experiments → navigate to experiment detail
        └── ExperimentList
              └── ExperimentRow (selectable for comparison)
                    [When two rows selected → ExperimentComparison]
                    ExperimentComparison
                      └── side-by-side CSS Grid (two columns, one per selected run)
                            RunColumn
                              ├── status badge + progress indicator (if running, poll GET /experiments/{id})
                              ├── plan list (loaded from GET /experiments/{id}/artifact)
                              └── skip list + error message if failed
```

### API client additions (`packages/web/src/api.ts`)

Six new methods:
1. `createPromptVersion(payload)` — POST /prompt-versions
2. `listPromptVersions()` — GET /prompt-versions
3. `createExperiment(payload)` — POST /experiments
4. `listExperiments()` — GET /experiments
5. `getExperiment(experimentId)` — GET /experiments/{id}
6. `getExperimentArtifact(experimentId)` — GET /experiments/{id}/artifact

### Polling model

When a selected experiment is in a non-terminal state, `RunColumn` uses `setInterval(poll, 5000)` inside `useEffect` polling `GET /experiments/{id}`. The interval is cleared when `status === 'succeeded' || status === 'failed'` (mirrors existing App.tsx polling pattern).

---

## Key Technical Decisions

### Simplified single-run experiment model

- **Options considered:** Matrix model (N prompt versions × 1 snapshot per experiment, fan-out, per-cell records), single-run model (one experiment = one job = one result set)
- **Chosen:** Single-run model
- **Reason:** Matrix introduces ECELL# items, fan-out coordination, and per-cell status tracking for no additional qualitative benefit — comparison is achieved by browsing saved single runs and picking any two. Simpler model; concurrent fan-out belongs in `parallel-llm-generation`.
- **Affects:** R-20, R-30, R-60

### PROMPTS registry migration in scope

- **Options considered:** Keep in-file `PROMPTS` registry alongside DynamoDB (experiment path uses DDB, existing path uses file), migrate `v1` to DynamoDB and remove registry
- **Chosen:** Migrate `v1` to DynamoDB and remove `PROMPTS` from `llm.ts`
- **Reason:** A parallel registry creates divergence risk — the existing path could silently use a different prompt than what is stored in DynamoDB. Single source of truth at runtime; seeding is idempotent.
- **Affects:** R-08, R-09, R-10

### `byKind` GSI for prompt version list

- **Options considered:** `ScanCommand` with `begins_with(PK, 'PROMPT#')` + client-side sort, `byKind` GSI query
- **Chosen:** `byKind` GSI with `kind = 'PROMPT'`
- **Reason:** Consistent with the pattern used for crawl runs, generation runs, and experiments; avoids table scans at any volume; `kind` is already a standard attribute — no new GSI required.
- **Affects:** R-05, R-61

### 90-day S3 lifecycle rule on `experiments/` prefix

- **Options considered:** No lifecycle rule (mirror existing no-TTL posture), lifecycle rule in scope, lifecycle rule deferred
- **Chosen:** 90-day lifecycle rule, in scope
- **Reason:** Bounds storage cost proactively; 90 days is sufficient for qualitative review; a single lifecycle rule configuration line in `StorageStack.ts` — no reason to defer.
- **Affects:** R-64

### Async dispatch mechanism

- **Options considered:** Lambda async invoke (`InvocationType: 'Event'`), SQS queue + Lambda trigger, Step Functions Express Workflow
- **Chosen:** Lambda async invoke (existing pattern from `functional-gen.ts`)
- **Reason:** Zero new infrastructure; established pattern; the worker always writes terminal status, so a permanently-pending record from a failed dispatch is recoverable by re-triggering. SQS adds delivery guarantees unnecessary for single-run execution. Step Functions adds cost and complexity at this scale.
- **Affects:** R-20, R-30, R-62

### `createBedrockClient` extension

- **Options considered:** New `createExperimentBedrockClient` factory, modify existing `createBedrockClient` with required `rawPromptText` param, wrapper function
- **Chosen:** Extend `createBedrockClient` with `rawPromptText` as a required parameter (all callers read from DynamoDB before calling the factory)
- **Reason:** Single factory; no duplicated Bedrock invocation logic; making `rawPromptText` required removes the implicit in-file fallback that the `PROMPTS` registry provided, enforcing DynamoDB as the sole source.
- **Affects:** R-31, R-34

### Prompt version format validation

- **Options considered:** Free-text (no constraint), semver, ajv/zod schema, pure regex helper
- **Chosen:** Pure regex `[a-z0-9-_.]{1,64}` in `isValidPromptVersion()` in `packages/core/src/`
- **Reason:** Prevents DynamoDB key surprises; no dependency on ajv/zod for a single-field rule; extractable to core for reuse in handler and SPA.
- **Affects:** R-01, R-04

---

## Integration Boundaries

Each point below is a candidate integration test:

1. **`handleCreatePromptVersion` → DynamoDB** — conditional put; 409 on duplicate PK
2. **`experiments.ts :: handler` → DynamoDB** — prompt version existence check + `EXP#{}` put before dispatch
3. **`experiments.ts :: handler` → Lambda async invoke** — `ExperimentWorker` dispatched with `experimentId` in payload
4. **`experiments.ts :: worker` → DynamoDB** — `EXP#{}` status transitions (`pending` → `running` → terminal)
5. **`experiments.ts :: worker` → `createBedrockClient`** — `rawPromptText` from DynamoDB passed through; existing Bedrock call path unmodified
6. **`experiments.ts :: worker` → S3** — artifact JSON written to `experiments/{id}/artifacts.json`
7. **`read.ts :: experimentArtifact` → S3** — artifact fetched and returned in response body
8. **`authorizer.ts` → new writer routes** — `POST /prompt-versions` and `POST /experiments` blocked for readers
9. **`byKind` GSI → `PROMPT#{}` items** — GSI populated on prompt version write; query returns versions ordered newest-first
10. **`byKind` GSI → `EXP#{}` items** — experiment list query via `kind = 'EXPERIMENT'`
11. **`functional-gen.ts :: handler` → DynamoDB** — `promptVersion` param resolved to `PROMPT#{}` record; default `'v1'` lookup succeeds after seed
12. **`StorageStack` → S3 lifecycle rule** — `experiments/` prefix has 90-day expiry configured

---

## Failure Modes

| Boundary | Failure | Handling |
|---|---|---|
| `handleCreatePromptVersion` → DynamoDB | `ConditionalCheckFailedException` | Return `409 Conflict` |
| `experiments.ts :: handler` → DynamoDB (prompt version check) | Version not found | Return `400 Bad Request` naming the missing version |
| `experiments.ts :: handler` → Lambda invoke | Invoke fails (throttle, IAM) | Return `500`; `EXP#{}` record left in `pending` — caller knows operation failed; re-trigger manually |
| `experiments.ts :: worker` → Bedrock | Throttle, timeout, malformed response | Experiment marked `failed` with redacted error |
| `experiments.ts :: worker` → DynamoDB write | Write fails | Experiment marked `failed`; remaining error-recording logic runs |
| `experiments.ts :: worker` → S3 artifact write | S3 error | Experiment marked `failed`; `artifactKey` absent |
| `read.ts :: experimentArtifact` → S3 | Object not found (run failed before artifact write) | `404 Not Found` — no artifact was produced |
| `functional-gen.ts` → DynamoDB (PROMPT#v1 lookup) | Seed not yet present | `400`; this should not occur in normal operation — seed runs at deploy time |
| `PROMPT#v1` seeder → DynamoDB | Seed item already exists | Conditional put is a no-op; idempotent re-deploy |

---

## Tech Debt

1. **S3 lifecycle rule coverage (resolved):** 90-day lifecycle rule added to `experiments/` prefix as part of this feature (R-64). The existing `functional-tests/` prefix has no lifecycle rule — flagged for a follow-on infra task if storage cost becomes a concern.
2. **`listPromptVersions` GSI (resolved):** Uses `byKind` GSI with `kind = 'PROMPT'` — no scan. Consistent with existing patterns at any volume.

---

## Decisions Log

**D-1 — Single-run experiment model (not matrix).**
- **Decision:** One experiment = one job using one prompt version. Historical comparison by browsing and selecting any two saved runs.
- **Reason:** Matrix model adds ECELL# items, fan-out coordination, and per-cell tracking; comparison goal is equally served by single runs. Fan-out deferred to `parallel-llm-generation`.
- **Affects:** R-20, R-30, R-60

**D-2 — PROMPTS registry migration is in scope.**
- **Decision:** Hardcoded `PROMPTS` object removed from `llm.ts`; `PROMPT#v1` seeded in DynamoDB at deploy time.
- **Reason:** Single source of truth for prompt text; avoids divergence between in-file and DynamoDB-managed prompts.
- **Affects:** R-08, R-09, R-10

**D-3 — `byKind` GSI used for prompt version list (`kind = 'PROMPT'`).**
- **Decision:** `GET /prompt-versions` queries `byKind` GSI — no `ScanCommand`.
- **Reason:** Consistent with existing crawl/generation/experiment list patterns; avoids table scans at any volume; no new GSI required.
- **Affects:** R-05, R-61

**D-4 — 90-day S3 lifecycle rule on `experiments/` prefix, in scope.**
- **Decision:** Added to `StorageStack.ts` as part of this feature.
- **Reason:** Bounds storage cost proactively; trivial to configure; no reason to defer.
- **Affects:** R-64

**D-5 — `sourceSnapshotId` out of scope.**
- **Decision:** Experiments use current catalog state. No snapshot pinning.
- **Reason:** Crawl run records have no reliable `status` field; resolving "most recent succeeded crawl" is not safe. Snapshot pinning belongs in `generation-run-audit`.
- **Affects:** R-20, R-30

**D-6 — Lambda async invoke (`InvocationType: 'Event'`) for worker dispatch.**
- **Decision:** Same pattern as `functional-gen.ts`.
- **Reason:** Zero new infrastructure; worker always writes terminal status; single-run model makes at-least-once delivery unnecessary.
- **Affects:** R-20, R-62

**D-7 — `createBedrockClient` `rawPromptText` is required (not optional).**
- **Decision:** All callers read from DynamoDB before calling the factory. The in-file `PROMPTS` fallback is removed.
- **Reason:** Makes DynamoDB the sole source of prompt text; removes implicit fallback that could mask a missing seed record.
- **Affects:** R-31, R-34

**D-8 — Prompt version format: `[a-z0-9-_.]{1,64}` enforced by `isValidPromptVersion()` in `packages/core/src/`.**
- **Decision:** Pure regex helper; no ajv/zod.
- **Reason:** Prevents DynamoDB key edge cases; single reusable function; consistent with existing pure core helpers.
- **Affects:** R-01, R-04

**D-9 — Experiment list sourced from `byKind` GSI (`kind = 'EXPERIMENT'`).**
- **Decision:** Same GSI used for crawl runs and generation runs.
- **Reason:** Consistent with existing pattern; `kind` is already a standard attribute.
- **Affects:** R-40, R-61
