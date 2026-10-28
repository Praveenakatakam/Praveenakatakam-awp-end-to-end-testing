# Requirements — Prompt Versioning & Experiment Tracking

> **Version:** 0.2.0
> **Status:** Draft

## 1. Purpose and Context

The ODCS Contract Registry's LLM functional test generator currently uses a hardcoded prompt stored in `llm.ts` with no way to iterate on it without a redeploy. This feature adds DynamoDB-backed prompt version management (runtime-editable, no redeploy needed), migrates the existing hardcoded `v1` prompt into DynamoDB, extends the existing functional-gen endpoint to accept an optional prompt version, and introduces an experiment concept — one generation job run against the current catalog using a specific prompt version — so that writers can trigger runs, then browse and compare any two saved experiment results side by side in the SPA.

## 2. Out of Scope

- **Quantitative metrics (skip rate, validity rate, test coverage scores).** The comparison surface is **qualitative only** — a human reviews generated test plans. Automated scoring is deferred to `generation-run-audit` or a dedicated scoring spec.
- **New SST stack.** All infrastructure changes extend the existing stacks in place.
- **Automatic or scheduled experiment triggering.** Experiments are triggered manually by an authenticated API call or SPA button only.
- **Editing or deleting prompt versions.** Prompt versions are append-only and immutable once created.
- **Automated test execution for generated experiment artifacts.** Experiment runs produce stored test plans; running them is future work.
- **Semantic diff of generated test plans.** The SPA shows any two saved runs side by side for qualitative review; a structured semantic diff is out of scope.
- **Pinning experiments to a historical crawl snapshot.** Experiments use the current catalog state, the same as the existing functional-gen job. Historical snapshot pinning belongs in the `generation-run-audit` spec.
- **Matrix / multi-cell experiments.** One experiment = one job using one prompt version. Parallel or matrix-style fan-out is deferred to `parallel-llm-generation`.

---

## 3. Functional Requirements (EARS)

> EARS keywords: **WHEN** (event) · **IF** (unwanted/error) · **WHILE** (state) · **WHERE** (optional/conditional) · **SHALL** (mandatory) / **SHOULD** (preferred) / **MAY** (optional).

### 3.1 Prompt Version Management

**R-01** — THE system SHALL store each prompt version as a **DynamoDB item** (item kind `PROMPT#{promptVersion}`) in the existing single-table, carrying: a unique `promptVersion` string, the full prompt `text`, the `modelId` to invoke for synthesis, a `createdAt` ISO-8601 timestamp, a `createdBy` field (Cognito username from the JWT), a `kind` attribute set to `'PROMPT'` (for GSI membership), and an optional `notes` string. No code redeploy is required to add a prompt version.

**R-02** — WHEN an authorised **writer** calls `POST /prompt-versions` with a valid payload (`promptVersion`, `text`, `modelId`, and optional `notes`), THE system SHALL persist the prompt version record and respond `201 Created` with the stored record.

**R-03** — IF `POST /prompt-versions` specifies a `promptVersion` string that **already exists**, THE system SHALL respond `409 Conflict` and SHALL NOT overwrite the existing record. Prompt versions are **immutable once created**.

**R-04** — IF `POST /prompt-versions` is missing a required field (`promptVersion`, `text`, or `modelId`) or any required field is blank, or `promptVersion` does not match `[a-z0-9-_.]{1,64}`, THE system SHALL respond `400 Bad Request`.

**R-05** — WHEN an authorised reader calls `GET /prompt-versions`, THE system SHALL respond `200 OK` with a list of all prompt versions ordered **newest-first** by `createdAt`, sourced by querying the **`byKind` GSI** with `kind = 'PROMPT'`.

**R-06** — WHEN an authorised reader calls `GET /prompt-versions/{promptVersion}`, THE system SHALL respond `200 OK` with the matching record; IF the version does not exist, THE system SHALL respond `404 Not Found`.

**R-07** — IF any `/prompt-versions` endpoint is called with **no credential**, THE system SHALL respond `401 Unauthorized`; IF the token is invalid, expired, or lacks the required group (writer for `POST`, reader for `GET`), THE system SHALL respond `403 Forbidden`; in no case SHALL a write proceed.

### 3.2 PROMPTS Migration

**R-08** — THE system SHALL migrate the existing hardcoded prompt text from `llm.ts` into DynamoDB as a `PROMPT#v1` record, seeded during deployment. The in-file `PROMPTS` registry object SHALL be removed from `llm.ts`. After this change, **all prompt text** (including the existing functional-gen flow's default) SHALL be sourced from DynamoDB at runtime. This migration is **in scope** for this feature — it is not deferred.

**R-09** — THE deployment process SHALL seed the `PROMPT#v1` record using the existing hardcoded prompt text, such that the existing functional-gen flow continues to work without any caller changes. IF the `PROMPT#v1` record already exists (e.g. on a re-deploy), the seeding step SHALL be idempotent (no-op or conditional put).

### 3.3 Existing Functional-Gen Flow — promptVersion Extension

**R-10** — WHEN an authorised user calls `POST /generate-functional-tests`, THE system SHALL accept an optional `promptVersion` field in the request body. IF `promptVersion` is omitted, THE system SHALL default to `'v1'`. THE system SHALL look up the corresponding `PROMPT#{promptVersion}` record from DynamoDB and use its `text` and `modelId` for the generation job.

**R-11** — IF `POST /generate-functional-tests` supplies a `promptVersion` that **does not exist** in DynamoDB, THE system SHALL respond `400 Bad Request` naming the unknown version.

### 3.4 Experiment Triggering

**R-20** — WHEN an authorised **writer** calls `POST /experiments` with a valid payload (`promptVersion: string`), THE system SHALL create an **experiment record** (item kind `EXP#{experimentId}`) in DynamoDB with `status: 'pending'`, enqueue an **asynchronous** job to execute one functional-gen run against the current catalog using the specified prompt version, and respond `202 Accepted` with the `experimentId` and a `statusUrl` for polling.

**R-21** — IF `POST /experiments` supplies a `promptVersion` that **does not exist** in the prompt-version catalog, THE system SHALL respond `400 Bad Request` naming the unknown version and SHALL NOT create an experiment.

**R-22** — IF `POST /experiments` is called with **no credential**, THE system SHALL respond `401`; IF the token is invalid/expired or lacks the **writer** group, `403`; in no case SHALL an experiment start.

**R-23** — Experiment triggering SHALL be **manual only** — triggered by an authenticated API call or SPA button. No scheduled, automatic, or crawl-completion-triggered experiment runs are supported.

### 3.5 Experiment Execution

**R-30** — THE experiment job SHALL execute **one functional-gen run** using the `PROMPT#{promptVersion}` record identified at trigger time, against the **current catalog state**. The experiment record SHALL be updated to `status: 'running'` when the job begins and to a terminal state (`'succeeded'` or `'failed'`) when it ends.

**R-31** — WHEN the job runs, THE system SHALL look up the **prompt text and modelId** from the `PROMPT#{promptVersion}` DynamoDB record and supply them to the functional-gen execution. The prompt version string and model id SHALL be included in the **input hash** for each plan (identical to how the existing cache key is constructed), so that a changed prompt causes cache misses and triggers re-synthesis.

**R-32** — WHEN the job completes successfully, THE system SHALL write the result artifact (manifest + synthesised plans) to S3 under the `experiments/{experimentId}/` prefix and SHALL store `planCount`, `skipCount`, `skips[]`, and `artifactKey` on the experiment record. The existing `POST /generate-functional-tests` output path (`generated-tests/functional/`) SHALL remain completely unchanged.

**R-33** — IF the Bedrock invocation fails, the response is malformed, or any storage write fails, THE system SHALL mark the experiment record `status: 'failed'` with a redacted error message. The worker SHALL always catch all errors and write a terminal status — it SHALL NOT throw unhandled exceptions that leave the record in a non-terminal state.

**R-34** — THE experiment execution SHALL use the **existing Bedrock invocation logic** via the injectable `LlmClient` interface — it SHALL NOT copy or duplicate Bedrock call code. THE existing `POST /generate-functional-tests` flow, its DynamoDB item kinds (`FJOB#`, `GEN#`), and its `generated-tests/functional/` output path SHALL remain completely unchanged.

### 3.6 Experiment Catalog — API

**R-40** — WHEN an authorised reader calls `GET /experiments`, THE system SHALL respond `200 OK` with a list of experiment records — `experimentId`, `status`, `promptVersion`, `createdAt`, `createdBy`, `planCount?`, `skipCount?` — ordered **newest-first** by `createdAt`, sourced from the `byKind` GSI (`kind = 'EXPERIMENT'`).

**R-41** — WHEN an authorised reader calls `GET /experiments/{experimentId}`, THE system SHALL respond `200 OK` with the full experiment record including `planCount`, `skipCount`, `skips[]`, and `artifactKey`; IF the experiment does not exist, THE system SHALL respond `404 Not Found`.

**R-42** — WHEN an authorised reader calls `GET /experiments/{experimentId}/artifact`, THE system SHALL respond `200 OK` with the full artifact content (manifest JSON + synthesised plan objects) retrieved from S3; IF the experiment does not exist or has not yet produced an artifact (status is not `succeeded`), THE system SHALL respond `404 Not Found`.

**R-43** — IF any `/experiments` endpoint is called with **no credential**, THE system SHALL respond `401`; IF the token is invalid/expired or insufficient, `403`.

### 3.7 Experiment Catalog — SPA

**R-50** — WHILE authenticated, THE front-end SHALL display an **Experiments** section listing all experiment runs with their status, prompt version, creation time, and result counts (planCount / skipCount). The list SHALL be derived from `GET /experiments`.

**R-51** — THE front-end SHALL support **side-by-side comparison** of any two saved experiment runs: the user selects two runs from the list and the SPA displays their generated test plans in parallel columns, with each run's skip count and any error, to support qualitative human review of how prompt iterations affect output.

**R-52** — THE front-end SHALL show the **real-time status** of a running experiment by polling `GET /experiments/{experimentId}` at a reasonable interval until the run reaches a terminal state, then stopping.

**R-53** — WHERE the authenticated user holds the **writer** group, THE front-end SHALL provide a **"New Experiment" trigger form** that lets the user select a single prompt version from a list populated from `GET /prompt-versions` and submit the experiment via `POST /experiments`.

**R-54** — WHERE the authenticated user holds the **writer** group, THE front-end SHALL provide a **"New Prompt Version" form** that lets the user enter a version string, model id, prompt text (multi-line), and notes — and submit via `POST /prompt-versions`. WHEN submission succeeds, THE form SHALL reset and the prompt version list SHALL refresh.

### 3.8 Data Model and Infrastructure

**R-60** — THE system SHALL add **two new DynamoDB item kinds** to the existing single-table (no new table, no change to existing item kinds):

| Kind | PK | SK | Key attributes |
|---|---|---|---|
| **Prompt version** | `PROMPT#{promptVersion}` | `PROMPT` | `promptVersion`, `text`, `modelId`, `kind:'PROMPT'`, `createdAt`, `createdBy`, `notes?` |
| **Experiment** | `EXP#{experimentId}` | `EXP` | `experimentId`, `kind:'EXPERIMENT'`, `status`, `promptVersion`, `createdAt`, `createdBy`, `planCount?`, `skipCount?`, `skips?[]`, `artifactKey?`, `error?` |

**R-61** — THE `byKind` GSI SHALL be used with `kind = 'PROMPT'` to list prompt versions newest-first, and with `kind = 'EXPERIMENT'` to list experiment runs newest-first. No new GSI is required. The existing **`PlanCache` input-hash key structure** (`{requirement text, contract content hash(es), API-map entry, model id, prompt version}`) SHALL remain unchanged.

**R-62** — THE system SHALL extend the **existing functional-gen Lambda and API Gateway routes** (no new SST stack) to handle the new experiment and prompt-version endpoints. The extension SHALL be non-destructive: all existing routes, Lambda entry points, and IAM policies SHALL continue to function identically.

**R-63** — The experiment execution worker SHALL run within the **existing functional-gen Lambda's IAM execution role**, which already has `bedrock:InvokeModel` and the required DynamoDB/S3 permissions. Additional permissions (writing to new item kinds and new S3 prefixes) SHALL be added additively.

**R-64** — THE system SHALL apply a **90-day S3 lifecycle rule** to the `experiments/` prefix, expiring objects after 90 days. This rule SHALL be added to the existing stack as part of this feature — it is not deferred.

---

## 4. Non-Functional Requirements

- **Performance:** `GET /prompt-versions` and `GET /experiments` SHOULD respond within **300 ms p95** (pre-fetched from DynamoDB via GSI, no LLM calls). Experiment execution latency mirrors the existing functional-gen job (async, no synchronous API timeout concern — R-20/R-30).
- **Security:** Auth model identical to the existing system: all endpoints require a valid Cognito token; `POST` routes require the writer group; read routes require at minimum the reader group. No prompt text, model id, or experiment artifact SHALL appear in Lambda logs as a credential or secret. Bedrock access via the existing IAM execution role (no stored key).
- **Scale:** The new item kinds SHALL not require structural change to support **≥50 prompt versions** and **≥100 experiment records** (mirrors existing NFR-3 scale posture). The `byKind` GSI avoids full-table scans for both item kinds.
- **Reliability:** Experiment fault isolation (R-33) ensures the worker always writes a terminal status. New DynamoDB writes use the same retry-on-`UnprocessedItems` pattern as the existing catalog.
- **Observability:** The experiment execution Lambda SHALL emit structured logs per run (promptVersion, outcome, planCount, skipCount, any error); sensitive content (prompt text beyond a truncated excerpt, plan content) SHALL NOT be logged.

---

## 5. Edge Cases

| Condition | Expected Behaviour |
|---|---|
| `POST /prompt-versions` with a duplicate `promptVersion` string | `409 Conflict`; existing record unchanged (R-03) |
| `POST /prompt-versions` with blank `text`, missing `modelId`, or invalid format | `400 Bad Request` (R-04) |
| `POST /experiments` naming a prompt version that does not exist | `400 Bad Request` naming the unknown version; no experiment created (R-21) |
| `POST /generate-functional-tests` naming a prompt version that does not exist | `400 Bad Request` naming the unknown version (R-11) |
| `POST /generate-functional-tests` omitting `promptVersion` | Defaults to `v1`; looks up `PROMPT#v1` from DynamoDB (R-10) |
| PROMPT#v1 DynamoDB seed not yet present (first deploy) | Seeding step runs before any Lambda traffic; seed is idempotent on re-deploy (R-09) |
| Experiment's Bedrock call fails | Experiment record marked `status: 'failed'` with redacted error; no unhandled exception (R-33) |
| `GET /experiments/{id}/artifact` for an experiment in `pending` or `failed` state | `404 Not Found` — no artifact was produced (R-42) |
| Reader calls `POST /experiments` or `POST /prompt-versions` | `403 Forbidden` (R-07, R-22) |
| `GET /experiments/{id}` for an unknown experiment id | `404 Not Found` (R-41) |
| SPA experiment detail view while run is still in progress | Progress indicator; SPA polls until terminal state (R-52) |
| `POST /generate-functional-tests` called while an experiment is running | No interference — separate code paths; existing flow unchanged (R-34) |
| A prompt version's `text` or `modelId` is updated (attempted) | Not supported — prompt versions are immutable; no `PUT /prompt-versions/{v}` endpoint (R-03) |
| User selects a `failed` experiment in the SPA comparison | Comparison column shows the error message and no artifact content |

---

## 6. Acceptance Criteria

- [ ] A writer can create a prompt version via `POST /prompt-versions` and retrieve it via `GET /prompt-versions/{version}`
- [ ] Creating a prompt version with a duplicate version string returns `409 Conflict` and leaves the original untouched
- [ ] `GET /prompt-versions` returns all versions newest-first, sourced from the `byKind` GSI with `kind = 'PROMPT'`
- [ ] A writer can trigger an experiment via `POST /experiments` with a single `promptVersion`; the system responds `202 Accepted` with an `experimentId`
- [ ] The experiment worker runs the functional-gen job and writes the result artifact to `experiments/{experimentId}/` in S3
- [ ] On completion the experiment record carries `planCount`, `skipCount`, and `artifactKey`
- [ ] `GET /experiments/{id}/artifact` returns the full manifest and plan content from S3
- [ ] A failed run writes `status: 'failed'` with a redacted error — no experiment record is ever left in a permanent non-terminal state
- [ ] `PROMPT#v1` is seeded in DynamoDB on deploy; the in-file `PROMPTS` object is absent from `llm.ts`
- [ ] `POST /generate-functional-tests` without a `promptVersion` defaults to `v1` and looks up prompt text from DynamoDB
- [ ] `POST /generate-functional-tests` with an unknown `promptVersion` returns `400 Bad Request`
- [ ] A 90-day S3 lifecycle rule is applied to the `experiments/` prefix
- [ ] The existing `PlanCache` key structure is unchanged (verified by unit test asserting the hash inputs)
- [ ] `POST /generate-functional-tests` continues to behave identically for all existing call patterns (existing tests remain green)
- [ ] No new SST stack is created; all new routes are added to the existing API Gateway HTTP API
- [ ] Experiment artifacts are written to `experiments/{experimentId}/` in S3, not to `generated-tests/functional/`
- [ ] The SPA shows an Experiments list and allows side-by-side comparison of any two saved runs
- [ ] Reader cannot call `POST /experiments` or `POST /prompt-versions` (returns `403`)

---

## 7. Open Questions

- **OQ-1 — Prompt version string format.** RESOLVED: enforce `[a-z0-9-_.]{1,64}`. See R-04.

---

## 8. Decisions Log

**D-1 — Single-run experiment model (not matrix).**
- One experiment = one job using one prompt version. Historical comparison is achieved by browsing saved experiment runs and selecting any two for side-by-side review.
- Reason: simplest model that achieves the comparison goal; matrix/parallel fan-out deferred to `parallel-llm-generation`.
- Affects: R-20, R-30, R-50, R-51

**D-2 — PROMPTS.v1 migration is in scope.**
- The hardcoded `PROMPTS` registry in `llm.ts` is migrated to DynamoDB as `PROMPT#v1` in this feature. All prompt text is sourced from DynamoDB at runtime after this change.
- Reason: keeping a parallel hardcoded registry alongside DynamoDB-managed prompts creates divergence risk and partially defeats the purpose of runtime prompt management.
- Affects: R-08, R-09, R-10

**D-3 — `byKind` GSI used for prompt version list (not a scan).**
- `GET /prompt-versions` queries the `byKind` GSI with `kind = 'PROMPT'`. No `ScanCommand` is used.
- Reason: consistent with existing GSI usage for crawl runs and generation runs; avoids table scans; no new GSI required.
- Affects: R-05, R-61

**D-4 — 90-day S3 lifecycle rule on `experiments/` prefix (in scope, not deferred).**
- A lifecycle rule expiring experiment artifacts after 90 days is added to the existing stack as part of this feature.
- Reason: bounds storage cost without manual intervention; 90 days provides sufficient retention for qualitative review.
- Affects: R-64

**D-5 — `sourceSnapshotId` is out of scope.**
- Crawl run records have no reliable `status` field to resolve "most recent succeeded crawl". Experiment runs use the current catalog state, the same as the existing functional-gen job. Snapshot pinning belongs in `generation-run-audit`.
- Affects: R-20, R-30
