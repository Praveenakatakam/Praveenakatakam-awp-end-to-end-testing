# Requirements — Configurable LLM Pipeline

> **Version:** 0.3.0
> **Status:** Draft

## 1. Purpose and Context

The functional test generator today runs a single hardcoded LLM call per requirement using one fixed prompt and model. This feature replaces that with a runtime-configurable pipeline of named, ordered steps stored in DynamoDB and executed via an async Lambda chain. Each step references a stored prompt and a Bedrock model, and the runtime injects grounded context plus prior step outputs as structured input. Pipeline composition, model selection, and prompts can all be changed without a code change or redeploy, enabling prompt engineering and multi-step test synthesis workflows.

## 2. Out of Scope

- DAG / parallel independent steps — linear chain only in v1; DAG is a confirmed follow-on
- SQS or Step Functions as the execution substrate — async Lambda chain only
- Per-pipeline SQS queues
- Step-level retry without restarting from the beginning (step-level resume is a follow-on)
- Multi-step fan-out across requirements within a single step (covered by `parallel-llm-generation` stub)
- Version diffing in the SPA prompt editor
- Non-LLM pipeline steps (e.g. code execution, compile checks) — all steps in v1 invoke Bedrock
- Human review gates (`waitForHuman: true` is reserved in the schema but treated as a no-op in v1; the `POST /runs/{runId}/steps/{stepId}/approve` route is reserved for a future implementation and not available in v1)

## 3. Functional Requirements (EARS)

### 3.1 Pipeline Configuration

**R-01** — The system SHALL store pipeline configuration as a DynamoDB item with key `PIPELINE#<pipelineId>`, containing: `pipelineId`, `name`, `steps` (ordered array), `maxSteps`, `maxAgeMinutes`, `active` (boolean), `version`, `createdAt`, `updatedAt`.

**R-02** — Each step in `steps` SHALL contain: `stepId` (unique within pipeline), `label` (human-readable name), `model` (Bedrock model ID, validated against the model allowlist defined in R-10), `promptKey` (reference to a `PROMPT#` item), `optional` (boolean, default `false`), `waitForHuman` (boolean, default `false`), and `includeContext` (boolean, default `true`).

**R-03** — WHEN a pipeline configuration is written (created or updated), THE system SHALL validate that `steps.length` does not exceed `maxSteps`.

**R-04** — IF `maxSteps` on a pipeline write request exceeds the system hard cap of 20, THE system SHALL reject the request with HTTP 422 and a message indicating the hard cap.

**R-05** — IF `maxSteps` is not specified on a pipeline create request, THE system SHALL default `maxSteps` to 10.

**R-06** — WHEN a pipeline configuration is written, THE system SHALL reject the request with HTTP 422 if any `promptKey` in `steps` does not resolve to an existing `PROMPT#` item.

**R-07** — WHEN a pipeline configuration is updated, THE system SHALL increment the `version` field and set `updatedAt` to the current UTC timestamp.

**R-08** — The system SHALL support soft-deletion of pipelines: `DELETE /pipelines/{pipelineId}` SHALL set `active: false` rather than removing the item.

**R-09** — IF a `DELETE /pipelines/{pipelineId}` request is received for a pipeline that has at least one run with status `running`, THE system SHALL reject the request with HTTP 409 and a message indicating the active run(s).

**R-10** — The system SHALL maintain a model allowlist as a system config value stored in DynamoDB (not hardcoded), containing the set of permitted Bedrock model IDs. WHEN a pipeline configuration is written, THE system SHALL validate each step's `model` field against this allowlist; IF any step references an unrecognized model ID, THE system SHALL reject the request with HTTP 422. The allowlist SHALL be updatable without a code change or redeployment.

**R-45** — The pipeline config SHALL include a `defaultSampling` field (same shape as `sampling` on a step: `{ strategy: "first_n" | "percentage" | "ids" | "all", n?: number, percentage?: number, ids?: string[] }`, default `{ strategy: "first_n", n: 3 }`) and a `defaultMode` field (`"per_requirement"` | `"batch"`, default `"per_requirement"`). These serve as the run-level sampling and mode defaults when no override is provided on the run request.

**TS-01** — Given a valid pipeline payload with `maxSteps: 5`, 3 steps with valid `model` and `promptKey` fields → POST `/pipelines` → response is HTTP 201, DDB item exists, `version: 1`.
**TS-02** — Given a pipeline payload with 6 steps and `maxSteps: 5` → POST `/pipelines` → response is HTTP 422.
**TS-03** — Given a pipeline payload with `maxSteps: 25` → POST `/pipelines` → response is HTTP 422 with hard cap message.
**TS-04** — Given a pipeline with no active runs → DELETE `/pipelines/{pipelineId}` → item has `active: false`, HTTP 200.
**TS-05** — Given a pipeline with one run in status `running` → DELETE → HTTP 409.
**TS-06** — Given a pipeline payload where one step's `model` is not in the model allowlist → POST `/pipelines` → HTTP 422.
**TS-27** — Given POST `/pipelines` with no `defaultSampling` or `defaultMode` → DDB item has `defaultSampling: { strategy: "first_n", n: 3 }` and `defaultMode: "per_requirement"`.

---

### 3.2 Step Definition

**R-11** — A pipeline step is a generic unit defined solely by its fields from R-02. Steps have no predefined roles, typed input/output contracts, or structural constraints beyond those fields. The experiment author defines the step's purpose through `label` and the referenced prompt.

**R-12** — WHEN a step Lambda executes, THE system SHALL inject context as follows: the original grounded context (contracts and requirements captured by the crawler) is always included as structured context; IF `includeContext` is `true`, an ordered array of prior step outputs in the form `[{ stepId, label, output: string }]` is also included; IF `includeContext` is `false`, only the original grounded context is included. Prompts are static — they contain no template variables; all context injection is performed by the runtime, not through string interpolation in the prompt body.

**R-13** — WHEN a step Lambda completes, THE system SHALL compute and record on the step record: `contextTokenEstimate` (estimated token count of the full context payload passed to the LLM) and `outputTokens` (actual token count of the LLM response, from Bedrock response metadata). These fields are stored for observability; no threshold logic or automated actions are applied based on these values in v1.

**R-14** — WHEN a step with `waitForHuman: true` begins execution, THE system SHALL log a warning and proceed as if `waitForHuman` is `false`. The field is reserved in the schema to avoid a data migration in a future implementation that honours it.

**R-15** — WHERE a step is marked `optional: true`, IF that step's Lambda invocation fails (terminal error), THE system SHALL record the step as `status: 'warning'` on the run record and continue execution with the next step rather than marking the run `failed`.

**R-16** — WHERE a step is marked `optional: false`, IF that step's Lambda invocation fails (terminal error), THE system SHALL mark the run `failed` immediately and halt the chain.

**R-51** — WHEN a step Lambda completes (successfully or with error), THE system SHALL record the following on the step record:
- `durationMs` — total step execution time from lease write to step record update
- `bedrockLatencyMs` — time from Bedrock InvokeModel call start to response received
- `inputTokens` — from Bedrock response `usage.input_tokens`
- `outputTokens` — from Bedrock response `usage.output_tokens`
- `inputCharacters` — character count of the full context string sent to Bedrock
- `outputCharacters` — character count of the raw output string received
- `contextTokenEstimate` — character-heuristic estimate (supersedes the field added in R-13)
- `costEstimateUsd` — computed as `(inputTokens × inputPricePerToken) + (outputTokens × outputPricePerToken)` where prices are looked up from a per-model price table stored alongside the model allowlist
- `errorMessage` — sanitized error message if the step failed (API keys, tokens, and secrets redacted via the existing `redact()` utility)
- `errorStack` — sanitized stack trace if the step failed (same redaction)

**TS-07** — Given a step with `includeContext: true` and two prior completed steps → the context payload sent to Bedrock contains the grounded context plus `[{ stepId, label, output }, { stepId, label, output }]`.
**TS-08** — Given a step with `includeContext: false` → the context payload sent to Bedrock contains only the grounded context; no prior step outputs are included.
**TS-09** — Given a step Lambda completes → the step record in DDB has `contextTokenEstimate` and `outputTokens` set.
**TS-10** — Given a step with `waitForHuman: true` → a warning is logged and the step executes normally; the run does not halt.
**TS-11** — Given an optional step that exhausts retries (terminal error) → step record has `status: 'warning'`, next step Lambda is invoked.
**TS-32** — Given a step Lambda completes successfully → step record has `durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `costEstimateUsd`, `inputCharacters`, and `outputCharacters` all set to numeric values.
**TS-33** — Given a step Lambda completes with a terminal error → step record has `errorMessage` and `errorStack` set and redacted of any secrets patterns.

---

### 3.3 Execution Model — Async Lambda Chain

**R-17** — WHEN `POST /generate-functional-tests` is called with a valid `pipelineId`, THE system SHALL create a run record in DDB with status `running`, `startedAt`, and then invoke the Step 0 Lambda with `InvocationType: 'Event'` (fire-and-forget), returning HTTP 202 with the `runId` to the caller.

**R-18** — WHEN a step Lambda begins processing, THE system SHALL write a `leaseExpiresAt` timestamp (current time + the configured lease duration, default 5 minutes) to the step record for that step.

**R-19** — WHEN a step Lambda completes successfully, THE system SHALL write the step's output (a raw string) to S3 (or DDB inline for payloads under 64 KB), update the step record status to `completed`, clear `leaseExpiresAt` on the step record, and invoke the next step Lambda asynchronously.

**R-20** — WHEN the final step in the pipeline completes successfully, THE system SHALL mark the run record `status: 'completed'` and set `completedAt`.

**R-21a** — WHEN a step Lambda catches a transient error (e.g. Bedrock throttle, network blip), THE system SHALL extend `leaseExpiresAt` on the step record to `now + leaseDuration` before each internal retry attempt, so that the lease remains alive during the retry window.

**R-21b** — WHEN a step Lambda determines a caught error is terminal (bad config, invalid prompt, retries exhausted, unrecoverable error), THE system SHALL mark the step record `status: 'failed'`; IF the step is non-optional, THE system SHALL also mark the run record `status: 'failed'`, set `failedAt`, record the error message and stack trace in the run record, and NOT invoke any further steps.

**R-21c** — The step Lambda SHALL be solely responsible for classifying a caught error as transient or terminal; the system SHALL provide no automatic reclassification of caught errors.

**R-22** — WHEN a step Lambda is about to invoke the next step, THE system SHALL re-read the pipeline config version and verify `executedSteps + 1 <= maxSteps` before proceeding; IF this check fails, THE system SHALL mark the run `timed_out` and halt.

**R-46** — WHEN a step Lambda begins execution, THE system SHALL check as its absolute first action whether `(now - run.startedAt) > SYSTEM_MAX_RUN_AGE_MINUTES` (a system constant, default 5 minutes). IF this check is true, THE system SHALL immediately mark the run `timed_out` and halt without writing a lease or invoking Bedrock. This check precedes all other logic including the per-pipeline `maxAgeMinutes` check.

**R-47** — WHEN `POST /generate-functional-tests` is called, the request body MAY include a `sampling` override (same shape as `defaultSampling` on the pipeline) and a `mode` override (`"per_requirement"` | `"batch"`). IF present, these override the pipeline's `defaultSampling` and `defaultMode` for this run only.

**R-48** — WHEN `mode` is `"per_requirement"`, THE system SHALL apply the sampling strategy to select a subset of requirements, then execute the pipeline once per selected requirement, each as an independent run. The handler SHALL return `{ runIds: string[] }` containing one entry per selected requirement. Sampling strategies:
- `first_n`: select the first N requirements, sorted by requirement ID
- `percentage`: select a deterministic subset using a SHA-256 hash of each requirement ID — same requirements selected on every run with the same percentage value
- `ids`: select only the requirements matching the provided IDs
- `all`: select all requirements

**R-49** — WHEN `mode` is `"batch"`, THE system SHALL apply the same sampling strategy to select a subset of requirements, then execute the pipeline ONCE with ALL selected requirements injected into the grounded context together, producing one PRUN record and one step chain. The handler SHALL return `{ runId: string }` (single run).

**R-50** — IF no `sampling` or `mode` is provided on the run request, THE system SHALL use the pipeline's `defaultSampling` and `defaultMode`.

**TS-12** — Given POST `/generate-functional-tests` with a valid `pipelineId` → response is HTTP 202 with `runId`, run record exists in DDB with `status: 'running'`.
**TS-13** — Given a step Lambda invoked via event → `leaseExpiresAt` is set on the step record before LLM call begins.
**TS-14** — Given last step completes → run record has `status: 'completed'` and `completedAt` is set.
**TS-15** — Given a non-optional step exhausts retries and classifies the error as terminal → run record has `status: 'failed'`, subsequent step Lambda is NOT invoked.
**TS-15b** — Given a step Lambda receives a Bedrock throttle error (transient) on first attempt → `leaseExpiresAt` is extended before the internal retry; run status remains `running`.
**TS-28** — Given a step Lambda invoked where `(now - run.startedAt) > SYSTEM_MAX_RUN_AGE_MINUTES * 60_000` → run is marked `timed_out`; no lease is written; Bedrock is not called.
**TS-29** — Given POST `/generate-functional-tests` with `sampling: { strategy: "all" }` and `mode: "batch"` → PRUN record has `sampling.strategy: "all"` and `mode: "batch"`, overriding the pipeline defaults.
**TS-30** — Given POST `/generate-functional-tests` with `mode: "per_requirement"`, `sampling: { strategy: "first_n", n: 2 }`, and a catalog with 5 requirements → response is HTTP 202 with `{ runIds: ["...", "..."] }` (2 entries); 2 independent PRUN records exist in DDB.
**TS-31** — Given POST `/generate-functional-tests` with `mode: "batch"`, `sampling: { strategy: "first_n", n: 2 }`, and a catalog with 5 requirements → response is HTTP 202 with `{ runId: "..." }` (single entry); one PRUN record has `requirementIds` containing 2 IDs.

---

### 3.4 Loop Prevention and Timeout Safety

**R-23** — WHEN a step Lambda is about to invoke the next step Lambda, THE system SHALL check `(now - run.startedAt) > run.maxAgeMinutes`; IF this check is true, THE system SHALL mark the run `timed_out` and halt without invoking the next step.

**R-24** — WHEN a step Lambda is retried — whether by AWS (after an unhandled failure) or internally by application logic (after a transient caught error) — THE system SHALL extend `leaseExpiresAt` on the step record to `now + leaseDuration` before each retry attempt, so that no concurrent process marks the step as abandoned while the retry is in progress.

**R-25** — WHEN the read Lambda (`GET /runs/{runId}`) fetches a run record whose `status` is a non-terminal value (`running`), THE system SHALL inspect each in-progress step record for `leaseExpiresAt < now`; IF any step's lease is expired and the run has not reached a terminal state, THE system SHALL mark the run `timed_out`, set `completedAt`, and return the terminal status in the response.

**R-26-loop** — The system SHALL NOT run any scheduled background polling or watchdog Lambda for lease expiry detection; all lease-expiry transitions to `timed_out` are performed lazily by the read Lambda on status fetch.

**TS-16** — Given a run where `now - startedAt > maxAgeMinutes` at step N → step Lambda halts, run is `timed_out`.
**TS-17** — Given a run with a step whose `leaseExpiresAt` is 10 minutes in the past and run `status: 'running'` → `GET /runs/{runId}` is called → response has `status: 'timed_out'` and `completedAt` is set.
**TS-17b** — Given the same expired-lease run is fetched a second time → run is already terminal, no re-transition occurs.

---

### 3.5 Step Output Caching

**R-27** — The system SHALL compute a cache key for each step as the SHA-256 hash of the tuple: `{ inputHash, pipelineId, pipelineConfigVersion, stepId, promptKey, promptVersion }`.

**R-28** — WHEN a step Lambda is about to execute, THE system SHALL check DDB for an existing cache entry matching the step's cache key; IF one exists, THE system SHALL skip the LLM call and use the cached output verbatim.

**R-29** — WHEN a prompt is updated (a new prompt version is written), THE system SHALL increment the `promptVersion` field, which invalidates the cache key for any step referencing that `promptKey`.

**R-30** — WHEN a pipeline config is updated, THE system SHALL increment `pipelineConfigVersion`, which invalidates cache keys for all steps in that pipeline.

**TS-18** — Given step A with a cache hit on its full cache key → LLM is NOT called, cached output is used, step is marked `status: 'cached'`.
**TS-19** — Given a prompt is updated → prompt version increments → cache key for steps referencing that prompt no longer matches prior cache entries.

---

### 3.6 Prompt Management

**R-31** — The system SHALL store prompts as DynamoDB items with key `PROMPT#<promptKey>`, containing: `promptKey`, `currentVersion`, `body` (for prompts ≤ 64 KB), `s3Ref` (for prompts > 64 KB), `createdAt`, `updatedAt`.

**R-32** — WHEN a prompt is updated via `PUT /prompts/{promptKey}`, THE system SHALL create a new version record (`PROMPT_VERSION#<promptKey>#<version>`) and increment `currentVersion` on the parent item rather than overwriting the previous body.

**R-33** — IF a `DELETE /prompts/{promptKey}/versions/{version}` request is received for a version that is referenced by any cached run output or active pipeline step, THE system SHALL reject the request with HTTP 409.

**R-34** — WHERE a prompt body exceeds 64 KB, THE system SHALL store the body in S3 and store only the S3 key reference (`s3Ref`) in DDB.

**R-52** — `DELETE /prompts/{promptKey}` SHALL set `active: false` on the prompt header item rather than deleting it. Soft-deleted prompts SHALL NOT appear in `GET /prompts` list responses. WHEN a pipeline configuration is written (created or updated), IF any step references a `promptKey` whose prompt header has `active: false`, THE system SHALL reject the request with HTTP 422.

**TS-20** — Given `PUT /prompts/my-prompt` with new body → `currentVersion` increments, new version record exists in DDB.
**TS-21** — Given a prompt version referenced by an active pipeline step → DELETE version → HTTP 409.
**TS-34** — Given DELETE `/prompts/{promptKey}` → PRMPT item has `active: false`; subsequent GET `/prompts` does not include that prompt.
**TS-35** — Given a pipeline where one step's `promptKey` points to a soft-deleted prompt → POST or PUT `/pipelines` → HTTP 422.

---

### 3.7 API Surface

**R-35** — The system SHALL expose the following new API routes, all gated behind the existing writer Cognito group authorizer:
  - `GET /pipelines` — list all pipeline items (id, name, stepCount, active, version, updatedAt)
  - `POST /pipelines` — create a pipeline config (returns HTTP 422 if any step model is not in the allowlist, if `maxSteps` is exceeded, or if any `promptKey` does not resolve)
  - `GET /pipelines/{pipelineId}` — read full pipeline config
  - `PUT /pipelines/{pipelineId}` — update pipeline config (bumps version; same 422 validations as POST)
  - `DELETE /pipelines/{pipelineId}` — soft-delete pipeline
  - `GET /prompts` — list all prompts (promptKey, currentVersion, updatedAt, usedByPipelines)
  - `POST /prompts` — create a prompt
  - `GET /prompts/{promptKey}` — read current prompt version
  - `PUT /prompts/{promptKey}` — update prompt body (creates new version)
  - `DELETE /prompts/{promptKey}` — soft-delete prompt (sets `active: false`; returns HTTP 422 if referenced by any active pipeline step)
  - `GET /prompts/{promptKey}/versions` — list all version records for a prompt

**R-36** — WHEN any writer-gated route is called by a Cognito identity that is NOT in the writer group, THE system SHALL return HTTP 403.

**R-37** — `GET /pipelines` and `GET /prompts` SHALL return paginated responses using the existing DynamoDB pagination pattern (LastEvaluatedKey → `nextToken`).

**TS-22** — Given a non-writer token → `POST /pipelines` → HTTP 403.
**TS-23** — Given 15 pipelines in DDB → `GET /pipelines` with default page size → response includes `nextToken` for the second page.

---

### 3.8 SPA — Pipeline and Prompt CRUD

**R-38** — WHERE the authenticated user is in the writer group, THE SPA SHALL render a "Pipelines" section in the Source Pipeline sidebar area that lists all active pipelines with name, step count, and last-modified date.

**R-39** — WHEN a writer views a pipeline step, THE SPA SHALL show inline: the step's label, model, and the linked prompt body (current version). The step editor SHALL allow the writer to view the full current prompt text, create a new prompt without leaving the pipeline editor, and swap which prompt the step references. The full ordered step list SHALL include controls to add, remove, and reorder steps.

**R-40** — WHEN a writer saves changes to a pipeline, THE SPA SHALL call `PUT /pipelines/{pipelineId}` and show an inline validation error if the server returns HTTP 422 (e.g. `maxSteps` exceeded or unrecognized model ID).

**R-41** — WHERE the authenticated user is in the writer group, THE SPA SHALL render a "Prompts" section that lists prompts with promptKey, current version number, and last-modified date.

**R-42** — WHEN a writer opens a prompt for editing, THE SPA SHALL display a textarea with the current prompt body and a version history list showing prior version numbers and timestamps.

**R-43** — WHEN a writer saves a prompt, THE SPA SHALL call `PUT /prompts/{promptKey}`, and on success, update the displayed version number to reflect the new `currentVersion`.

**R-44** — WHERE the authenticated user is NOT in the writer group, THE SPA SHALL render pipelines and prompts as read-only (no create, edit, or delete controls visible).

**R-53** — The SPA SHALL include a Prompts archive page that lists all active prompts with `promptKey`, current version number, and last-modified date. Clicking a prompt SHALL display its full version history (version number, timestamp per version; body diff is out of scope for v1). Soft-deleted prompts SHALL NOT appear on this page.

**R-54** — WHEN a user navigates to a pipeline run, THE SPA SHALL render a visual step flow showing each step in order with: a step label and status indicator (`running` / `completed` / `cached` / `failed` / `warning`). WHEN a step is clicked or expanded, THE SPA SHALL show: input context summary, raw output string, and all metrics (`durationMs`, `bedrockLatencyMs`, `inputTokens`, `outputTokens`, `costEstimateUsd`, `inputCharacters`, `outputCharacters`). IF a step failed, THE SPA SHALL display the sanitized `errorMessage` and `errorStack`. WHILE the run is in a non-terminal state, THE SPA SHALL poll and update step statuses in real time.

**TS-24** — Given writer session → Pipelines section renders with "New Pipeline" button.
**TS-25** — Given non-writer session → Pipelines section renders without "New Pipeline" button; no edit controls visible.
**TS-26** — Given `PUT /pipelines/{id}` returns HTTP 422 → SPA displays inline error message, form stays open.
**TS-36** — Given writer session → /prompts page lists active prompts; soft-deleted prompts do not appear.
**TS-37** — Given a completed pipeline run with step metrics set → run detail page renders step flow; expanding a completed step shows `durationMs`, `costEstimateUsd`, `inputTokens`, and `outputTokens`.
**TS-38** — Given a running pipeline run → run detail page polls and updates step status indicators until the run reaches a terminal state.

---

## 4. Non-Functional Requirements

- **Performance:** Step Lambda cold start must not prevent the first LLM call from beginning within 10 seconds of the API response. The read Lambda's lazy lease-expiry check must add no more than 50 ms to a `GET /runs/{runId}` response.
- **Security:** All pipeline and prompt mutation routes require writer-group Cognito membership. LLM outputs written to S3 follow the existing bucket policy; no raw prompt text is logged to CloudWatch.
- **Scale:** A single pipeline run processes one requirement set; per-requirement parallelism is out of scope (see `parallel-llm-generation`). Up to 20 concurrent pipeline runs is the v1 operating target.
- **Durability:** Step outputs are written to S3/DDB before the next step Lambda is invoked, so a step Lambda crash after writing does not lose output.

## 5. Edge Cases

| Condition | Expected Behaviour |
|---|---|
| Pipeline config updated while a run is in flight | Run continues with the config version it started with; new version applies to future runs only |
| All steps in pipeline are `optional: true` and all fail | Run completes with `status: 'completed_with_warnings'`, no steps produced usable output |
| Prompt body update > 64 KB | Body stored in S3, `s3Ref` set on DDB item; step Lambda fetches from S3 at execution time |
| Step Lambda catches a Bedrock throttle error | Lambda re-leases and retries internally; run remains `running` until retries succeed or are exhausted |
| Step Lambda exhausts all retries on a transient error | Lambda reclassifies as terminal, marks step/run `failed` with final error details |
| Step Lambda times out at Lambda-level (OOM/process kill, no catch) | Lease on the step record expires unrenewed; the next `GET /runs/{runId}` call detects the expired lease and marks run `timed_out` |
| `pipelineId` in run request does not exist or `active: false` | POST returns HTTP 422 with message indicating pipeline not found or inactive |
| Two concurrent step Lambdas race to write the same step output (duplicate async invocation) | Cache key deduplicates: second invocation finds cache hit and returns without LLM call or overwrite |
| Step with `includeContext: false` | Only the original grounded context is injected; no prior step outputs are passed to the LLM |
| Step with `waitForHuman: true` in v1 | Warning is logged; step executes immediately as if `waitForHuman` is `false` |

## 6. Acceptance Criteria

- [ ] A pipeline can be created, updated, and soft-deleted via API without a code deploy
- [ ] A multi-step pipeline runs end-to-end for a single requirement and produces a `completed` run record
- [ ] Changing a prompt creates a new version and invalidates the step cache for that prompt
- [ ] An optional step that fails leaves the run in `completed_with_warnings`, not `failed`
- [ ] A run whose active step lease has expired is marked `timed_out` lazily on the next `GET /runs/{runId}` call
- [ ] A run where any non-optional step fails is immediately marked `failed` with error details
- [ ] All mutation routes return HTTP 403 for non-writer tokens
- [ ] A cached step (identical cache key) skips the LLM call and returns prior output
- [ ] SPA renders pipeline list, step editor, and prompt editor for writer users; read-only view for non-writers
- [ ] `maxSteps > 20` is rejected at API level with HTTP 422
- [ ] A step with `includeContext: false` receives only the grounded context in its LLM call
- [ ] A step with `waitForHuman: true` logs a warning and executes normally in v1
- [ ] A pipeline write with an unrecognized model ID is rejected with HTTP 422
- [ ] Each completed step record has `contextTokenEstimate` and `outputTokens` set

## 7. Open Questions

All open questions from v0.1.0 have been resolved:

- **Q1 (model allowlist format):** Closed — `step.model` is validated against a configurable allowlist stored as a system config value in DynamoDB. New models can be added without a code change. HTTP 422 on unknown model.
- **Q3 (lease duration):** Closed — default lease duration is 5 minutes, a single value applied per step. Making it configurable per step is deferred as a follow-on.

## 8. Decisions Log

**D-1 — Async Lambda chain, not SQS.**
- **Decision:** Use `InvocationType: 'Event'` Lambda-to-Lambda invocations; DynamoDB is the state store.
- **Reason:** Simpler operational model for v1; no SQS queue provisioning, no DLQ plumbing needed; watchdog covers timeout cases.
- **Affects:** R-17, R-18, R-19, R-21, R-24

**D-2 — Steps are generic, not typed roles.**
- **Decision:** Steps are composable units defined by a `label`, `model`, and `promptKey`. There are no predefined roles (`generate`, `adversarial`, `refine`, `review`) and no TypeScript-typed input/output contracts. The experiment author defines step meaning through prompt design.
- **Reason:** Typed roles constrain experimentation and require code changes to add or rename a role. Generic steps let authors freely compose pipelines without code involvement.
- **Affects:** R-11, R-15, R-16

**D-3 — Context accumulation is structured and opt-out per step.**
- **Decision:** Prior step outputs are passed as `[{ stepId, label, output }]` so both the step Lambda and the SPA can identify what each step produced. `includeContext: false` allows a step to reset the context (receive only the original grounded context).
- **Reason:** Structured prior outputs make the chain's data flow inspectable in the SPA and debuggable in logs. Opt-out per step supports independent steps (e.g. a secondary analysis that should not be influenced by prior outputs).
- **Affects:** R-12

**D-4 — Optional step failures record as `warning`, not `failed`.**
- **Decision:** An optional step that reaches a terminal error records `status: 'warning'` on the run record; execution continues.
- **Reason:** Allows non-critical enrichment steps to fail without blocking delivery of outputs from earlier steps.
- **Affects:** R-15

**D-5 — DAG deferred to follow-on.**
- **Decision:** v1 is linear chain only; `dependsOn` field is reserved in the schema but not evaluated.
- **Reason:** No concrete parallel use case has been identified yet; adding DAG evaluation adds significant complexity.
- **Affects:** R-02 (schema), out-of-scope statement

**D-6 — Cache key includes pipelineConfigVersion.**
- **Decision:** The cache key includes the pipeline config version so that reordering steps or changing a step's model/promptKey busts the cache for all downstream steps.
- **Reason:** Prevents stale outputs from a prior config being silently reused after a pipeline edit.
- **Affects:** R-27, R-30

**D-7 — Lease expiry detected lazily by the read Lambda, not by a background watchdog.**
- **Decision:** There is no scheduled watchdog Lambda. The read Lambda (`GET /runs/{runId}`) inspects step `leaseExpiresAt` on every fetch; if a lease is expired and the run is non-terminal, the read Lambda performs the `timed_out` transition inline.
- **Reason:** Eliminates an entire Lambda + CloudWatch Events schedule; expiry detection happens exactly when the caller needs it (status UI fetch). Hard crash and OOM cases are handled because the lease simply expires and the next read detects it.
- **Affects:** R-24, R-25, R-26-loop

**D-8 — Step Lambda owns transient-vs-terminal failure classification.**
- **Decision:** Caught errors are not automatically terminal. The step Lambda classifies each error as transient (re-lease and retry) or terminal (mark failed and stop). Only when it gives up does it write the `failed` status.
- **Reason:** Error categories are call-specific — a Bedrock throttle is retryable, a malformed prompt is not. Centralising this decision in the Lambda keeps the error handling policy co-located with the code that understands the error.
- **Affects:** R-21a, R-21b, R-21c, R-24
