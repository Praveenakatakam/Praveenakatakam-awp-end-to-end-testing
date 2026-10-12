# Tasks — Prompt Versioning & Experiment Tracking

## Subagent Plan Summary

- `implementer`: All implementation tasks — the codebase is small enough that one agent handles all packages without domain splits.
- `test-writer`: All `T-nna` paired test tasks — writes failing tests first, verifies the right failure reason, then confirms they pass after the implementation task is done.
- `none — reason given inline`: Single-line or trivially obvious changes (authorizer route addition, api.ts method stubs).

---

## Phase 1 — Foundation

Tasks in this phase are independent and can be run in parallel.

### T-01 — Core types and `isValidPromptVersion` helper

**Goal:** Create `packages/core/src/prompt-versioning.ts` with the `isValidPromptVersion` pure helper and the exported types `PromptVersionRecord`, `ExperimentRecord`, and `ExperimentStatus` that all other packages will share.
**Satisfies:** R-01, R-04, R-60
**Deps:** none
**Impacted areas:** `packages/core/src/prompt-versioning.ts` (new)
**Validation:** `isValidPromptVersion` accepts `v1`, `v2-concise`, `a.b_c` and rejects empty string, uppercase, `>64` chars, and special characters outside `[a-z0-9-_.]`. Types are importable from `@registry/core`.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-01a — Tests for T-01

**Goal:** Write unit tests for `isValidPromptVersion` covering all valid and invalid format cases from R-04, and confirm the exported types compile correctly.
**Satisfies:** R-04 acceptance criteria
**Deps:** T-01
**Impacted areas:** `packages/core/tests/prompt-versioning.test.ts` (new)
**Validation:** All tests pass under `vitest run`; edge cases for boundary length (64 chars valid, 65 chars invalid), each disallowed character class, and blank string are covered.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-02 — StorageStack: 90-day lifecycle rule on `experiments/` prefix

**Goal:** Add an S3 lifecycle rule to the existing bucket in `stacks/StorageStack.ts` that expires objects under the `experiments/` prefix after 90 days. No new GSI is required — `byKind` already exists. However, `PROMPT#{}` and `EXP#{}` items must write **both** `createdAt` and `startedAt` (same value) so they sort correctly on the `byKind` GSI's `startedAt` SK. This is enforced in T-04 at the repository layer; T-02 documents the constraint.
**Satisfies:** R-64
**Deps:** none
**Impacted areas:** `stacks/StorageStack.ts`
**Validation:** `vitest run` on `stacks/tests/StorageStack.test.ts` passes; the CDK template assertion confirms a lifecycle rule with `prefix: experiments/` and `expirationInDays: 90`.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-02a — Tests for T-02

**Goal:** Add or update a CDK template assertion in `stacks/tests/StorageStack.test.ts` that verifies the 90-day lifecycle rule exists on the correct prefix.
**Satisfies:** R-64 acceptance criteria
**Deps:** T-02
**Impacted areas:** `stacks/tests/StorageStack.test.ts`
**Validation:** The new assertion fails before T-02 is applied, passes after. Existing assertions remain green.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-03 — ApiStack: `ExperimentWorker` construct, 7 new routes, and PROMPT#v1 seeder

**Goal:** Extend `stacks/ApiStack.ts` to add the `ExperimentWorker` Function construct (async, 15-minute timeout), wire up all 7 new API Gateway routes to their handler entry points, and add an SST `Script` construct (or equivalent deploy hook) that writes the `PROMPT#v1` seed record using a conditional put — idempotent on re-deploy. **Critical:** add an explicit CDK `addDependency` from the seeder Script to the `FunctionalGen` Lambda construct so CloudFormation guarantees the seed runs before the new Lambda code is live. Without this, there is a deploy window where the code requires `PROMPT#v1` in DDB but the seeder has not yet run, causing every `POST /generate-functional-tests` call to return 400.
**Satisfies:** R-20, R-09, R-62, R-63
**Deps:** none (handler file paths are string references; the files may not yet exist)
**Impacted areas:** `stacks/ApiStack.ts`
**Validation:** `vitest run` on `stacks/tests/ApiStack.test.ts` passes; route-count assertion updated; `ExperimentWorker` construct present in synthesised template; seeder Script construct present.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-03a — Tests for T-03

**Goal:** Update `stacks/tests/ApiStack.test.ts` to assert the 7 new routes exist, the `ExperimentWorker` Function construct is present with the correct timeout, and the seeder Script construct is defined.
**Satisfies:** R-09, R-62 acceptance criteria
**Deps:** T-03
**Impacted areas:** `stacks/tests/ApiStack.test.ts`
**Validation:** Updated assertions fail before T-03, pass after. All previously-passing route assertions remain green.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

## Phase 2 — Repository Layer, Auth, and LLM Refactor

Tasks in this phase are independent of each other and can be run in parallel. All depend on Phase 1 being complete.

### T-04 — `repository.ts`: key builders and CRUD helpers for `PROMPT#{}` and `EXP#{}`

**Goal:** Add `promptVersionKey`, `experimentKey` key builders; `putPromptVersion` (conditional put with `attribute_not_exists(PK)`), `getPromptVersion`, `listPromptVersions` (byKind GSI, kind=PROMPT, SK descending), `putExperiment`, `updateExperiment`, `getExperiment`, `listExperiments` (byKind GSI, kind=EXPERIMENT); and `putExperimentArtifact` / `getExperimentArtifact` S3 helpers. **Important:** `putPromptVersion` and `putExperiment` must write both `createdAt` and `startedAt` (set to the same ISO-8601 timestamp) so that these items sort correctly on the `byKind` GSI's `startedAt` sort key — without `startedAt`, DynamoDB will include the items in the GSI but in undefined order, breaking newest-first listing (R-05, R-40).
**Satisfies:** R-01, R-03, R-05, R-06, R-32, R-40, R-41, R-42, R-60, R-61
**Deps:** T-01
**Impacted areas:** `packages/functions/src/repository.ts`
**Validation:** All new helpers are exported and typeable without error. `putPromptVersion` raises `ConditionalCheckFailedException` on duplicate PK. `listPromptVersions` and `listExperiments` use `QueryCommand` with the `byKind` GSI — no `ScanCommand`.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-04a — Tests for T-04

**Goal:** Write unit tests (AWS SDK mocked) for all new repository functions: conditional put conflict path, get-not-found path, list-newest-first sort, S3 artifact put/get, and `updateExperiment` patch semantics.
**Satisfies:** R-03, R-05, R-06, R-32, R-40, R-41, R-42 acceptance criteria
**Deps:** T-04
**Impacted areas:** `packages/functions/tests/repository.test.ts` (additions to existing file)
**Validation:** All new test cases pass. Existing repository tests remain green. No `ScanCommand` appears in any mock call assertion for the two new list functions.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-05 — `authorizer.ts`: add 2 writer routes

**Goal:** Add `'POST /prompt-versions'` and `'POST /experiments'` to the `WRITER_ROUTES` Set in `packages/functions/src/authorizer.ts`.
**Satisfies:** R-07, R-22
**Deps:** none
**Impacted areas:** `packages/functions/src/authorizer.ts`
**Validation:** Existing authorizer unit tests pass. Two new assertions cover that readers receive `403` on both routes.
**Subagent:** none — two-line addition to an existing Set constant; no logic change.
**Review checkpoint:** Pause after this task.

### T-05a — Tests for T-05

**Goal:** Add unit tests asserting that `requiredGroup` / `isAuthorized` returns `403` when a reader token calls `POST /prompt-versions` or `POST /experiments`, and `200` when a writer calls the same routes.
**Satisfies:** R-07, R-22 acceptance criteria
**Deps:** T-05
**Impacted areas:** `packages/functions/tests/authorizer.test.ts` (additions)
**Validation:** New tests fail before T-05, pass after. All existing authorizer tests remain green.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-06 — `llm.ts`: remove `PROMPTS` registry; make `rawPromptText` a required parameter

**Goal:** Remove the `PROMPTS` in-file registry object from `packages/functions/src/llm.ts`. Extend `createBedrockClient` so `rawPromptText: string` is a required third parameter. Update all existing call sites in `functional-gen.ts` that currently rely on the in-file registry to instead receive `rawPromptText` from their caller (a DDB lookup wired in T-07). No change to the Bedrock invocation logic itself.
**Satisfies:** R-08, R-34 (D-7)
**Deps:** T-01
**Impacted areas:** `packages/functions/src/llm.ts`, `packages/functions/src/functional-gen.ts` (call-site update only — no new logic; that comes in T-07)
**Validation:** TypeScript compiles with `strict` mode. `createBedrockClient` without `rawPromptText` is a type error. Existing llm unit tests pass with the updated signature.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-06a — Tests for T-06

**Goal:** Update existing `llm.ts` unit tests to pass `rawPromptText` explicitly; add a test asserting the prompt text supplied to `createBedrockClient` is forwarded verbatim to the Bedrock invocation payload, so there is no implicit fallback.
**Satisfies:** R-08, R-34 acceptance criteria
**Deps:** T-06
**Impacted areas:** `packages/functions/tests/llm.test.ts`
**Validation:** All updated tests pass. No test in the suite relies on the removed `PROMPTS` object.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

## Phase 3 — Handlers

Tasks T-07, T-08, and T-09 are independent of each other and can be run in parallel.

### T-07 — `functional-gen.ts`: optional `promptVersion` param + DDB prompt lookup

**Goal:** Extend the `functional-gen.ts` handler to accept an optional `promptVersion` field in the request body (defaulting to `'v1'`), call `getPromptVersion(promptVersion)` from `repository.ts`, return `400 Bad Request` naming the missing version if the record is not found, and pass the resolved `rawPromptText` and `modelId` to `createBedrockClient`. The worker's existing `FJOB#`/`GEN#` flow and `generated-tests/functional/` output path remain completely unchanged.
**Satisfies:** R-10, R-11, R-31, R-34
**Deps:** T-04, T-06
**Impacted areas:** `packages/functions/src/functional-gen.ts`
**Validation:** Existing `POST /generate-functional-tests` call patterns (no `promptVersion` field) continue to pass all existing tests. New tests cover the default-to-v1 path, the explicit-version path, and the unknown-version 400 path.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-07a — Tests for T-07

**Goal:** Write unit tests for the `functional-gen.ts` handler changes: (1) omitted `promptVersion` defaults to `'v1'` and triggers a DDB lookup; (2) a valid `promptVersion` triggers a DDB lookup and passes `rawPromptText` to `createBedrockClient`; (3) an unknown `promptVersion` returns `400` naming the missing version; (4) all previously-passing functional-gen tests remain green.
**Satisfies:** R-10, R-11 acceptance criteria
**Deps:** T-07
**Impacted areas:** `packages/functions/tests/functional-gen.test.ts`
**Validation:** All four cases pass. The `PlanCache` key structure test (R-61 acceptance criterion) remains unchanged.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-08 — `prompt-versions.ts`: 3 handler functions

**Goal:** Create `packages/functions/src/prompt-versions.ts` with `handleCreatePromptVersion` (validates with `isValidPromptVersion`, conditional put via `putPromptVersion`, returns 201/400/409), `handleListPromptVersions` (delegates to `listPromptVersions`, returns 200 newest-first, omits `text` field from list items), and `handleGetPromptVersion` (direct key lookup, returns 200 with full record including `text` or 404).
**Satisfies:** R-02, R-03, R-04, R-05, R-06
**Deps:** T-01, T-04
**Impacted areas:** `packages/functions/src/prompt-versions.ts` (new)
**Validation:** TypeScript compiles. `handleCreatePromptVersion` with a duplicate `promptVersion` returns `409`. Missing required fields return `400`. `handleListPromptVersions` response omits `text`. `handleGetPromptVersion` returns `404` for an unknown version.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-08a — Tests for T-08

**Goal:** Write unit tests (DynamoDB mocked) for all three handlers covering: 201 happy path, 409 duplicate, 400 missing fields, 400 invalid format, 200 list (newest-first, no `text`), 200 get (includes `text`), 404 get-not-found.
**Satisfies:** R-02, R-03, R-04, R-05, R-06 acceptance criteria
**Deps:** T-08
**Impacted areas:** `packages/functions/tests/prompt-versions.test.ts` (new)
**Validation:** All seven cases pass. The 409 test confirms the existing DDB record is unchanged. The list-response test confirms `text` is absent.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-09 — `experiments.ts`: handler, worker, and helpers

**Goal:** Create `packages/functions/src/experiments.ts` with: `handler` (validates `promptVersion` existence synchronously via `getPromptVersion`, writes `EXP#{}` with `status: 'pending'`, dispatches `ExperimentWorker` via `InvocationType: 'Event'`, returns 202 with `experimentId` and `statusUrl`); `worker` (loads experiment record, sets `status: 'running'`, looks up `PROMPT#{}`, delegates to `runExperiment`, always catches all errors and writes a terminal status); `runExperiment` (builds `LlmClient`, calls `buildExperimentInputs`, writes artifact to `experiments/{experimentId}/artifacts.json`, updates experiment record with counts and `artifactKey`); `buildExperimentInputs` (mirrors `buildFunctionalInputs`, accepts `PromptVersionRecord`).
**Satisfies:** R-20, R-21, R-22, R-30, R-31, R-32, R-33, R-34
**Deps:** T-01, T-04, T-06
**Impacted areas:** `packages/functions/src/experiments.ts` (new)
**Validation:** `handler` with an unknown `promptVersion` returns `400` and does not write an `EXP#{}` record. `worker` with a Bedrock failure writes `status: 'failed'` with a redacted error and does not throw. Artifact is written to the `experiments/` prefix, not `generated-tests/functional/`. Existing functional-gen flow is not imported or modified.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-09a — Tests for T-09

**Goal:** Write unit tests (DynamoDB, Lambda SDK, S3, and LlmClient mocked) covering: handler 202 happy path; handler 400 unknown promptVersion (no DDB write); worker `pending`→`running`→`succeeded` status transitions; worker `pending`→`running`→`failed` on Bedrock error (no unhandled throw); S3 artifact written to `experiments/{id}/` prefix; `buildExperimentInputs` overrides `modelId`, `promptVersion`, and `rawPromptText`; **handler returns 500 and does not update experiment status when `InvokeCommand` throws** (experiment record left in `pending` — documented failure mode in design.md).
**Satisfies:** R-20, R-21, R-30, R-31, R-32, R-33 acceptance criteria
**Deps:** T-09
**Impacted areas:** `packages/functions/tests/experiments.test.ts` (new)
**Validation:** All seven cases pass. The worker `failed` test asserts no unhandled exception is thrown and `updateExperiment` is called with `status: 'failed'`. The artifact-path test asserts the S3 key starts with `experiments/`. The invoke-fails test asserts `updateExperiment` is NOT called (record stays `pending`).
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

## Phase 4 — Read Handlers and SPA API Client

Tasks T-10 and T-11 are independent of each other and can be run in parallel.

### T-10 — `read.ts`: 5 new read handler exports

**Goal:** Add five exports to `packages/functions/src/read.ts`: `promptVersions` (delegates to `handleListPromptVersions`), `promptVersion` (delegates to `handleGetPromptVersion`), `experiments` (delegates to `handleListExperiments`), `experiment` (delegates to `handleGetExperiment`), and `experimentArtifact` (fetches S3 artifact via `getExperimentArtifact`, merges `experimentId` + `promptVersion` + artifact content into response body; returns 404 if experiment does not exist or is not `succeeded`).
**Satisfies:** R-05, R-06, R-40, R-41, R-42
**Deps:** T-08, T-09
**Impacted areas:** `packages/functions/src/read.ts`
**Validation:** `experimentArtifact` returns `404` for a `pending` experiment and for a `failed` experiment. The 200 response includes `experimentId`, `promptVersion`, `manifest`, and `plans`. `promptVersions` list omits `text` field.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-10a — Tests for T-10

**Goal:** Write unit tests for the five new `read.ts` exports: list prompt versions (delegates correctly), get single prompt version (200 + 404), list experiments (delegates correctly), get single experiment (200 + 404), get artifact (200 happy path, 404 for non-existent experiment, 404 for non-succeeded experiment).
**Satisfies:** R-05, R-06, R-40, R-41, R-42 acceptance criteria
**Deps:** T-10
**Impacted areas:** `packages/functions/tests/read.test.ts` (additions)
**Validation:** All seven cases pass. The artifact 404 test covers both the "experiment not found" and "experiment not succeeded" branches. Existing read.ts tests remain green.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

### T-11 — `packages/web/src/api.ts`: 6 new API client methods

**Goal:** Add six methods to the existing API client in `packages/web/src/api.ts`: `createPromptVersion(payload)` → `POST /prompt-versions`; `listPromptVersions()` → `GET /prompt-versions`; `createExperiment(payload)` → `POST /experiments`; `listExperiments()` → `GET /experiments`; `getExperiment(experimentId)` → `GET /experiments/{id}`; `getExperimentArtifact(experimentId)` → `GET /experiments/{id}/artifact`. Use the existing fetch wrapper and auth token pattern already in the file.
**Satisfies:** R-50, R-51, R-52, R-53, R-54
**Deps:** T-01 (types for request/response shapes)
**Impacted areas:** `packages/web/src/api.ts`
**Validation:** All 6 methods are typed with `PromptVersionRecord` / `ExperimentRecord` return types from `@registry/core`. TypeScript compiles without error. No fetch call in the new methods hard-codes the API base URL — they use the existing base-URL helper.
**Subagent:** none — follows existing mechanical pattern; each method is a typed wrapper over the shared fetch helper.
**Review checkpoint:** Pause after this task.

### T-11a — Tests for T-11

**Goal:** Write web-tier unit tests (jsdom + stub fetch) for the 6 new api.ts methods: each method calls the correct URL + HTTP verb, passes the auth header, and parses the JSON response into the correct typed shape.
**Satisfies:** R-50–R-54 acceptance criteria (API layer)
**Deps:** T-11
**Impacted areas:** `packages/web/tests/api.test.ts` (additions)
**Validation:** All 6 cases pass. Tests use the existing stub-fetch pattern already present in the web test suite.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.

---

## Phase 5 — SPA Components

### T-12 — `App.tsx`: Experiments view and 4 components

**Goal:** Extend `packages/web/src/App.tsx` to add an `'experiments'` entry to the `view` state union and a nav link. Inline four components: `ExperimentsView` (top-level, loads experiment + prompt version lists); `NewPromptVersionForm` (writer-only — fields: `promptVersion`, `modelId`, `text` textarea, `notes`; submits via `createPromptVersion`, resets and refreshes list on success); `NewExperimentForm` (writer-only — single-select from `listPromptVersions`, submits via `createExperiment`, navigates to detail on success); `ExperimentList` with selectable `ExperimentRow` items; `ExperimentComparison` side-by-side CSS Grid showing two `RunColumn` instances, each polling `getExperiment` every 5 seconds (via `setInterval` in `useEffect`, cleared on terminal state) and loading artifact content from `getExperimentArtifact`.
**Satisfies:** R-50, R-51, R-52, R-53, R-54
**Deps:** T-11
**Impacted areas:** `packages/web/src/App.tsx`
**Validation:** Writer-gated forms (`isWriter(token)` check) do not render for reader tokens. Polling interval is cleared when `status === 'succeeded' || status === 'failed'`. A `failed` experiment's `RunColumn` shows the error message and no artifact content. The side-by-side layout uses CSS Grid (two columns), not absolute positioning.
**Subagent:** implementer
**Review checkpoint:** Pause after this task.

### T-12a — Tests for T-12

**Goal:** Write web-tier unit tests (jsdom + stub fetch) for the four new components: `NewPromptVersionForm` resets and refreshes on success; `NewExperimentForm` populates the select from `listPromptVersions` response; `ExperimentList` renders rows and marks two as selected for comparison; `RunColumn` starts polling on non-terminal status and clears interval on `succeeded`; `RunColumn` shows error message (not artifact) for `failed` status.
**Satisfies:** R-50, R-51, R-52, R-53, R-54 acceptance criteria
**Deps:** T-12
**Impacted areas:** `packages/web/tests/App.test.ts` (additions or new file)
**Validation:** All five cases pass. The polling test uses `vi.useFakeTimers()` to advance the interval and verifies `clearInterval` is called when the mocked response transitions to a terminal state.
**Subagent:** test-writer
**Review checkpoint:** Pause after this task.
