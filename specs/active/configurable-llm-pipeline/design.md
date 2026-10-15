# Design — Configurable LLM Pipeline

> **Version:** 0.2.0
> **Status:** Draft

## Summary

A runtime-configurable multi-step LLM pipeline replaces the single hardcoded functional-test LLM call. Pipeline configurations and prompts are stored in DynamoDB and managed via new API routes. A single reusable step Lambda executes each step in sequence using an async Lambda chain, reading config from DDB on each invocation, building context from the original grounded data plus prior step outputs, calling Bedrock, caching results by SHA-256 key, and invoking the next step. The SPA gains Pipeline and Prompt CRUD pages for writer users.

---

## Existing Patterns to Follow

- `packages/functions/src/experiments.ts` — async worker lifecycle: HTTP handler creates DDB record, dispatches `InvocationType: 'Event'`, returns 202; worker fetches state, calls Bedrock, writes S3 artifact, updates terminal status.
- `packages/functions/src/functional-gen.ts` — current single-step LLM dispatch being extended: `dispatchWorker`, `runFunctionalJob`.
- `packages/functions/src/repository.ts` — key-builder pattern (`fjobPk`, `promptVersionPk`, etc.) must be followed for all new item types. Conditional write pattern (`attribute_not_exists`) reused for cache dedup.
- `packages/functions/src/llm.ts` — `createBedrockClient(model, region, promptVersion, rawPromptText)` returns an injectable `LlmClient`. Each step Lambda calls this with the step's resolved model + fetched prompt body.
- `packages/functest/src/ground.ts` — `buildFunctionalInputs` assembles `FunctionalGenInputs`. Step Lambda calls this, then extends the resulting `GroundedContext` with `priorOutputs`.
- `packages/functions/src/http.ts` — `json(statusCode, body)` and `notFound()` helpers. All new handlers must use these.
- `packages/functions/src/log.ts` — structured JSON logger. No `console.log`; no raw LLM output in log fields.
- `packages/web/src/pages/ExperimentsPage.tsx` lines 124–148 — 5-second polling pattern for run status; reused for pipeline run status.
- `packages/web/src/api.ts` — `createApi(token)` factory; new CRUD methods added here.
- `specs/docs/data-model/registry-table.md` — single-table design; `byKind` GSI for list queries.
- `specs/docs/integrations/bedrock.md` — forced tool use via `InvokeModel`; IAM-role auth.

---

## Areas Impacted

| Area | Impact |
|---|---|
| `packages/core/src/` | New file `pipeline.ts` — shared types for `PipelineConfig`, `PipelineStep`, `PipelineRun`, `StepRecord`, `PromptItem`, `PromptVersionItem`, `ModelAllowlist`, `PipelineRunStatus`, `StepStatus` |
| `packages/functions/src/repository.ts` | New key builders (`pipelinePk`, `prunPk`, `stepSk`, `prmptPk`, `prmptverPk`, `sysconfigPk`) and CRUD helpers for each new item type |
| `packages/functions/src/functional-gen.ts` | Extend `handleGenerateFunctional` to detect `pipelineId` in request body and branch to the new pipeline path |
| `packages/functions/src/pipeline.ts` | NEW — pipeline HTTP handlers (CRUD) and the step worker `runStep` function |
| `packages/functions/src/read.ts` | New GET handlers for pipeline/prompt list + detail routes; lazy lease-expiry check for `GET /runs/{runId}` |
| `packages/functions/src/authorizer.ts` | Extend `WRITER_ROUTES` Set with all new mutation routes |
| `packages/functest/src/llm.ts` | Extend `GroundedContext` with optional `priorOutputs` field; backward-compatible |
| `stacks/ApiStack.ts` | New step worker Function construct with 15-min timeout, `configureAsyncInvoke({ retryAttempts: 0 })`, new API routes, seeder additions |
| `packages/web/src/api.ts` | New typed methods for pipeline and prompt CRUD |
| `packages/web/src/pages/` | NEW `PipelinesPage.tsx`, `PromptsPage.tsx`, `RunDetailPage.tsx` |
| `packages/web/src/AppRoutes.tsx` | New routes for `/pipelines` and `/prompts` |
| `generated-tests/` | Unchanged — machine-generated artifacts, output only |

---

## Architecture

```
API Gateway
    │
    ├─ POST /generate-functional-tests { pipelineId }
    │       │
    │       └─ functional-gen handler
    │               ├─ reads pipeline config from DDB
    │               ├─ writes PRUN#<runId> record (status: running)
    │               ├─ InvocationType: 'Event' → step Lambda { runId, stepIndex: 0 }
    │               └─ HTTP 202 { runId }
    │
    ├─ GET/POST/PUT/DELETE /pipelines[/{id}]
    │       └─ pipeline handler (HTTP, CRUD only)
    │
    ├─ GET/POST/PUT /prompts[/{key}[/versions]]
    │       └─ prompt handler (HTTP, CRUD only)
    │
    └─ GET /runs/{runId}
            └─ read handler (lazy lease-expiry check inline)

Step Lambda (single reusable function, invoked with { runId, stepIndex })
    │
    ├─ read PRUN record + pipeline config (by pipelineConfigVersion pinned to run)
    ├─ write leaseExpiresAt on STEP#<stepIndex> record
    ├─ check cache key → hit: skip LLM, mark 'cached'
    ├─ fetch prompt body (DDB inline or S3)
    ├─ build GroundedContext + priorOutputs
    ├─ createBedrockClient(model, region, promptVersion, promptBody)
    ├─ call synthesizePlan(groundedContext)   ← retries on transient errors
    ├─ write output to S3 (or DDB inline ≤64KB)
    ├─ write cache entry
    ├─ update STEP record (status, outputRef, contextTokenEstimate, outputTokens)
    ├─ check maxAge + maxSteps guards
    └─ InvocationType: 'Event' → self { runId, stepIndex + 1 }
                                 or mark run completed/failed/timed_out

DynamoDB (Registry table — single table)
    New item types: PIPELINE, PRUN, STEP (child of PRUN), PRMPT, PRMPTVER, SYSCONFIG

S3 (existing raw-artifact bucket)
    New prefixes: pipeline-outputs/<runId>/<stepIndex>.json
                  prompts/<promptKey>/<version>.txt
```

---

## Data Model Changes

All new items live in the existing `Registry` DynamoDB table under new PK prefixes. `byKind` GSI is used for list queries.

### `PIPELINE#<pipelineId>` / `PIPELINE` — pipeline config

| Field | Type | Notes |
|---|---|---|
| `pk` | `PIPELINE#<pipelineId>` | |
| `sk` | `PIPELINE` | |
| `kind` | `"PIPELINE"` | GSI partition key |
| `pipelineId` | string | UUID |
| `name` | string | Human-readable name |
| `steps` | `PipelineStep[]` | Ordered array (see step fields below) |
| `maxSteps` | number | Hard cap 20; defaults 10 |
| `maxAgeMinutes` | number | Max wall-clock run age; default 60 |
| `active` | boolean | `false` = soft-deleted |
| `defaultSampling` | `{ strategy, n?, percentage?, ids? }` | Run-level sampling default; `{ strategy: "first_n", n: 3 }` if omitted |
| `defaultMode` | `"per_requirement" \| "batch"` | Run-level mode default; `"per_requirement"` if omitted |
| `version` | number | Bumped on every PUT |
| `createdAt` | ISO-8601 string | |
| `updatedAt` | ISO-8601 string | |

Each `PipelineStep` object in `steps`:

| Field | Type | Notes |
|---|---|---|
| `stepId` | string | Unique within pipeline (e.g. `s1`) |
| `label` | string | Display name |
| `model` | string | Bedrock model ID, validated against allowlist |
| `promptKey` | string | References a `PRMPT#` item |
| `optional` | boolean | Default `false` |
| `waitForHuman` | boolean | Default `false`; reserved, treated as no-op in v1 |
| `includeContext` | boolean | Default `true` |

### `PRUN#<runId>` / `PRUN` — pipeline run record

| Field | Type | Notes |
|---|---|---|
| `pk` | `PRUN#<runId>` | |
| `sk` | `PRUN` | |
| `kind` | `"PRUN"` | GSI partition key |
| `runId` | string | UUID |
| `pipelineId` | string | |
| `pipelineConfigVersion` | number | Snapshot of config version at run start — steps execute with this version |
| `status` | `PipelineRunStatus` | `running` \| `completed` \| `completed_with_warnings` \| `failed` \| `timed_out` |
| `startedAt` | ISO-8601 string | |
| `completedAt` | ISO-8601 string \| undefined | Set on terminal transition |
| `failedAt` | ISO-8601 string \| undefined | Set when `status: 'failed'` |
| `errorMessage` | string \| undefined | Terminal error message |
| `errorStack` | string \| undefined | Stack trace (truncated to fit DDB item) |
| `sampling` | `{ strategy, n?, percentage?, ids? }` | Resolved sampling config used for this run (after run-request override applied) |
| `mode` | `"per_requirement" \| "batch"` | Resolved mode used for this run |
| `requirementIds` | `string[]` | Requirement IDs selected by the sampling strategy for this run |
| `executedSteps` | number | Count of steps attempted (incremented before each step invocation) |
| `warnings` | `string[]` | Collected warning messages from optional failed steps |

### `PRUN#<runId>` / `STEP#<stepIndex>` — step record

Step records share the PK with the run record, allowing them to be fetched in a single `Query`.

| Field | Type | Notes |
|---|---|---|
| `pk` | `PRUN#<runId>` | Same PK as run record |
| `sk` | `STEP#<stepIndex>` | Zero-padded index, e.g. `STEP#00` |
| `stepId` | string | From pipeline config |
| `stepIndex` | number | |
| `label` | string | From pipeline config at execution time |
| `model` | string | From pipeline config at execution time |
| `promptKey` | string | |
| `promptVersion` | number | Version of prompt fetched at execution time |
| `status` | `StepStatus` | `running` \| `completed` \| `cached` \| `failed` \| `warning` |
| `leaseExpiresAt` | ISO-8601 string \| undefined | Cleared on successful completion |
| `cacheKey` | string | SHA-256 hex of cache key tuple |
| `outputRef` | `{ inline: string }` \| `{ s3Key: string }` | Where step output is stored |
| `durationMs` | number \| undefined | Total step execution time from lease write to step record update |
| `bedrockLatencyMs` | number \| undefined | Time from Bedrock InvokeModel call start to response received |
| `inputTokens` | number \| undefined | From Bedrock response `usage.input_tokens` |
| `outputTokens` | number \| undefined | From Bedrock response `usage.output_tokens` |
| `inputCharacters` | number \| undefined | Character count of full context string sent to Bedrock |
| `outputCharacters` | number \| undefined | Character count of raw output string received |
| `contextTokenEstimate` | number \| undefined | Character-heuristic estimate (~4 chars per token) |
| `costEstimateUsd` | number \| undefined | `(inputTokens × inputPricePerToken) + (outputTokens × outputPricePerToken)` from model price table |
| `startedAt` | ISO-8601 string | |
| `completedAt` | ISO-8601 string \| undefined | |
| `errorMessage` | string \| undefined | Sanitized; API keys, tokens, and secrets redacted via `redact()` utility |
| `errorStack` | string \| undefined | Sanitized stack trace; same redaction applied |

### `PRMPT#<promptKey>` / `PRMPT` — prompt header

| Field | Type | Notes |
|---|---|---|
| `pk` | `PRMPT#<promptKey>` | Note: `PRMPT` not `PROMPT` — avoids collision with existing `PROMPT#v1` items |
| `sk` | `PRMPT` | |
| `kind` | `"PRMPT"` | GSI partition key |
| `promptKey` | string | Human-readable identifier (e.g. `functional-test-gen-v2`) |
| `currentVersion` | number | Incremented on each PUT |
| `body` | string \| undefined | Present if body ≤ 64 KB |
| `s3Ref` | string \| undefined | S3 key if body > 64 KB |
| `active` | boolean | `false` = soft-deleted; excluded from list responses |
| `createdAt` | ISO-8601 string | |
| `updatedAt` | ISO-8601 string | |

### `PRMPTVER#<promptKey>#<version>` / `PRMPTVER` — prompt version record

Immutable once written.

| Field | Type | Notes |
|---|---|---|
| `pk` | `PRMPTVER#<promptKey>#<version>` | Zero-padded version, e.g. `PRMPTVER#my-prompt#00001` |
| `sk` | `PRMPTVER` | |
| `kind` | `"PRMPTVER"` | GSI partition key |
| `promptKey` | string | |
| `version` | number | |
| `body` | string \| undefined | Inline if ≤ 64 KB |
| `s3Ref` | string \| undefined | S3 key if > 64 KB |
| `createdAt` | ISO-8601 string | |

### `SYSCONFIG` / `MODEL_ALLOWLIST` — model allowlist

| Field | Type | Notes |
|---|---|---|
| `pk` | `SYSCONFIG` | |
| `sk` | `MODEL_ALLOWLIST` | |
| `allowedModels` | `string[]` | List of permitted Bedrock model IDs |
| `pricing` | `{ [modelId]: { inputPricePerMillionTokens: number, outputPricePerMillionTokens: number } }` | Per-model pricing used to compute `costEstimateUsd`; updatable without redeploy |
| `updatedAt` | ISO-8601 string | |

Seeded by the existing seeder Lambda at deploy time. Updatable at runtime via a direct DDB write (no API route in v1). The step Lambda reads `pricing` alongside `allowedModels` and computes `costEstimateUsd` after each successful Bedrock call.

---

## API Surface Changes

New routes (all gated by the existing writer-group Lambda authorizer except GET routes which require authentication but not writer group):

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/pipelines` | authenticated | List active pipelines (paginated) |
| `POST` | `/pipelines` | writer | Create pipeline |
| `GET` | `/pipelines/{pipelineId}` | authenticated | Get full pipeline config |
| `PUT` | `/pipelines/{pipelineId}` | writer | Update pipeline config |
| `DELETE` | `/pipelines/{pipelineId}` | writer | Soft-delete pipeline |
| `GET` | `/prompts` | authenticated | List prompts (paginated) |
| `POST` | `/prompts` | writer | Create prompt |
| `GET` | `/prompts/{promptKey}` | authenticated | Get current prompt version |
| `PUT` | `/prompts/{promptKey}` | writer | Update prompt (creates new version) |
| `DELETE` | `/prompts/{promptKey}` | writer | Soft-delete prompt (sets `active: false`; HTTP 422 if referenced by any active pipeline) |
| `GET` | `/prompts/{promptKey}/versions` | authenticated | List all version records |

`POST /generate-functional-tests` is extended in a backward-compatible way — see Backward Compatibility section.

### Request/Response shapes

**POST /pipelines**
```
Request:  { name, steps: PipelineStep[], maxSteps?: number, maxAgeMinutes?: number }
Response: { pipelineId, version: 1, createdAt }   HTTP 201
          { error: string }                         HTTP 422 (validation failure)
```

**PUT /pipelines/{pipelineId}**
```
Request:  { name?, steps?, maxSteps?, maxAgeMinutes?, active? }
Response: { pipelineId, version: N+1, updatedAt }  HTTP 200
          { error: string }                          HTTP 422 | 409
```

**GET /pipelines**
```
Response: { items: [{ pipelineId, name, stepCount, active, version, updatedAt }],
            nextToken?: string }
```

**POST /prompts**
```
Request:  { promptKey, body: string }
Response: { promptKey, currentVersion: 1, createdAt }  HTTP 201
```

**PUT /prompts/{promptKey}**
```
Request:  { body: string }
Response: { promptKey, currentVersion: N+1, updatedAt }  HTTP 200
```

**GET /prompts**
```
Response: { items: [{ promptKey, currentVersion, updatedAt, usedByPipelines: string[] }],
            nextToken?: string }
```
`usedByPipelines` is derived by scanning pipeline items referencing the promptKey (at list time, best-effort).

**GET /generate-functional-tests (extended)**
```
Request (new path):    { pipelineId: string }
Request (legacy path): { promptVersion?: string }
Response:              { runId }  HTTP 202
```

### Writer-route enforcement

`packages/functions/src/authorizer.ts` `WRITER_ROUTES` Set is extended with:
- `POST /pipelines`
- `PUT /pipelines/{pipelineId}`
- `DELETE /pipelines/{pipelineId}`
- `POST /prompts`
- `PUT /prompts/{promptKey}`
- `DELETE /prompts/{promptKey}`

The existing authorizer logic returns 403 when a non-writer token calls any route in this Set.

---

## Execution Flow

End-to-end trace for a 3-step pipeline run:

1. **Client** calls `POST /generate-functional-tests { pipelineId: "abc" }`.
2. **Handler** (`functional-gen.ts`): detects `pipelineId`, reads `PIPELINE#abc` from DDB, validates `active: true`, generates `runId = UUID()`, writes `PRUN#<runId> / PRUN` with `status: 'running'`, `startedAt`, `pipelineConfigVersion` snapshot. Dispatches step Lambda with `{ runId, stepIndex: 0 }` via `InvocationType: 'Event'`. Returns HTTP 202 `{ runId }`.
3. **Step Lambda — Step 0:**
   a. Reads `PRUN#<runId> / PRUN` + `PIPELINE#abc / PIPELINE` (verifies `pipelineConfigVersion` matches).
   b. Writes `PRUN#<runId> / STEP#00` with `status: 'running'`, `leaseExpiresAt = now + 5min`.
   c. Computes cache key SHA-256 over `{ inputHash, pipelineId, pipelineConfigVersion, stepId, promptKey, promptVersion }`.
   d. Checks DDB for existing cache entry — miss.
   e. Fetches `PRMPT#<promptKey>` body (inline or S3).
   f. Calls `buildFunctionalInputs()` to assemble grounded context. Constructs `GroundedContext` with `priorOutputs: []` (empty — step 0).
   g. Calls `createBedrockClient(model, region, promptVersion, promptBody).synthesizePlan(groundedContext)`. On Bedrock throttle: extends `leaseExpiresAt` and retries. On terminal error: marks step `failed`, marks run `failed` (if non-optional), halts.
   h. Writes output to S3 (`pipeline-outputs/<runId>/00.json`) or inline if ≤ 64 KB.
   i. Writes cache entry to DDB.
   j. Updates `STEP#00`: `status: 'completed'`, clears `leaseExpiresAt`, sets `outputRef`, `contextTokenEstimate`, `outputTokens`, `completedAt`.
   k. Checks `(now - startedAt) > maxAgeMinutes` and `executedSteps + 1 <= maxSteps` guards.
   l. Dispatches `{ runId, stepIndex: 1 }` via `InvocationType: 'Event'`, increments `executedSteps` on PRUN record.
4. **Step Lambda — Step 1:** Same flow. `priorOutputs` = `[{ stepId: 's0', label: '...', output: '<step 0 raw string>' }]`.
5. **Step Lambda — Step 2 (final):**
   a–l. Same flow with `priorOutputs` containing steps 0 and 1 outputs.
   m. No further step to dispatch. Updates `PRUN` record: `status: 'completed'`, `completedAt`.
6. **Client polls** `GET /runs/<runId>` → read Lambda returns `{ status: 'completed', steps: [...] }`.

---

## Step Lambda Design

### Single reusable Lambda

One Lambda function (`step-worker`) is invoked for all steps in all pipelines. The routing envelope `{ runId, stepIndex }` is the entire event payload.

**Why a single Lambda:** One IAM construct, one Function definition in SST, one deployment artifact. Per-step Lambdas would require dynamic provisioning or a Lambda per pipeline, both of which add significant complexity. Step routing via the envelope is trivial.

**Handler entry point** (in `packages/functions/src/pipeline.ts`):
```
export const stepWorker = async (event: { runId: string; stepIndex: number }) => { ... }
```

### System constants

`SYSTEM_MAX_RUN_AGE_MINUTES = 5` — a module-level constant in `packages/functions/src/pipeline.ts`. This is a hard circuit-breaker cap distinct from the per-pipeline `maxAgeMinutes`. It is not configurable.

### Execution sequence within the step Lambda

```
0. Absolute first check: if (now - run.startedAt) > SYSTEM_MAX_RUN_AGE_MINUTES * 60_000
      → mark PRUN timed_out, halt (no lease write, no Bedrock call) (R-46)
1. Read PRUN record (verifies pipeline still active, captures pipelineConfigVersion)
2. Read pipeline config (PIPELINE#<id>); resolve step at stepIndex
3. If waitForHuman: true → log warning, continue as if false (R-14)
4. Write STEP#<stepIndex> { status: 'running', leaseExpiresAt: now + leaseDuration }
5. Compute cacheKey
6. DDB cache lookup → if hit: use cached output, status: 'cached', skip to step 11
7. Fetch prompt body (PRMPTVER or inline on PRMPT)
8. Assemble GroundedContext (buildFunctionalInputs) + priorOutputs from completed prior steps
9. computeContextTokenEstimate (character heuristic)
10. Internal retry loop (transient errors extend leaseExpiresAt each attempt):
      record bedrockCallStart = Date.now()
      call createBedrockClient(...).synthesizePlan(groundedContext)
      record bedrockLatencyMs = Date.now() - bedrockCallStart
      on throttle/network error: extend lease, wait backoff, retry
      on terminal error: break → record sanitized errorMessage + errorStack → mark step failed → propagate
11. Write output (S3 if >64KB, else inline DDB field on step record)
12. Write cache entry (conditional PutItem, attribute_not_exists guard)
13. Compute costEstimateUsd = (inputTokens × inputPrice + outputTokens × outputPrice) from SYSCONFIG pricing map
14. Update step record: status, outputRef, durationMs, bedrockLatencyMs, inputTokens, outputTokens, inputCharacters, outputCharacters, contextTokenEstimate, costEstimateUsd, completedAt, clear leaseExpiresAt
15. Age check: (now - run.startedAt) > maxAgeMinutes → mark PRUN timed_out, halt
16. Step count check: executedSteps + 1 > maxSteps → mark PRUN timed_out, halt
17. If stepIndex + 1 >= totalSteps: mark PRUN completed, halt
18. Increment PRUN.executedSteps
19. Dispatch { runId, stepIndex + 1 } via InvocationType: 'Event'
```

### Error handling

| Error type | Classification | Action |
|---|---|---|
| Bedrock `ThrottlingException` | Transient | Extend lease, exponential backoff, retry |
| Bedrock `ServiceUnavailableException` | Transient | Same |
| Network timeout | Transient | Same |
| Bedrock `ValidationException` (bad prompt) | Terminal | Break retry loop |
| Missing prompt / config | Terminal | Break retry loop |
| Retries exhausted | Terminal (reclassified) | Write step `failed`; if non-optional, write run `failed`; if optional, write step `warning`, continue chain |
| Lambda process kill / OOM (uncaught) | Detected lazily | Lease expires; next `GET /runs/{runId}` detects and marks run `timed_out` |

### AWS retry behavior

`stepLambda.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.hours(2) })` is set in `stacks/ApiStack.ts`. This prevents AWS from re-invoking the step Lambda after an unhandled failure — which would otherwise replay a partially-written step record, corrupting pipeline state. All retry logic is owned internally by the step Lambda (R-21a, D-8).

---

## Context Construction

Context assembly follows R-12 and extends the existing `GroundedContext` type.

### Extended `GroundedContext`

```typescript
// packages/functest/src/llm.ts (additive change)
interface GroundedContext {
  // ... existing fields (contracts, requirements, apiMap, etc.) ...
  priorOutputs?: Array<{
    stepId: string;
    label: string;
    output: string;   // raw string from prior step
  }>;
}
```

`priorOutputs` is `undefined` in all existing callers — the single-step `runFunctionalJob` path passes no `priorOutputs` and the field is absent from its constructed context object. The `synthesizePlan` implementation must handle `undefined` as an empty array. This is a backward-compatible additive change.

### Per-step assembly

```
Step 0:  priorOutputs = []
Step 1:  priorOutputs = [{ stepId: step0.stepId, label: step0.label, output: readOutput(step0.outputRef) }]
Step N:  priorOutputs = completed steps 0..N-1 (in order)
```

When `includeContext: false` on the step config, `priorOutputs` is set to `[]` regardless of prior outputs available (R-12).

### Token estimation

`contextTokenEstimate` is computed as `Math.ceil(JSON.stringify(groundedContext).length / 4)`. This is a heuristic (~4 characters per token) stored for observability. It is not used for any threshold logic in v1 (R-13). The `outputTokens` field is read directly from the Bedrock response `usage.output_tokens`.

---

## Caching

### Cache key construction

```typescript
const cacheKey = createHash('sha256').update(JSON.stringify({
  inputHash,             // SHA-256 of the serialized grounded context (contracts + requirements)
  pipelineId,
  pipelineConfigVersion, // bust on any pipeline config change (R-30)
  stepId,
  promptKey,
  promptVersion,         // bust on prompt update (R-29)
})).digest('hex');
```

`inputHash` is reused from the existing `PlanCache` computation in `packages/functest/src/ground.ts`. This means a step with identical inputs, prompt, and pipeline version will hit the cache regardless of which `runId` requested it.

### Cache hit/miss flow

**Miss:** Proceed with LLM call → after writing output → write cache entry:
```
PutItem(pk: STEPCACHE#<cacheKey>, sk: CACHE, outputRef, createdAt)
condition: attribute_not_exists(pk)   ← concurrent dedup guard
```
If `ConditionalCheckFailedException` is thrown (two concurrent step Lambdas raced), the second Lambda reads the existing entry and uses it — no double-write, no double LLM call.

**Hit:** Read `outputRef` from existing cache item, skip LLM call, mark step `status: 'cached'` (R-28).

### Cache storage

Cache entries are stored as their own DDB item type (`STEPCACHE`). They reference `outputRef` pointing to S3 or an inline value. Cache entries are not expired in v1 (follow-on: TTL-based eviction).

---

## Lease / Timeout Model

### Lease lifecycle

```
Step Lambda starts    → write leaseExpiresAt = now + 5min on STEP record
Transient error       → extend leaseExpiresAt = now + 5min before each retry (R-21a, R-24)
Step completes        → clear leaseExpiresAt (set to null) on STEP record (R-19)
Step fails (terminal) → clear leaseExpiresAt (step record gets final status)
Lambda crash/OOM      → leaseExpiresAt goes unrenewed, expires naturally
```

`leaseDuration` is a module-level constant (5 minutes) in `packages/functions/src/pipeline.ts`. Making it configurable per step is a follow-on.

### Lazy expiry detection

The read Lambda (`GET /runs/{runId}`) implements the following check when `run.status` is a non-terminal value (`running`):

```
1. Query all STEP#* items for the runId in the same DDB request as the PRUN item
2. For each step where leaseExpiresAt is set:
     if leaseExpiresAt < now AND run is non-terminal:
       conditional UpdateItem: set run status = 'timed_out', completedAt = now
       condition: status IN ('running')   ← idempotent; second read won't re-transition (TS-17b)
3. Return the updated run record
```

The extra DDB write adds at most one conditional `UpdateItem` to the read path — expected to be well under the 50 ms NFR budget. No scheduled watchdog Lambda is provisioned (R-26-loop).

### Age-based timeout

The step Lambda checks wall-clock age before dispatching the next step (R-23):
```typescript
if (Date.now() - new Date(run.startedAt).getTime() > run.maxAgeMinutes * 60_000) {
  // mark PRUN timed_out, halt
}
```
This prevents runaway chains from consuming Lambda invocations indefinitely.

---

## Backward Compatibility

`POST /generate-functional-tests` currently accepts `{ promptVersion?: string }`. The extended handler in `functional-gen.ts` uses the following dispatch logic:

```typescript
if (body.pipelineId) {
  // New path: create PRUN record, dispatch step Lambda
} else {
  // Legacy path: existing FJOB flow unchanged
}
```

The legacy `FJOB` path is not modified. Existing callers with no `pipelineId` field continue to work as before. Deprecation of the legacy path is a confirmed follow-on.

---

## Sampling and Execution Mode

### Configuration resolution

Sampling config is resolved in two layers:

1. **Pipeline default** (`PIPELINE` item fields `defaultSampling` and `defaultMode`): set when the pipeline is created or updated; applies to every run unless overridden.
2. **Run request override** (`POST /generate-functional-tests` body fields `sampling` and `mode`): per-request; merged on top of the pipeline default. If either field is present on the request it fully replaces the corresponding pipeline default for that run.

The resolved values are written to the `PRUN` record as `sampling`, `mode`, and `requirementIds` (the list of requirement IDs selected after applying the strategy).

### per_requirement mode (R-48)

The `POST /generate-functional-tests` handler applies sampling to obtain `N` requirement IDs, then calls itself or dispatches `N` independent step chain invocations — one per selected requirement:

- Creates `N` `PRUN` records, each with its own `runId` and a `requirementIds` of exactly one entry.
- Dispatches `N` Step 0 Lambda invocations asynchronously (`InvocationType: 'Event'`).
- Returns `HTTP 202 { runIds: string[] }` — an array with `N` entries.

Each run is fully independent: separate lease tracking, separate caching, separate failure domain.

### batch mode (R-49)

The handler applies sampling to obtain `M` requirement IDs, then creates a **single** `PRUN` record:

- `requirementIds` contains all `M` selected IDs.
- All `M` requirements are injected into `GroundedContext` together (extending `buildFunctionalInputs` to accept a multi-requirement context).
- Dispatches a single Step 0 Lambda invocation.
- Returns `HTTP 202 { runId: string }` — single entry.

### Sampling strategy implementations

| Strategy | Implementation |
|---|---|
| `first_n` | Sort requirement IDs lexicographically; take first `n` |
| `percentage` | For each requirement ID: `SHA-256(reqId) % 100 < percentage` — deterministic, same set on every call with the same percentage |
| `ids` | Filter requirement list to those whose ID is in `ids` array; preserve sorted order |
| `all` | No filter; all requirements included |

---

## SPA Design

### New pages

Two new top-level pages added to `packages/web/src/pages/`:

**PipelinesPage.tsx**
- List view: table of active pipelines (name, step count, last modified). "New Pipeline" button visible to writers only (R-38, R-44).
- Detail/editor panel: ordered step list. Each step shows its label, model, and the **linked prompt body** (current version text, fetched via `GET /prompts/{promptKey}`). Writers can: view the full current prompt text inline, open a "New Prompt" sub-form without leaving the editor, swap the step's `promptKey` via a dropdown. Controls to add, reorder, and remove steps (writers only) (R-39).
- Save calls `PUT /pipelines/{pipelineId}`. HTTP 422 response body displayed as an inline error banner; form stays open (R-40, TS-26).

**PromptsPage.tsx** (Prompts archive — R-53)
- List view: table of **active** prompts (promptKey, current version, last-modified). Soft-deleted prompts excluded.
- Detail panel: version history list (version number, `createdAt` per version; body diff out of scope v1) (R-42).
- Editor panel: textarea pre-filled with current body; save calls `PUT /prompts/{promptKey}`; on success, displayed version number updates (R-43).
- Soft-delete via `DELETE /prompts/{promptKey}` sets `active: false`; SPA removes the prompt from the list without a page reload.
- All write controls hidden for non-writers (R-44).

**RunDetailPage.tsx** (new — R-54)
- Visual step flow: ordered list of step cards, each showing step label and a status badge (`running` / `completed` / `cached` / `failed` / `warning`).
- Expand/click a step card to reveal: input context summary (character count + first N characters), raw output string, and metrics panel (`durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `costEstimateUsd`, `inputCharacters`, `outputCharacters`).
- If step failed: sanitized `errorMessage` and `errorStack` shown in a collapsible error block.
- Polling: while run is non-terminal, page polls `GET /runs/{runId}` on 5-second interval (same pattern as ExperimentsPage); updates step status badges in place; stops on terminal state.
- Route: `/pipelines/{pipelineId}/runs/{runId}` added to `AppRoutes.tsx`.

### TanStack Query

`@tanstack/react-query` is introduced for the new Pipeline and Prompt pages only. Existing pages (`ExperimentsPage`, `CrawlsPage`, etc.) retain their current raw-fetch approach.

Rationale: Pipeline CRUD involves three entity types with cross-invalidation (editing a pipeline invalidates the pipeline list and the prompts list if `usedByPipelines` is shown). TanStack Query's `queryKey` invalidation on mutation is cleaner than the `setFetchCount(n => n+1)` pattern used in existing pages. Adding TQ only to new pages avoids a risky migration of existing pages.

QueryKey structure:
```
['pipelines']                          — pipeline list
['pipelines', pipelineId]              — single pipeline
['pipelines', pipelineId, 'runs', runId] — single pipeline run (RunDetailPage)
['prompts']                            — prompt list
['prompts', promptKey]                 — single prompt
['prompts', promptKey, 'versions']     — version history
['modelAllowlist']                     — fetched once on PipelinesPage mount
```

### Run status polling

Pipeline runs appear as a new entry type on the existing run-history list. Status polling for a pipeline run reuses the `ExperimentsPage` polling pattern: 5-second interval, `clearInterval` on unmount, stops when run reaches a terminal status.

### Routing

New routes added to `packages/web/src/AppRoutes.tsx`:
```
/pipelines                              → PipelinesPage
/prompts                                → PromptsPage
/pipelines/:pipelineId/runs/:runId      → RunDetailPage
```

Both routes require authentication (existing auth guard). The sidebar navigation (added in SPA UX redesign) links to these pages; links are visible to all authenticated users; writer-only controls are conditionally rendered within the page using `isWriter(token)` from `packages/web/src/lib.ts`.

---

## SST / CDK Changes

All changes in `stacks/ApiStack.ts`.

### New step worker Function

```typescript
const stepWorkerFn = new Function(stack, 'StepWorkerFunction', {
  handler: 'packages/functions/src/pipeline.stepWorker',
  timeout: '15 minutes',
  memorySize: '1024 MB',
  environment: {
    REGISTRY_TABLE_NAME: table.tableName,
    ARTIFACTS_BUCKET_NAME: artifactsBucket.bucketName,
    STEP_WORKER_FUNCTION_NAME: '{{resolve}}',  // self-reference via SST binding
  },
  permissions: [
    table,
    artifactsBucket,
    new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }),
    new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [stepWorkerFn.functionArn],  // self-invocation
    }),
  ],
});

stepWorkerFn.configureAsyncInvoke({
  retryAttempts: 0,
  maxEventAge: Duration.hours(2),
});

stepWorkerFn.addDependency(seeder);
```

### New API routes

```typescript
api.addRoutes(stack, {
  'GET /pipelines':                 'packages/functions/src/pipeline.listPipelines',
  'POST /pipelines':                'packages/functions/src/pipeline.createPipeline',
  'GET /pipelines/{id}':            'packages/functions/src/pipeline.getPipeline',
  'PUT /pipelines/{id}':            'packages/functions/src/pipeline.updatePipeline',
  'DELETE /pipelines/{id}':         'packages/functions/src/pipeline.deletePipeline',
  'GET /prompts':                   'packages/functions/src/pipeline.listPrompts',
  'POST /prompts':                  'packages/functions/src/pipeline.createPrompt',
  'GET /prompts/{key}':             'packages/functions/src/pipeline.getPrompt',
  'PUT /prompts/{key}':             'packages/functions/src/pipeline.updatePrompt',
  'GET /prompts/{key}/versions':    'packages/functions/src/pipeline.listPromptVersions',
});
```

### Seeder additions

The seeder Lambda (`stacks/`) is extended to write:
1. `SYSCONFIG / MODEL_ALLOWLIST` with the default set of Bedrock model IDs (`us.anthropic.claude-sonnet-4-6`, `us.anthropic.claude-haiku-4-5`, etc.) if not already present.
2. One seed prompt (`PRMPT#functional-test-gen-default`) containing the prompt text currently hardcoded in `packages/functest/src/prompt.ts`, if not already present. This allows immediate use of the new pipeline path without a manual prompt create.

---

## Integration Boundaries

These are the cross-component handoff points that require integration tests:

| Boundary | Test condition |
|---|---|
| HTTP handler → DDB (PRUN write) | After POST /generate-functional-tests, PRUN item exists with status `running` |
| HTTP handler → step Lambda (async dispatch) | Step Lambda is invoked with correct `{ runId, stepIndex: 0 }` |
| Step Lambda → DDB (lease write) | Before LLM call, STEP item has `leaseExpiresAt` set |
| Step Lambda → Bedrock | `synthesizePlan` called with correct model ID and assembled context |
| Step Lambda → S3 (output write) | After LLM call, output readable from returned `outputRef` |
| Step Lambda → DDB (cache write) | Cache entry exists after first run; second run with identical inputs hits cache |
| Step Lambda → step Lambda (async dispatch) | Next step Lambda invoked with `stepIndex + 1` |
| Step Lambda (final) → DDB (run completion) | PRUN status transitions to `completed` |
| Read Lambda → DDB (lease expiry check) | GET /runs returns `timed_out` when lease is expired |
| Prompt write → cache invalidation | After PUT /prompts, cache key for dependent steps no longer matches |

---

## Failure Modes

| Boundary | Failure | Handling |
|---|---|---|
| POST /generate-functional-tests | `pipelineId` not found or `active: false` | HTTP 422, no DDB write |
| POST /generate-functional-tests | DDB write fails | HTTP 500, no async dispatch |
| Step Lambda dispatched | Lambda cold start > 10s | Within normal Lambda behaviour; lease is not yet written, so no false expiry |
| Step Lambda → DDB (lease write fails) | Unhandled exception before lease is written | Lambda exits, no lease set; next GET /runs sees no lease and run remains `running` indefinitely until `maxAgeMinutes` expires via wall-clock check |
| Step Lambda → Bedrock throttle | Retryable | Re-lease and retry with backoff |
| Step Lambda → Bedrock terminal | Non-retryable | Mark step failed; propagate to run if non-optional |
| Step Lambda writes output, crashes before updating step record | Idempotent because cache key dedup prevents double LLM call on retry; but AWS retry is disabled (`retryAttempts: 0`), so this is a terminal failure detected lazily |
| Two step Lambdas race on same step | Cache conditional write (`attribute_not_exists`) — second writer catches `ConditionalCheckFailedException`, reads existing output |
| Read Lambda (lease expiry) → DDB UpdateItem fails | Conditional update may fail if another process already transitioned — idempotent, silently ignored; status returned is whatever is now in DDB |
| Prompt body > 64 KB | DDB item size exceeded | S3 path triggered automatically by size check before write |
| DELETE /pipelines with active run | HTTP 409 returned; no `active: false` write |

---

## Risks and Unknowns

- **Self-invocation IAM**: The step Lambda needs `lambda:InvokeFunction` on its own ARN. SST v2 does not have a built-in helper for this — the ARN must be resolved post-synthesis and added via an explicit `PolicyStatement`. Verify at stack synth time.
- **Step Lambda timeout**: Each step Lambda has a 15-minute timeout. A pipeline with `maxSteps: 20` can technically run for 5 hours in the worst case (all steps sequential, each hitting the timeout). `maxAgeMinutes` on the pipeline config is the primary safety valve — ensure the default value (60 min) is communicated to pipeline authors.
- **`contextTokenEstimate` accuracy**: The character-heuristic (÷4) will underestimate for non-ASCII content in contracts. This is acceptable for v1 observability; a more accurate tokenizer can be added later.
- **`usedByPipelines` on `GET /prompts`**: Computing which pipelines reference a prompt requires scanning all pipeline items. For small catalogs this is fine; for large catalogs a secondary index or denormalized field may be needed. Mark as best-effort in v1.
- **TanStack Query version**: Must be compatible with React 18. `@tanstack/react-query@5.x` requires React 18 — confirm exact version at install time.

---

## Out of Scope / Follow-ons

Confirmed items not implemented in this feature (from requirements §2):

- DAG / parallel independent steps — `dependsOn` field is reserved in the schema but not evaluated
- SQS or Step Functions as execution substrate
- Per-pipeline SQS queues
- Step-level retry without restarting from the beginning
- Multi-step fan-out across requirements (see `parallel-llm-generation` stub)
- Version diffing in the SPA prompt editor
- Non-LLM pipeline steps (compile checks, code execution, etc.)
- `waitForHuman: true` gate implementation — field is schema-reserved, treated as no-op in v1; `POST /runs/{runId}/steps/{stepId}/approve` route is not provisioned
- Deprecation of the legacy `FJOB` path on `POST /generate-functional-tests`
- Configurable per-step lease duration
- Cache TTL-based eviction for `STEPCACHE` items
- Model allowlist management API route (allowlist is updated via direct DDB write in v1)

---

## Decisions Log

**D-1 through D-8** are carried forward from `requirements.md` decisions log. Design-phase additions:

---

**D-9 — Single step Lambda with routing envelope, not one Lambda per step.**
- **Decision:** One function named `step-worker`; event payload is `{ runId, stepIndex }`. The Lambda reads pipeline config from DDB on each invocation to resolve the step.
- **Reason:** One IAM construct, one deployment artifact, no dynamic Lambda provisioning. Per-step Lambdas would require a Lambda per pipeline config, which defeats runtime configurability.
- **Affects:** R-17, R-18, R-19, R-21, R-22, R-23

---

**D-10 — `retryAttempts: 0` on the step Lambda async invocation configuration.**
- **Decision:** `stepLambda.configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.hours(2) })`.
- **Reason:** Default AWS async retry of 2 would cause a step Lambda to run up to 3 times after an unhandled failure. Since each invocation writes DDB state (lease, output, cache entry), multiple retries corrupt the step record with conflicting writes. All retry logic is owned internally (R-21a, D-8). AWS retries must be disabled.
- **Affects:** R-17, R-21, R-24

---

**D-11 — `PRMPT#` and `PRMPTVER#` prefixes (not `PROMPT#` or `PROMPTVER#`).**
- **Decision:** Prompt header items use PK `PRMPT#<promptKey>`; version records use `PRMPTVER#<promptKey>#<version>`.
- **Reason:** Existing `PromptVersionRecord` items already use `PROMPT#<promptVersion>` as PK (e.g. `PROMPT#v1`). Using `PROMPT#` for new items would create key collisions and corrupt reads. `PRMPT` is visually distinct, unambiguous, and avoids a migration.
- **Affects:** R-31, R-32

---

**D-12 — Extend `GroundedContext` with optional `priorOutputs?` field.**
- **Decision:** Add `priorOutputs?: Array<{ stepId: string; label: string; output: string }>` to the `GroundedContext` interface. Existing callers pass no `priorOutputs` (field is absent); `synthesizePlan` treats `undefined` as empty array.
- **Reason:** Avoids creating a separate context type and a parallel `synthesizePlan` overload. Additive change is backward-compatible with the existing single-step flow.
- **Affects:** R-12

---

**D-13 — Backward-compatible dual-path on `POST /generate-functional-tests`.**
- **Decision:** Handler checks for `pipelineId` presence in request body. If present, creates `PRUN` record and dispatches step Lambda. If absent, falls through to existing `FJOB` flow unchanged.
- **Reason:** Zero migration cost for existing callers. Allows incremental adoption of the pipeline path. Legacy path deprecation is a confirmed follow-on.
- **Affects:** R-17

---

**D-14 — TanStack Query introduced for new pages only.**
- **Decision:** `@tanstack/react-query` is added as a dependency and used exclusively in `PipelinesPage.tsx` and `PromptsPage.tsx`. Existing pages are not migrated.
- **Reason:** Pipeline/Prompt CRUD involves three entity types with cross-invalidation — TanStack Query's `queryKey` invalidation on mutation is substantially cleaner than incrementing a fetch counter. Migrating existing pages would be scope creep and risk regressions.
- **Affects:** R-38 through R-44

---

**D-15 — Character heuristic for `contextTokenEstimate`.**
- **Decision:** `contextTokenEstimate = Math.ceil(serializedContext.length / 4)`.
- **Reason:** The Bedrock token counting API is not available via `InvokeModel`; a WASM tokenizer adds significant bundle size. The field is a display hint for v1 observability (R-13), not a decision threshold. Character ÷ 4 is accurate within ±20% for ASCII-dominant content, sufficient for this purpose.
- **Affects:** R-13

---

**D-16 — Model allowlist stored as a DDB system config item (`SYSCONFIG / MODEL_ALLOWLIST`).**
- **Decision:** Allowed Bedrock model IDs are stored in a DDB item, not hardcoded. The item is seeded at deploy time and updatable via direct DDB write in v1 (no API route).
- **Reason:** Enables adding new models without a code change or redeploy (R-10). A management API route is not justified for v1 given the low change frequency.
- **Affects:** R-10

---

**D-17 — Cache entries stored as `STEPCACHE#<cacheKey>` DDB items.**
- **Decision:** Cache entries are their own item type with PK `STEPCACHE#<cacheKey>` / SK `CACHE`. Concurrent writes use conditional `PutItem` with `attribute_not_exists(pk)`.
- **Reason:** Reuses the existing conditional-write dedup pattern already present in `repository.ts`. No additional library needed. The read-winner semantic (losing writer reads the existing entry) is correct for this use case.
- **Affects:** R-27, R-28, R-29, R-30

---

**D-18 — `SYSTEM_MAX_RUN_AGE_MINUTES` is a hard constant (5 min), not configurable, checked first.**
- **Decision:** A module-level constant `SYSTEM_MAX_RUN_AGE_MINUTES = 5` in `packages/functions/src/pipeline.ts`. Checked as the absolute first action in the step Lambda, before any DDB read, lease write, or Bedrock call.
- **Reason:** Circuit breaker against accidental infinite chains during active experimentation. Making it configurable per pipeline would undermine its safety purpose — a misconfigured pipeline could set it very high and exhaust Lambda concurrency. The 5-minute value is deliberately tight; per-pipeline `maxAgeMinutes` covers legitimate long-running pipelines.
- **Affects:** R-46

---

**D-19 — Sampling config lives on pipeline (default) with run-request override.**
- **Decision:** Pipeline item stores `defaultSampling` and `defaultMode`; `POST /generate-functional-tests` accepts optional `sampling` and `mode` overrides that replace the pipeline defaults for that run only.
- **Reason:** Pipeline is self-describing about its intended use (e.g. a pipeline designed for batch synthesis should default to `batch`). Run-request override supports one-off experiments without creating a new pipeline variant. The two-layer merge keeps the common case simple (just run the pipeline) and the experimental case flexible.
- **Affects:** R-45, R-47, R-50

---

**D-20 — per_requirement mode creates N independent PRUN records.**
- **Decision:** For each selected requirement, a distinct `PRUN` record and step chain is created. Response is `{ runIds: string[] }`.
- **Reason:** Independent attribution (each run maps to exactly one requirement), independent failure domains (one requirement failing does not affect others), independent caching (cache key includes the input hash of a single requirement's context). A single multi-requirement PRUN would require complex partial-failure semantics and complicate the read API.
- **Affects:** R-48

---

**D-21 — Cost estimate stored per step using model price table in DDB alongside allowlist.**
- **Decision:** `SYSCONFIG / MODEL_ALLOWLIST` item gains a `pricing` map `{ [modelId]: { inputPricePerMillionTokens, outputPricePerMillionTokens } }`. The step Lambda reads this at execution time and writes `costEstimateUsd` to the step record.
- **Reason:** Avoids hardcoded prices in Lambda code; Bedrock pricing changes without a code release. The price table is in the same DDB item as the allowlist, so no extra read is needed — both are fetched together at the start of each step execution. Per-step storage (rather than per-run aggregation only) enables cost attribution at the step level in the RunDetailPage.
- **Affects:** R-51
