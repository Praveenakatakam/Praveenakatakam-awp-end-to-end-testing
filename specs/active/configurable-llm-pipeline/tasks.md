# Tasks — Configurable LLM Pipeline

## Subagent Plan Summary

- **implementer**: Used for all non-trivial implementation tasks — touches multiple files or requires architectural decisions (pipeline handler, step worker, SST stack changes, SPA pages)
- **test-writer**: All T-nna paired test tasks — writes failing Vitest tests first then verifies they pass after implementation
- **none — single-file trivial change**: T-07 (additive interface extension in one file, no logic beyond adding a field and a null-coalesce)

### Parallelization rationale

- **Phase 1** must complete first: types and key builders are imported by everything else
- **Phase 2**: T-03 must run first (creates `packages/functions/src/pipeline.ts`); once T-03 is done, T-04 and T-05 can run in parallel — prompt CRUD handlers are added to the same file T-03 creates, and authorizer/read extensions touch different files
- **Phase 3** (T-06, T-07) can run in parallel — step Lambda core and GroundedContext extension are independent
- **Phase 4** (T-08) depends on T-06 being done (step worker must exist for the dispatch path)
- **Phase 5** (T-09, T-10) can run in parallel — SST stack and seeder are independent files with no cross-dependency
- **Phase 6** (T-11 through T-15) can start after T-03/T-04 handlers exist (API methods need real endpoint shapes); T-11 through T-14 are parallel; T-15 depends on T-12/T-13/T-14 route targets existing

---

## Phase 1 — Core types and data layer

### T-01: Define shared pipeline types in `packages/core/src/pipeline.ts`
**Subagent:** implementer
**Files:**
- `packages/core/src/pipeline.ts` (create)
- `packages/core/src/index.ts` (modify — re-export new types)
**Requirements:** R-01, R-02, R-11, R-17, R-18, R-19, R-20, R-21a, R-21b, R-27, R-31, R-32, R-45, R-48, R-49, R-51
**Design:** Data Model Changes
**Description:** Create `packages/core/src/pipeline.ts` with all shared TypeScript types — `PipelineConfig`, `PipelineStep`, `PipelineRun`, `StepRecord`, `PromptItem`, `PromptVersionItem`, `ModelAllowlist`, `SamplingConfig`, `ExecutionMode`, `PipelineRunStatus`, `StepStatus` — matching the DDB item shapes in the design exactly, and re-export them from the core package index.
**Acceptance criteria:**
- `PipelineRunStatus` union covers: `running`, `completed`, `completed_with_warnings`, `failed`, `timed_out`
- `StepStatus` union covers: `running`, `completed`, `cached`, `failed`, `warning`
- `PipelineStep` includes all fields from R-02: `stepId`, `label`, `model`, `promptKey`, `optional`, `waitForHuman`, `includeContext`
- `PipelineRun` includes `sampling`, `mode`, `requirementIds`, `executedSteps`, `warnings`, `pipelineConfigVersion` fields from design data model
- `StepRecord` includes all metrics fields from R-51: `durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `inputCharacters`, `outputCharacters`, `contextTokenEstimate`, `costEstimateUsd`, `errorMessage`, `errorStack`
- `PromptItem` uses `PRMPT` prefix (not `PROMPT`) per D-11; includes `active` boolean field (R-52)
- `ModelAllowlist` includes `pricing` map per D-21
- `SamplingConfig` shape covers all four strategies: `first_n`, `percentage`, `ids`, `all` with their respective optional fields
- All types exported from `packages/core/src/index.ts`
- No runtime code — types only (no functions in this task)
**Review checkpoint:** Pause after this task.

### T-01a: Tests for T-01 type structure
**Subagent:** test-writer
**Files:**
- `packages/core/tests/pipeline.test.ts` (create)
**Requirements:** R-01, R-02, R-45
**Design:** Data Model Changes
**Description:** Write compile-time type-guard tests and runtime enum-helper tests for all types added in T-01, verifying status union exhaustiveness and required field presence.
**Acceptance criteria:**
- TypeScript compile-time tests confirm `PipelineRunStatus` and `StepStatus` unions are exhaustive (switch with no default arm compiles)
- Runtime assertions confirm `defaultSampling` defaults shape `{ strategy: "first_n", n: 3 }` is assignable to `SamplingConfig`
- `StepRecord` fixture with all R-51 metric fields passes type check
**Review checkpoint:** Pause after this task.

---

### T-02: Key builders and CRUD helpers for new DDB item types in `packages/functions/src/repository.ts`
**Subagent:** implementer
**Files:**
- `packages/functions/src/repository.ts` (modify)
**Requirements:** R-01, R-17, R-18, R-19, R-27, R-31, R-32
**Design:** Data Model Changes, Caching
**Description:** Add key builder functions (`pipelinePk`, `prunPk`, `stepSk`, `prmptPk`, `prmptverPk`, `stepcachePk`, `sysconfigPk`) and CRUD helper functions for all new item types — pipeline, prun, step, prmpt, prmptver, stepcache, sysconfig — following the existing `fjobPk` / key-builder pattern.
**Acceptance criteria:**
- Key builders use exact PK/SK patterns from design: `PIPELINE#<id>`, `PRUN#<runId>`, `STEP#<zero-padded-index>`, `PRMPT#<key>`, `PRMPTVER#<key>#<version>`, `STEPCACHE#<cacheKey>`, `SYSCONFIG`
- CRUD helpers: `getPipeline`, `putPipeline`, `updatePipeline`, `listPipelines` (via `byKind` GSI), `getPrun`, `putPrun`, `updatePrun`, `listPrunSteps` (Query by PK), `getPrmpt`, `putPrmpt`, `updatePrmpt`, `listPrmpts` (via `byKind` GSI), `getPrmptVer`, `putPrmptVer`, `listPrmptVers`, `getSysconfig`, `getStepcache`, `putStepcacheConditional` (with `attribute_not_exists` guard)
- `putStepcacheConditional` catches `ConditionalCheckFailedException` and returns the existing entry (concurrent dedup guard from design)
- Step record SK uses zero-padded index (e.g. `STEP#00`, `STEP#01`) to preserve sort order
- All helpers accept a `ddb` client parameter for testability (matching existing pattern)
- No changes to existing key builders or helpers
**Review checkpoint:** Pause after this task.

### T-02a: Tests for T-02 key builders and CRUD helpers
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/repository-pipeline.test.ts` (create)
**Requirements:** R-01, R-17, R-27, R-31
**Design:** Data Model Changes, Caching
**Description:** Write offline unit tests for all new key builders and CRUD helpers added in T-02, using the existing DDB mock pattern from the test suite.
**Acceptance criteria:**
- Key builder tests assert correct PK/SK string shapes for all seven new item types
- `putStepcacheConditional` test: when `ConditionalCheckFailedException` is thrown, the helper reads and returns the existing entry rather than propagating the error
- `listPipelines` test asserts `byKind` GSI query uses `kind = "PIPELINE"` filter
- `listPrmpts` test asserts `kind = "PRMPT"` filter and excludes items where `active = false`
- Zero-padding test: `stepSk(0)` → `STEP#00`, `stepSk(9)` → `STEP#09`, `stepSk(10)` → `STEP#10`
**Review checkpoint:** Pause after this task.

---

## Phase 2 — API handlers (T-03 first, then T-04 and T-05 in parallel)

### T-03: Pipeline CRUD handlers in `packages/functions/src/pipeline.ts`
**Subagent:** implementer
**Files:**
- `packages/functions/src/pipeline.ts` (create)
**Requirements:** R-01, R-03, R-04, R-05, R-06, R-07, R-08, R-09, R-10, R-35, R-45, R-52
**Design:** API Surface Changes, Request/Response shapes
**Description:** Create `packages/functions/src/pipeline.ts` with exported Lambda handlers for pipeline CRUD — `listPipelines`, `createPipeline`, `getPipeline`, `updatePipeline`, `deletePipeline` — implementing all validation rules: model allowlist check (R-10), `maxSteps` hard cap of 20 (R-04), steps-vs-maxSteps validation (R-03), `promptKey` existence check against active prompts (R-06, R-52), active-run guard on delete (R-09), and soft-delete via `active: false` (R-08).
**Acceptance criteria:**
- `createPipeline`: sets `version: 1`, `active: true`, `maxSteps: 10` default (R-05), `defaultSampling: { strategy: "first_n", n: 3 }` (R-45), `defaultMode: "per_requirement"` (R-45); returns HTTP 201
- `updatePipeline`: increments `version`, sets `updatedAt` (R-07); returns HTTP 200
- `maxSteps > 20` → HTTP 422 with hard cap message (R-04, TS-03)
- `steps.length > maxSteps` → HTTP 422 (R-03, TS-02)
- Any step `model` not in `SYSCONFIG / MODEL_ALLOWLIST` → HTTP 422 (R-10, TS-06)
- Any step `promptKey` not found or `active: false` → HTTP 422 (R-06, TS-35)
- `deletePipeline` with active run in `running` status → HTTP 409 (R-09, TS-05)
- `deletePipeline` with no active runs → sets `active: false`, HTTP 200 (R-08, TS-04)
- All handlers use `json()` and `notFound()` from `packages/functions/src/http.ts`
- Structured logging via `log` from `packages/functions/src/log.ts`; no raw prompt body in logs
**Review checkpoint:** Pause after this task.

### T-03a: Tests for T-03 pipeline CRUD handlers
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/pipeline-crud.test.ts` (create)
**Requirements:** R-03, R-04, R-05, R-06, R-07, R-08, R-09, R-10, R-45
**Design:** API Surface Changes
**Description:** Write offline unit tests for all pipeline CRUD handlers, covering validation branches and happy paths from the spec's test skeletons (TS-01 through TS-06, TS-27).
**Acceptance criteria:**
- TS-01: POST with valid payload → HTTP 201, item shape has `version: 1`
- TS-02: POST with 6 steps and `maxSteps: 5` → HTTP 422
- TS-03: POST with `maxSteps: 25` → HTTP 422 with hard cap message
- TS-04: DELETE with no active runs → `active: false`, HTTP 200
- TS-05: DELETE with a run in `running` status → HTTP 409
- TS-06: POST with step model not in allowlist → HTTP 422
- TS-23: 15 pipeline items in mocked DDB → `GET /pipelines` with default page size → response body includes `nextToken` pointing to the second page
- TS-27: POST with no `defaultSampling` or `defaultMode` → DDB item has defaults applied
- TS-35: POST with step's `promptKey` pointing to soft-deleted prompt → HTTP 422
**Review checkpoint:** Pause after this task.

---

### T-04: Prompt CRUD handlers in `packages/functions/src/pipeline.ts`
**Depends on:** T-03 (creates the file this task modifies)
**Subagent:** implementer
**Files:**
- `packages/functions/src/pipeline.ts` (modify — add prompt handlers)
**Requirements:** R-31, R-32, R-33, R-34, R-35, R-37, R-52
**Design:** API Surface Changes, Request/Response shapes
**Description:** Add prompt CRUD Lambda handlers to `packages/functions/src/pipeline.ts` — `listPrompts`, `createPrompt`, `getPrompt`, `updatePrompt`, `deletePrompt`, `listPromptVersions` — including 64 KB threshold logic (R-34: body > 64 KB → store in S3, set `s3Ref`), version immutability (R-32: `PUT` creates new version record, increments `currentVersion`), soft-delete with reference check (R-33: version delete blocked if referenced by active step; R-52: `DELETE /prompts/{key}` sets `active: false`).
**Acceptance criteria:**
- `createPrompt`: writes `PRMPT#<key> / PRMPT` with `currentVersion: 1`, `active: true`; also writes `PRMPTVER#<key>#00001 / PRMPTVER`; returns HTTP 201
- `updatePrompt` (`PUT /prompts/{key}`): increments `currentVersion`, writes new `PRMPTVER` record, does NOT overwrite previous version body (R-32); returns HTTP 200 (TS-20)
- Body > 64 KB: stored in S3 under `prompts/<promptKey>/<version>.txt`, `s3Ref` set on DDB item; body field absent from DDB item (R-34)
- `deletePrompt` (`DELETE /prompts/{key}`): sets `active: false` on header item; returns HTTP 200 (TS-34); does NOT delete version records
- `deletePrompt` for a prompt referenced by an active pipeline step → HTTP 422 (R-52)
- `GET /prompts/versions` response: only `PRMPTVER` records with `promptKey` filter; version number and `createdAt` per entry
- `listPrompts`: excludes items where `active: false` (TS-34); includes `usedByPipelines` best-effort field
- Pagination via `nextToken` / `LastEvaluatedKey` on list responses (R-37)
**Review checkpoint:** Pause after this task.

### T-04a: Tests for T-04 prompt CRUD handlers
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/prompt-crud.test.ts` (create)
**Requirements:** R-31, R-32, R-33, R-34, R-52
**Design:** API Surface Changes
**Description:** Write offline unit tests for all prompt CRUD handlers covering version creation, S3 threshold, soft-delete, and reference guard.
**Acceptance criteria:**
- TS-19: After `PUT /prompts/{key}`, `currentVersion` increments and the SHA-256 cache key for a step using that `promptKey` + old `promptVersion` no longer matches the new key (because `promptVersion` changed)
- TS-20: PUT `/prompts/my-prompt` → `currentVersion` increments, new `PRMPTVER` record exists
- TS-21: DELETE version referenced by active pipeline step → HTTP 409
- TS-34: DELETE `/prompts/{key}` → `active: false` on header item; `GET /prompts` list excludes that prompt
- Body exactly 64 KB stays inline; body 64 KB + 1 byte goes to S3 with `s3Ref` set
- `listPrompts` with one soft-deleted and one active prompt → only active appears in response
**Review checkpoint:** Pause after this task.

---

### T-05: Extend authorizer `WRITER_ROUTES` and add GET handlers to `packages/functions/src/read.ts`
**Subagent:** implementer
**Files:**
- `packages/functions/src/authorizer.ts` (modify — extend `WRITER_ROUTES`)
- `packages/functions/src/read.ts` (modify — add GET pipeline/prompt/run handlers and lazy lease-expiry check)
**Requirements:** R-25, R-26-loop, R-35, R-36, R-37
**Design:** Writer-route enforcement, Lazy expiry detection, API Surface Changes
**Description:** Add all new mutation route patterns to `WRITER_ROUTES` in `authorizer.ts`, and add GET handlers in `read.ts` for `/pipelines`, `/pipelines/{id}`, `/prompts`, `/prompts/{key}`, `/prompts/{key}/versions`, and extend the existing `GET /runs/{runId}` handler with the lazy lease-expiry check — on every fetch of a non-terminal run, inspect all `STEP#*` records for expired `leaseExpiresAt` and conditionally transition the run to `timed_out` (R-25, R-26-loop).
**Acceptance criteria:**
- `WRITER_ROUTES` includes all six new mutation patterns: `POST /pipelines`, `PUT /pipelines/{id}`, `DELETE /pipelines/{id}`, `POST /prompts`, `PUT /prompts/{key}`, `DELETE /prompts/{key}`
- `GET /runs/{runId}`: when `run.status` is `running`, queries all `STEP#*` items in the same DDB call; if any step has `leaseExpiresAt < now`, performs conditional `UpdateItem` to set `status: 'timed_out'`, `completedAt: now` with condition `status IN ('running')`; returns updated status (TS-17)
- Idempotent: second fetch of an already-timed-out run does not re-transition (TS-17b)
- Non-terminal → expired-lease detection adds at most one conditional `UpdateItem` to the response path (NFR: ≤50 ms budget)
- GET handlers for pipelines/prompts use the same `json()` / `notFound()` helpers
**Review checkpoint:** Pause after this task.

### T-05a: Tests for T-05 authorizer extension and read handlers
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/authorizer-pipeline.test.ts` (create)
- `packages/functions/tests/read-pipeline.test.ts` (create)
**Requirements:** R-25, R-26-loop, R-35, R-36
**Design:** Writer-route enforcement, Lazy expiry detection
**Description:** Write offline unit tests for the extended authorizer and the lazy lease-expiry check on the read handler.
**Acceptance criteria:**
- TS-22: Non-writer token calling `POST /pipelines` → HTTP 403
- TS-17: `GET /runs/{runId}` with a step whose `leaseExpiresAt` is 10 minutes in the past and `status: 'running'` → response `status: 'timed_out'`, `completedAt` is set
- TS-17b: Same run fetched a second time after the `timed_out` transition → no second conditional update attempted; response is still `timed_out`
- All new mutation routes appear in `WRITER_ROUTES` and return 403 for non-writer tokens
**Review checkpoint:** Pause after this task.

---

## Phase 3 — Step Lambda and context extension (parallel)

### T-06: Step worker core logic in `packages/functions/src/pipeline.ts`
**Subagent:** implementer
**Files:**
- `packages/functions/src/pipeline.ts` (modify — add `stepWorker` export)
**Requirements:** R-12, R-13, R-14, R-15, R-16, R-17, R-18, R-19, R-20, R-21a, R-21b, R-21c, R-22, R-23, R-24, R-27, R-28, R-29, R-46, R-51
**Design:** Step Lambda Design, Execution sequence within the step Lambda, Error handling, Caching, Lease/Timeout Model
**Description:** Implement the exported `stepWorker` Lambda handler in `packages/functions/src/pipeline.ts`, executing the full 19-step sequence from the design: system cap check (R-46) → PRUN/pipeline read → `waitForHuman` warning (R-14) → lease write (R-18) → cache lookup (R-28) → prompt fetch → context assembly with `priorOutputs` (R-12) → `contextTokenEstimate` heuristic → internal retry loop with lease extension on transient errors (R-21a, R-24) → output write (R-19, 64 KB threshold) → cache write with `attribute_not_exists` guard → metrics computation including `costEstimateUsd` (R-51, D-21) → step record update → age/maxSteps guards (R-22, R-23) → terminal dispatch or run completion (R-20).
**Acceptance criteria:**
- `SYSTEM_MAX_RUN_AGE_MINUTES = 5` module constant; checked as absolute first action (R-46, TS-28); no lease written, no Bedrock call if exceeded
- Lease written as `leaseExpiresAt = now + 5 minutes` before Bedrock call (R-18, TS-13)
- Cache hit: step marked `status: 'cached'`, Bedrock not called (R-28, TS-18)
- `includeContext: false`: `priorOutputs` set to `[]` regardless of prior step outputs (R-12, TS-08)
- `includeContext: true`: `priorOutputs` built from all completed prior `STEP#*` records (R-12, TS-07)
- `waitForHuman: true`: warning logged via `log`, execution continues normally (R-14, TS-10)
- Transient errors (Bedrock `ThrottlingException`, `ServiceUnavailableException`, network timeout): `leaseExpiresAt` extended before each retry (R-21a, TS-15b)
- Terminal error on non-optional step: step `status: 'failed'`, run `status: 'failed'`, `failedAt` set, no next step dispatched (R-16, TS-15)
- Terminal error on optional step: step `status: 'warning'`, warning appended to `PRUN.warnings`, next step dispatched (R-15, TS-11)
- All optional steps failing: run `status: 'completed_with_warnings'` (edge case §5)
- `durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `inputCharacters`, `outputCharacters`, `contextTokenEstimate`, `costEstimateUsd` all written to step record on success (R-51, TS-32)
- `errorMessage` and `errorStack` redacted via existing `redact()` utility on failure (R-51, TS-33)
- Output > 64 KB → written to S3 at `pipeline-outputs/<runId>/<stepIndex>.json`; `outputRef: { s3Key }` on step record
- Output ≤ 64 KB → `outputRef: { inline: string }` on step record
- Age check before next dispatch: `(now - startedAt) > maxAgeMinutes` → `timed_out` (R-23, TS-16)
- maxSteps check: `executedSteps + 1 > maxSteps` → `timed_out` (R-22)
- Final step: run marked `completed`, `completedAt` set (R-20, TS-14)
- `configureAsyncInvoke({ retryAttempts: 0 })` is set in stacks (D-10 — noted here, implemented in T-09)
**Review checkpoint:** Pause after this task.

### T-06a: Tests for T-06 step worker
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/step-worker.test.ts` (create)
**Requirements:** R-12, R-14, R-15, R-16, R-18, R-19, R-20, R-21a, R-21b, R-22, R-23, R-28, R-46, R-51
**Design:** Step Lambda Design, Error handling, Caching
**Description:** Write unit tests for the step worker with a stubbed `LlmClient`, covering all execution branches: cache hit, cache miss, transient retry with lease extension, terminal failure (optional and non-optional), `waitForHuman` warning, system cap halt, age-based timeout, and final step completion.
**Acceptance criteria:**
- TS-07: `includeContext: true`, two prior completed steps → context payload contains `priorOutputs` with two entries
- TS-08: `includeContext: false` → context payload has empty `priorOutputs`
- TS-09: Step completes → `contextTokenEstimate` and `outputTokens` set on step record
- TS-10: `waitForHuman: true` → warning logged, step executes normally, run not halted
- TS-11: Optional step terminal error → step `status: 'warning'`, next step invoked
- TS-13: Lease written before LLM call (test asserts DDB write order)
- TS-14: Final step completes → run `status: 'completed'`, `completedAt` set
- TS-15: Non-optional step terminal → run `status: 'failed'`, no further dispatch
- TS-15b: Transient Bedrock throttle → `leaseExpiresAt` extended, run remains `running`
- TS-16: `now - startedAt > maxAgeMinutes` → run `timed_out` before next step dispatch
- TS-18: Cache hit → LLM not called, step `status: 'cached'`
- TS-28: `now - startedAt > SYSTEM_MAX_RUN_AGE_MINUTES * 60_000` → run `timed_out`, no lease written, Bedrock not called
- TS-32: Successful step → all metric fields numeric in step record
- TS-33: Terminal error → `errorMessage` and `errorStack` redacted
**Review checkpoint:** Pause after this task.

---

### T-07: Extend `GroundedContext` with `priorOutputs` in `packages/functest/src/llm.ts`
**Subagent:** none — single additive field on an existing interface plus a null-coalesce in `synthesizePlan`
**Files:**
- `packages/functest/src/llm.ts` (modify)
**Requirements:** R-12
**Design:** Context Construction, Extended GroundedContext
**Description:** Add `priorOutputs?: Array<{ stepId: string; label: string; output: string }>` to the `GroundedContext` interface and update `synthesizePlan` to handle `undefined` as an empty array — backward-compatible with existing callers.
**Acceptance criteria:**
- `GroundedContext` has `priorOutputs?: Array<{ stepId: string; label: string; output: string }>`
- `synthesizePlan` treats `undefined` priorOutputs as `[]` (no existing test changes needed)
- TypeScript strict compilation passes — no new type errors on existing callers
- Existing `functest` unit tests still pass without modification
**Review checkpoint:** Pause after this task.

### T-07a: Tests for T-07 priorOutputs injection
**Subagent:** test-writer
**Files:**
- `packages/functest/tests/prior-outputs.test.ts` (create)
**Requirements:** R-12
**Design:** Context Construction
**Description:** Write tests confirming `synthesizePlan` correctly handles `priorOutputs` presence and absence.
**Acceptance criteria:**
- GIVEN `priorOutputs: undefined` → `synthesizePlan` called with effectively empty prior outputs, no error thrown
- GIVEN `priorOutputs: [{ stepId: "s0", label: "Generate", output: "test output" }]` → output string passed to Bedrock includes prior output content
- Existing `synthesizePlan` callers with no `priorOutputs` field: TypeScript compiles without change
**Review checkpoint:** Pause after this task.

---

## Phase 4 — Sampling, execution mode, and run orchestration

### T-08: Sampling strategies and dual-path dispatch in `packages/functions/src/functional-gen.ts`
**Subagent:** implementer
**Files:**
- `packages/functions/src/functional-gen.ts` (modify)
- `packages/core/src/pipeline.ts` (modify — add sampling strategy helper functions)
**Requirements:** R-17, R-47, R-48, R-49, R-50
**Design:** Sampling and Execution Mode, Backward Compatibility
**Description:** Extend `handleGenerateFunctional` in `functional-gen.ts` to detect `pipelineId` in the request body and branch: if present, resolve sampling config (R-50: run-request override merges over pipeline defaults), apply the sampling strategy to select requirement IDs, then either dispatch N independent PRUN records (per_requirement mode, R-48) or one PRUN record with all selected requirements (batch mode, R-49); if absent, fall through to legacy FJOB path unchanged (D-13).
**Acceptance criteria:**
- `pipelineId` absent → legacy `FJOB` path unchanged (backward compatibility, D-13)
- `pipelineId` present, `active: false` or not found → HTTP 422 (edge case §5)
- Sampling strategies (added to `packages/core/src/pipeline.ts`):
  - `first_n`: sort requirement IDs lexicographically, take first `n`
  - `percentage`: SHA-256 hash of each requirement ID mod 100 < percentage (deterministic, R-48)
  - `ids`: filter to provided IDs, sorted
  - `all`: return all requirement IDs
- `mode: "per_requirement"`: N independent PRUN records created, N Step 0 Lambdas dispatched, response `{ runIds: string[] }` (TS-30)
- `mode: "batch"`: one PRUN record, `requirementIds` contains M selected IDs, one Step 0 Lambda dispatched, response `{ runId: string }` (TS-31)
- Run-request `sampling`/`mode` overrides pipeline `defaultSampling`/`defaultMode` (R-47, R-50, TS-29)
- PRUN record written with resolved `sampling`, `mode`, `requirementIds`, `pipelineConfigVersion` snapshot, `status: 'running'`, `startedAt`
- Returns HTTP 202 (R-17, TS-12)
**Review checkpoint:** Pause after this task.

### T-08a: Tests for T-08 sampling strategies and mode dispatch
**Subagent:** test-writer
**Files:**
- `packages/functions/tests/functional-gen-pipeline.test.ts` (create)
- `packages/core/tests/sampling.test.ts` (create)
**Requirements:** R-47, R-48, R-49, R-50
**Design:** Sampling and Execution Mode
**Description:** Write unit tests for all four sampling strategies (deterministic behavior) and for the per_requirement / batch mode dispatch paths.
**Acceptance criteria:**
- TS-12: POST with valid `pipelineId` → HTTP 202, PRUN record exists with `status: 'running'`
- TS-29: POST with `sampling: { strategy: "all" }` and `mode: "batch"` → PRUN has `sampling.strategy: "all"` and `mode: "batch"`
- TS-30: `mode: "per_requirement"`, `first_n: 2`, 5 requirements → response `{ runIds }` with 2 entries; 2 PRUN records
- TS-31: `mode: "batch"`, `first_n: 2`, 5 requirements → response `{ runId }` single entry; PRUN `requirementIds` has 2 IDs
- `percentage` strategy: same set of IDs selected on repeated calls with identical percentage and requirement list (deterministic SHA-256 hash)
- `ids` strategy: only matching requirement IDs included, sorted
- Legacy path (no `pipelineId`): existing FJOB behavior unchanged
**Review checkpoint:** Pause after this task.

---

## Phase 5 — Infrastructure (parallel)

### T-09: Add step worker Function and new API routes to `stacks/ApiStack.ts`
**Subagent:** implementer
**Files:**
- `stacks/ApiStack.ts` (modify)
**Requirements:** R-17, R-35
**Design:** SST/CDK Changes, New step worker Function, New API routes
**Description:** Add the `StepWorkerFunction` construct with 15-minute timeout, 1024 MB memory, `bedrock:InvokeModel` policy, self-invocation `lambda:InvokeFunction` policy, `configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.hours(2) })`, and `addDependency(seeder)`; add all 10 new API routes for pipeline and prompt CRUD handlers.
**Acceptance criteria:**
- `StepWorkerFunction` has `timeout: '15 minutes'`, `memorySize: '1024 MB'`
- `configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.hours(2) })` configured (D-10)
- Bedrock policy covers `arn:aws:bedrock:*::foundation-model/anthropic.*` and `arn:aws:bedrock:*:*:inference-profile/*`
- Self-invocation policy: `lambda:InvokeFunction` on `stepWorkerFn.functionArn`
- `addDependency(seeder)` called on `StepWorkerFunction`
- All 10 new routes added per design API surface: GET/POST/PUT/DELETE `/pipelines[/{id}]` and GET/POST/PUT/DELETE `/prompts[/{key}[/versions]]`
- `DELETE /prompts/{key}` route added (soft-delete, R-52)
- Stack synthesizes without CDK errors (`pnpm run synth` or equivalent)
**Review checkpoint:** Pause after this task.

### T-09a: Infra tests for T-09
**Subagent:** test-writer
**Files:**
- `stacks/tests/ApiStack.test.ts` (modify)
**Requirements:** R-17, R-35
**Design:** SST/CDK Changes
**Description:** Extend the existing `ApiStack.test.ts` with CDK template assertions covering the new step worker Function and all new API routes.
**Acceptance criteria:**
- Template assertion: `StepWorkerFunction` resource has `Timeout: 900` (15 min in seconds) and `MemorySize: 1024`
- Template assertion: `StepWorkerFunction` IAM role has `bedrock:InvokeModel` action
- Template assertion: `StepWorkerFunction` has `EventInvokeConfig` with `MaximumRetryAttempts: 0`
- Template assertions for at least 6 of the 10 new routes present in the API definition
**Review checkpoint:** Pause after this task.

---

### T-10: Extend seeder Lambda with MODEL_ALLOWLIST and default prompt
**Subagent:** implementer
**Files:**
- `stacks/seeder.ts` (modify — locate and extend the seeder Lambda handler)
**Requirements:** R-10, R-31
**Design:** Seeder additions, Data Model Changes (SYSCONFIG/MODEL_ALLOWLIST)
**Description:** Extend the seeder Lambda to write `SYSCONFIG / MODEL_ALLOWLIST` with default Bedrock model IDs and pricing map if not already present, and to seed `PRMPT#functional-test-gen-default` from the prompt text in `packages/functest/src/prompt.ts` if not already present.
**Acceptance criteria:**
- Seeder writes `SYSCONFIG / MODEL_ALLOWLIST` with `allowedModels` containing at minimum `us.anthropic.claude-sonnet-4-6` and `us.anthropic.claude-haiku-4-5` (or equivalent); uses conditional write (`attribute_not_exists`) so it is idempotent
- `pricing` map on the allowlist item includes `inputPricePerMillionTokens` and `outputPricePerMillionTokens` for each allowed model
- Seeder writes `PRMPT#functional-test-gen-default / PRMPT` with `currentVersion: 1` and prompt body from `packages/functest/src/prompt.ts`; uses conditional write so it is idempotent
- Also writes corresponding `PRMPTVER#functional-test-gen-default#00001 / PRMPTVER` version record
- Both writes are idempotent — re-running the seeder does not overwrite manually-updated items
**Review checkpoint:** Pause after this task.

### T-10a: Tests for T-10 seeder additions
**Subagent:** test-writer
**Files:**
- `stacks/tests/seeder.test.ts` (create, or modify if file exists)
**Requirements:** R-10, R-31
**Design:** Seeder additions
**Description:** Write offline unit tests for the seeder's new writes using a stubbed DDB client.
**Acceptance criteria:**
- `MODEL_ALLOWLIST` written with `attribute_not_exists` condition on first run
- `MODEL_ALLOWLIST` NOT overwritten on second run (idempotent)
- `PRMPT#functional-test-gen-default` written with `currentVersion: 1` on first run
- `PRMPT#functional-test-gen-default` NOT overwritten on second run
- `pricing` map has at least one model entry with `inputPricePerMillionTokens` and `outputPricePerMillionTokens` as numbers
**Review checkpoint:** Pause after this task.

---

## Phase 6 — SPA (parallel sub-tasks)

### T-11: TanStack Query provider and new API client methods
**Subagent:** implementer
**Files:**
- `packages/web/src/main.tsx` (modify — add `QueryClientProvider`)
- `packages/web/src/api.ts` (modify — add new typed methods)
- `package.json` in `packages/web/` (modify — add `@tanstack/react-query@^5`)
**Requirements:** R-35, R-37, R-38, R-39, R-41
**Design:** SPA Design, TanStack Query
**Description:** Install `@tanstack/react-query` (React 18 compatible v5.x), wrap the app root in `QueryClientProvider`, and add typed API methods to `packages/web/src/api.ts` for all new pipeline and prompt endpoints — list, get, create, update, delete, list versions — following the existing `createApi(token)` factory pattern.
**Acceptance criteria:**
- `@tanstack/react-query` v5.x added to `packages/web/package.json`
- `QueryClientProvider` wraps the app root in `main.tsx`; existing pages unaffected
- `createApi(token)` in `api.ts` gains methods: `listPipelines`, `getPipeline`, `createPipeline`, `updatePipeline`, `deletePipeline`, `listPrompts`, `getPrompt`, `createPrompt`, `updatePrompt`, `deletePrompt`, `listPromptVersions`
- All new API methods are typed with request/response shapes matching the design's request/response section
- TypeScript strict compilation passes
**Review checkpoint:** Pause after this task.

### T-11a: Tests for T-11 API client methods
**Subagent:** test-writer
**Files:**
- `packages/web/tests/api-pipeline.test.ts` (create)
**Requirements:** R-35, R-37
**Design:** SPA Design, TanStack Query
**Description:** Write web-tier tests for the new API client methods using stubbed `fetch`.
**Acceptance criteria:**
- `listPipelines` stub test: returns `{ items: [...], nextToken }` shape
- `createPipeline` stub test: sends POST with correct body, returns `{ pipelineId, version: 1 }`
- `updatePipeline` stub test: sends PUT; on 422 response, the error object includes the server's error message
- `deletePrompt` stub test: sends DELETE, receives 200 with `active: false` effect
**Review checkpoint:** Pause after this task.

---

### T-12: `PipelinesPage.tsx` — pipeline list and editor
**Subagent:** implementer
**Files:**
- `packages/web/src/pages/PipelinesPage.tsx` (create)
**Requirements:** R-38, R-39, R-40, R-44
**Design:** SPA Design, New pages (PipelinesPage)
**Description:** Create `PipelinesPage.tsx` with a list view (active pipelines table: name, step count, last modified) and an inline editor panel showing the ordered step list with per-step label, model selector from allowlist, and linked prompt body; writers see "New Pipeline" button and step add/remove/reorder controls; non-writers see read-only view; saves call `PUT /pipelines/{id}` and display inline HTTP 422 error banners.
**Acceptance criteria:**
- List view renders pipeline name, step count, and `updatedAt` per row (R-38)
- "New Pipeline" button visible to writer; hidden to non-writer (R-44, TS-24, TS-25)
- Step editor: each step shows label, model (dropdown populated from allowlist), and current prompt body text (fetched via `GET /prompts/{key}`)
- Writers can view full prompt text inline, open a "New Prompt" sub-form, and swap `promptKey` via dropdown (R-39)
- Save calls `PUT /pipelines/{id}`; HTTP 422 response body displayed as inline error banner, form stays open (R-40, TS-26)
- TanStack Query used for data fetching and mutation (D-14); query keys follow design's `['pipelines']` and `['pipelines', pipelineId]` structure
- TypeScript strict compilation passes; no `any` casts
**Review checkpoint:** Pause after this task.

### T-12a: Web tests for `PipelinesPage`
**Subagent:** test-writer
**Files:**
- `packages/web/tests/PipelinesPage.test.tsx` (create)
**Requirements:** R-38, R-40, R-44
**Design:** SPA Design
**Description:** Write jsdom web tests for `PipelinesPage` covering writer vs. non-writer rendering and the 422 error banner.
**Acceptance criteria:**
- TS-24: Writer session → "New Pipeline" button present in DOM
- TS-25: Non-writer session → "New Pipeline" button absent; no edit controls visible
- TS-26: `PUT /pipelines/{id}` returns 422 → inline error message rendered, form still open
- Pipeline list items render name and step count from mocked API response
**Review checkpoint:** Pause after this task.

---

### T-13: `PromptsPage.tsx` — prompts archive and version history
**Subagent:** implementer
**Files:**
- `packages/web/src/pages/PromptsPage.tsx` (create)
**Requirements:** R-41, R-42, R-43, R-44, R-52, R-53
**Design:** SPA Design, New pages (PromptsPage)
**Description:** Create `PromptsPage.tsx` with a list of active prompts (promptKey, current version, last-modified), a detail panel showing version history (version number, `createdAt`; no body diff in v1), and a textarea editor that saves via `PUT /prompts/{key}` and updates the displayed version number on success; soft-delete via `DELETE /prompts/{key}`; all write controls hidden for non-writers.
**Acceptance criteria:**
- List view: only active prompts shown (soft-deleted excluded, R-52, TS-36)
- Clicking a prompt shows version history list (version number + `createdAt` per version, R-42)
- Save calls `PUT /prompts/{key}`; displayed `currentVersion` updates on success (R-43)
- Soft-delete removes prompt from list without page reload (R-53)
- Write controls (save, delete) hidden for non-writers (R-44)
- TanStack Query used; query keys `['prompts']`, `['prompts', promptKey]`, `['prompts', promptKey, 'versions']`
**Review checkpoint:** Pause after this task.

### T-13a: Web tests for `PromptsPage`
**Subagent:** test-writer
**Files:**
- `packages/web/tests/PromptsPage.test.tsx` (create)
**Requirements:** R-41, R-43, R-52, R-53
**Design:** SPA Design
**Description:** Write jsdom web tests for `PromptsPage` covering list filtering, version update display, and writer/non-writer controls.
**Acceptance criteria:**
- TS-36: Writer session → `/prompts` page lists active prompts; soft-deleted prompts do not appear
- Successful PUT → displayed version number increments in the UI
- Non-writer session → save and delete buttons not rendered
**Review checkpoint:** Pause after this task.

---

### T-14: `RunDetailPage.tsx` — visual step flow with polling
**Subagent:** implementer
**Files:**
- `packages/web/src/pages/RunDetailPage.tsx` (create)
**Requirements:** R-54
**Design:** SPA Design, New pages (RunDetailPage), Run status polling
**Description:** Create `RunDetailPage.tsx` at route `/pipelines/:pipelineId/runs/:runId` showing a visual step flow (ordered step cards with status badges), expandable per-step detail panels (input context summary, raw output, metrics grid, error block), and 5-second polling that stops on terminal state — following the `ExperimentsPage` polling pattern.
**Acceptance criteria:**
- Each step card shows step label and status badge (`running` / `completed` / `cached` / `failed` / `warning`) (R-54)
- Expanding a step shows: input context summary (character count + first N chars), raw output string, metrics panel with `durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `costEstimateUsd`, `inputCharacters`, `outputCharacters` (R-54, TS-37)
- Failed step shows sanitized `errorMessage` and `errorStack` in collapsible error block
- Polls `GET /runs/{runId}` every 5 seconds while run is non-terminal; clears interval on terminal state or unmount (R-54, TS-38)
- TanStack Query used for initial fetch; polling via `refetchInterval` or the `ExperimentsPage` `setInterval` pattern
**Review checkpoint:** Pause after this task.

### T-14a: Web tests for `RunDetailPage`
**Subagent:** test-writer
**Files:**
- `packages/web/tests/RunDetailPage.test.tsx` (create)
**Requirements:** R-54
**Design:** SPA Design
**Description:** Write jsdom web tests for `RunDetailPage` covering step flow rendering, metrics display, and polling behavior.
**Acceptance criteria:**
- TS-37: Completed run with step metrics → expanding step shows `durationMs`, `costEstimateUsd`, `inputTokens`, `outputTokens`
- TS-38: Running run → polling continues; terminal run → polling stops (assert `clearInterval` or `refetchInterval: false`)
- Failed step → `errorMessage` rendered in error block
- `warning` status badge rendered for optional failed step
**Review checkpoint:** Pause after this task.

---

### T-15: Wire new routes into `AppRoutes.tsx` and sidebar navigation
**Subagent:** implementer
**Files:**
- `packages/web/src/AppRoutes.tsx` (modify)
- `packages/web/src/components/Sidebar.tsx` or equivalent sidebar file (modify)
**Requirements:** R-38, R-41, R-53, R-54
**Design:** SPA Design, Routing
**Description:** Add three new routes to `AppRoutes.tsx` — `/pipelines`, `/prompts`, `/pipelines/:pipelineId/runs/:runId` — and add sidebar navigation links for Pipelines and Prompts pages, visible to all authenticated users with writer-only controls handled within the pages.
**Acceptance criteria:**
- `/pipelines` route renders `PipelinesPage`
- `/prompts` route renders `PromptsPage`
- `/pipelines/:pipelineId/runs/:runId` route renders `RunDetailPage`
- All three routes guarded by existing auth guard
- Sidebar shows "Pipelines" and "Prompts" links for authenticated users
- Sidebar links navigate to correct routes (no 404)
**Review checkpoint:** Pause after this task.

### T-15a: Smoke tests for routing
**Subagent:** test-writer
**Files:**
- `packages/web/tests/routing.test.tsx` (create or modify if file exists)
**Requirements:** R-38, R-41, R-54
**Design:** SPA Design, Routing
**Description:** Write smoke tests confirming the three new routes render the correct page component.
**Acceptance criteria:**
- Navigating to `/pipelines` renders `PipelinesPage` (heading or page marker present)
- Navigating to `/prompts` renders `PromptsPage`
- Navigating to `/pipelines/abc/runs/xyz` renders `RunDetailPage`
- Sidebar renders "Pipelines" and "Prompts" links when authenticated
**Review checkpoint:** Pause after this task.

---

## Phase 7 — v0.4.0 amendments (R-55 – R-72)

Two streams run in parallel after T-16: **backend** (T-17 → T-18 → T-19 → T-20, sequential — they share `pipeline.ts` / `functional-gen.ts`) and **web** (T-21 → T-22 → T-23, sequential — they share `Sidebar.tsx` / `api.ts` / page files). Each implementation task ships with its tests in the same task (paired-test convention collapsed for this amendment to keep each stream to one agent).

### T-16: Core types for v0.4.0 ✅
**Subagent:** none — single-file type additions
**Files:** `packages/core/src/pipeline.ts`
**Requirements:** R-57, R-59, R-63, R-65, R-55
**Description:** Add `StepOutputType`, `resolveOutputType()`, optional `PipelineStep.outputType`, `PipelineRun.artifact?`, `StepRecord.priorOutputsTruncated?`, `SkippedRequirement`, and `GeneratePipelineResponse`.
**Acceptance criteria:** types exported from `@registry/core`; offline suite still passes.

### T-17: Grounding-aware sampling + qualified requirement IDs ✅
**Subagent:** implementer (backend stream)
**Files:** `packages/functions/src/functional-gen.ts`, `packages/functions/src/pipeline.ts` (worker requirement lookup), tests in `packages/functions/tests/functional-gen-pipeline.test.ts`, `packages/functions/tests/step-worker.test.ts`
**Requirements:** R-55, R-56, R-57, R-58 · **Tests:** TS-39, TS-40, TS-41, TS-42 (+ existing TS-30/TS-31 updated for `skipped` and qualified IDs)
**Design:** v0.4.0 Amendments › Grounding-aware sampling

### T-18: Step output types, plan schema v2, validation, prior-output budget ✅
**Subagent:** implementer (backend stream)
**Files:** `packages/functest/src/plan.ts`, `packages/functest/src/critique.ts` (create), `packages/functest/src/index.ts`, `packages/functions/src/pipeline.ts`, tests in `packages/functest/tests/`, `packages/functions/tests/step-worker.test.ts`, `packages/functions/tests/pipeline-crud.test.ts`
**Requirements:** R-59, R-60, R-61, R-62, R-63, R-64 · **Tests:** TS-43 – TS-47
**Design:** v0.4.0 Amendments › Step output types
**Acceptance criteria (in addition to TS):** legacy generator tests (`packages/functest/tests/generate.test.ts`) pass unchanged or with fixture updates limited to the new `rationale` field; create/update pipeline returns 422 for an unknown `outputType`.

### T-19: Run artifact emission + emitter v2 + artifact read route ✅
**Subagent:** implementer (backend stream)
**Files:** `packages/functest/src/emit.ts`, `packages/functions/src/pipeline.ts`, `packages/functions/src/read.ts`, `stacks/ApiStack.ts`, tests in `packages/functest/tests/`, `packages/functions/tests/step-worker.test.ts`, `packages/functions/tests/read-pipeline.test.ts`, `stacks/tests/pipeline-infra.test.ts`
**Requirements:** R-65, R-66 · **Tests:** TS-48, TS-49, TS-50
**Design:** v0.4.0 Amendments › Run artifact
**Acceptance criteria:** legacy emitter output for existing fixtures is byte-identical.

### T-20: Legacy prompt import endpoint ✅
**Subagent:** implementer (backend stream)
**Files:** `packages/functions/src/pipeline.ts`, `packages/functions/src/authorizer.ts` (if writer routes are listed), `stacks/ApiStack.ts`, tests in `packages/functions/tests/pipeline-prompt-crud.test.ts`
**Requirements:** R-72 · **Tests:** TS-57

### T-21: Shared SplitPane + StepEditor ✅
**Subagent:** implementer (web stream)
**Files:** `packages/web/src/components/SplitPane.tsx` (create), `packages/web/src/components/StepEditor.tsx` (create), `packages/web/src/pages/PipelinesPage.tsx`, `packages/web/src/pages/PipelinePage.tsx`, `packages/web/src/styles.css`, tests in `packages/web/tests/`
**Requirements:** R-67, R-68 · **Tests:** TS-51, TS-52, TS-53

### T-22: Sidebar regroup (Catalog / Experiments / Legacy) ✅
**Subagent:** implementer (web stream)
**Files:** `packages/web/src/Sidebar.tsx`, `packages/web/src/AppRoutes.tsx`, existing routing/sidebar tests
**Requirements:** R-69 · **Tests:** TS-54

### T-23: Compare runs, skipped display, artifact view, legacy import button ✅
**Subagent:** implementer (web stream)
**Files:** `packages/web/src/pages/RunsComparePage.tsx` (create), `packages/web/src/pages/RunDetailPage.tsx`, `packages/web/src/pages/PromptsPage.tsx`, `packages/web/src/pages/PipelinesPage.tsx`, `packages/web/src/pages/PipelinePage.tsx`, `packages/web/src/api.ts`, `packages/web/src/hooks/usePipelines.ts`, `packages/web/src/lib.ts`, `packages/web/src/AppRoutes.tsx`, tests in `packages/web/tests/`
**Requirements:** R-70, R-71, R-72 (UI) · **Tests:** TS-55, TS-56, TS-57 (UI half)

---

## Phase 8 — v0.5.0 step transparency (R-73 – R-78)

Backend (T-25 → T-26) and web (T-27) run in parallel after T-24; tests ship inside each task.

### T-24: Core types — `StepInputSnapshot`, `StepRecord.inputRef`, `RunStepDetail`
**Subagent:** none — single-file type additions · **Files:** `packages/core/src/pipeline.ts` · **Requirements:** R-74, R-75

### T-25: Output instructions + sectioned user message + input snapshot + seed prompt text
**Subagent:** implementer (backend) · **Files:** `packages/functions/src/output-instructions.ts` (create), `packages/functions/src/pipeline.ts`, `packages/functions/src/prompt-seed.ts`, tests in `packages/functions/tests/` · **Requirements:** R-73, R-74, R-78 · **Tests:** TS-58 – TS-62

### T-26: `GET /runs/{runId}/steps/{stepIndex}`
**Subagent:** implementer (backend) · **Files:** `packages/functions/src/read.ts`, `stacks/ApiStack.ts`, tests in `packages/functions/tests/read-pipeline.test.ts`, `stacks/tests/pipeline-infra.test.ts` · **Requirements:** R-75 · **Tests:** TS-63

### T-27: Run detail step transparency UI
**Subagent:** implementer (web) · **Files:** `packages/web/src/pages/RunDetailPage.tsx`, `packages/web/src/components/step-output/*` (create), `packages/web/src/api.ts`, `packages/web/src/hooks/usePipelines.ts`, `packages/web/src/lib.ts`, `packages/web/src/styles.css`, tests in `packages/web/tests/` · **Requirements:** R-76, R-77 · **Tests:** TS-64 – TS-67
