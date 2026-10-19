# Requirements — Configurable LLM Pipeline

> **Version:** 0.6.0
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

**R-02** — Each step in `steps` SHALL contain: `stepId` (unique within pipeline), `label` (human-readable name), `model` (Bedrock model ID, validated against the model allowlist defined in R-10), `promptKey` (reference to a `PROMPT#` item), `optional` (boolean, default `false`), `waitForHuman` (boolean, default `false`), `includeContext` (boolean, default `true`), and `outputType` (`"plan"` | `"critique"` | `"freeform"`, default `"plan"` — added v0.4.0, see R-59/D-22).

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

**R-11** — A pipeline step is a generic unit defined solely by its fields from R-02. Steps have no predefined roles or structural constraints beyond those fields. (v0.4.0: steps declare an `outputType` that selects the output contract — see R-59, D-22.) The experiment author defines the step's purpose through `label` and the referenced prompt.

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

**R-38** — WHERE the authenticated user is in the writer group, THE SPA SHALL render a "Pipelines" section in the Experiments sidebar area (v0.4.0, R-69) that lists all active pipelines with name, step count, and last-modified date.

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

### 3.9 Grounding-Aware Sampling (v0.4.0)

> Added after the first live runs: sampling drew from the whole catalog, so runs routinely landed on requirements that cannot be grounded (R-121 skip reasons in `@registry/functest/ground.ts`) and failed with `Grounding failed: references no cataloged entity`.

**R-55** — WHEN `POST /generate-functional-tests` is called with a `pipelineId`, THE system SHALL ground every catalog requirement (using the same `ground()` rules as the legacy generator) BEFORE applying the sampling strategy, and the sampling strategy SHALL select only from requirements that ground successfully. The `202` response SHALL include `skipped: [{ requirement: "<source>/<id>", reason: string }]` listing every requirement excluded by grounding. For the `ids` strategy, `skipped` lists only the named entries that were excluded (ungroundable, or `"not found in catalog"`); for other strategies it lists every ungroundable catalog requirement.

**R-56** — IF the sampling strategy selects no groundable requirement (because nothing in the catalog grounds, none of the `ids` entries ground, or the strategy selects zero items, e.g. `first_n: 0`), THE system SHALL return HTTP 422 with `{ error, skipped }` and SHALL NOT create any PRUN record.

**R-57** — Requirement identifiers on `PRUN.requirementIds`, in sampling input, and in `skipped` SHALL be source-qualified as `<source>/<id>` (requirement IDs are only unique within a source). The step worker SHALL resolve a requirement by its qualified ID. FOR runs created before v0.4.0 holding a bare ID, the worker SHALL accept the bare ID only if it matches exactly one catalog requirement; otherwise it SHALL fail the step with an ambiguity error.

**R-58** — WHERE `sampling.strategy` is `ids`, each entry MAY be qualified or bare; a bare ID that matches more than one source's requirement SHALL be rejected with HTTP 422 naming the candidates.

**TS-39** — Given a catalog with 5 requirements of which 2 reference no cataloged entity, and `first_n: 3` → 3 runs are created, all for groundable requirements; the response `skipped` lists the 2 ungroundable requirements with reasons.
**TS-40** — Given a catalog where no requirement grounds → HTTP 422 with `skipped` populated; no PRUN written.
**TS-41** — Given `publisher/R-01` and `consumer/R-01` both groundable and `ids: ["consumer/R-01"]` → the run's `requirementIds` is `["consumer/R-01"]` and the step worker grounds the consumer requirement.
**TS-42** — Given `ids: ["R-01"]` where `R-01` exists in two sources → HTTP 422 naming both qualified candidates.

### 3.10 Step Output Types and Plan Fidelity (v0.4.0)

**R-59** — Each pipeline step SHALL carry an `outputType` field: `"plan"` | `"critique"` | `"freeform"` (default `"plan"`; steps persisted before v0.4.0 without the field SHALL be read as `"plan"`). This amends R-02 and R-11 (see D-22).

**R-60** — WHEN a step executes, THE system SHALL shape the Bedrock call by `outputType`:
- `plan` — forced tool use of `emit_functional_test_plan` with `PLAN_SCHEMA` v2 (R-61);
- `critique` — forced tool use of `emit_critique` with `CRITIQUE_SCHEMA` (R-62);
- `freeform` — no tools; the concatenated text content blocks are the step output.

**R-61** — `PLAN_SCHEMA` v2 SHALL extend the v1 plan (all v1 fields retained, so v1 plans remain valid) with:
- `rationale` (required string) — why this scenario exercises the requirement;
- `trigger.examplePayload` (optional string) — a concrete JSON example body built only from contract schema properties;
- `propagation.kind` widened to `"cdc" | "eventbridge" | "sync"`, plus optional `propagation.channel` (e.g. event bus / detail-type);
- `assertions[].service` widened from the `publisher | consumer` enum to any string, validated at runtime against the grounded `sources` (R-64);
- optional `assertions[].field` and `assertions[].expected` for property-level checks;
- optional `negativeCases: [{ description, expectedOutcome }]`.

**R-62** — `CRITIQUE_SCHEMA` SHALL be `{ verdict: "approve" | "revise" | "reject", summary: string, issues: [{ severity: "blocker" | "major" | "minor", target: string, problem: string, suggestion: string }] }`.

**R-63** — WHEN prior step outputs are injected (R-12), THE system SHALL include each output in full, subject to a total budget `PRIOR_OUTPUT_BUDGET_CHARS` (system constant, default 60 000). IF the budget is exceeded, THE system SHALL truncate the OLDEST outputs first, mark each truncated output with an explicit `[truncated N chars]` suffix, and set `priorOutputsTruncated: true` on the step record. This supersedes the fixed 2 000-character per-output cut.

**R-64** — WHEN a `plan` step returns, THE system SHALL validate the output against `PLAN_SCHEMA` v2 AND its grounding (trigger entity = grounded entity; trigger source and every assertion service ∈ grounded sources). IF validation fails, THE system SHALL treat it as a terminal (non-retryable) step error whose message is the validation reason; R-15/R-16 then apply. `critique` outputs SHALL be validated against `CRITIQUE_SCHEMA` the same way.

**R-65** — WHEN a run reaches `completed` or `completed_with_warnings`, THE system SHALL take the output of the LAST step with `outputType: "plan"` whose status is `completed` or `cached`, render it with the functional-test emitter, store it at `pipeline-outputs/<runId>/test.generated.ts`, and set `PRUN.artifact = { stepId, s3Key, path }`. IF no plan step produced output, THE system SHALL append the warning `"no plan output to emit"` to `PRUN.warnings` and leave `artifact` unset. Artifact warnings (including `"artifact emit failed: …"`) do not change the run's terminal status, which is derived from step outcomes only. `GET /runs/{runId}/artifact` SHALL return `{ path, content }` (404 if unset).

**R-66** — The functional-test emitter SHALL derive base-URL and token environment variable names from the grounded `apiTargets` (per source) rather than hardcoding `PUBLISHER_*` / `CONSUMER_*` (a source with no API target, e.g. an EventBridge-only trigger source, gets derived `<SOURCE>_API_URL` / `<SOURCE>_TOKEN` names), and SHALL render `rationale`, `examplePayload`, `negativeCases`, and property-level assertions when present. Output for a v1 plan (no new fields) whose sources are `publisher`/`consumer` SHALL be unchanged.

**TS-43** — Given a step with `outputType: "critique"` → the Bedrock request forces tool `emit_critique`; the stored output parses against `CRITIQUE_SCHEMA`.
**TS-44** — Given a step with `outputType: "freeform"` → the Bedrock request has no `tools`/`tool_choice`; the stored output is the response text.
**TS-45** — Given a pipeline item with no `outputType` on its steps → the worker treats every step as `plan`.
**TS-46** — Given two prior outputs of 50 000 chars each → the oldest is truncated with a `[truncated N chars]` marker, the newest is intact, and `priorOutputsTruncated` is `true`.
**TS-47** — Given a plan step whose output names an assertion service not in the grounded sources → the step fails terminally with a "hallucinated target" message.
**TS-48** — Given a 2-step run (plan → critique) that completes → `PRUN.artifact.s3Key` is `pipeline-outputs/<runId>/test.generated.ts` and the file was rendered from step 1's plan.
**TS-49** — Given a run whose only plan step was optional and failed → `PRUN.warnings` contains `"no plan output to emit"` and `artifact` is unset.
**TS-50** — Given a grounded `TaskPublished` context with sources `get-ready`, `create-evb` → the emitted file reads `GET_READY_API_URL` / `GET_READY_TOKEN` and does not reference `PUBLISHER_API_URL`.

### 3.11 SPA Amendments (v0.4.0)

**R-67** — The pipeline step editor SHALL be a single shared component used by both the pipeline side panel (`/pipelines`) and the full pipeline page (`/pipelines/:pipelineId`). In both views it SHALL offer "View prompt body" (R-39) and an `outputType` selector.

**R-68** — The pipeline side panel and the full pipeline page (step list | selected-step detail) SHALL use a shared resizable split pane that: responds to pointer (mouse, touch, pen) drag on a divider with a hit area of at least 8 px; starts from the pane's measured rendered width (no jump on first drag); clamps to one set of bounds (min 320 px, max 70 vw); supports keyboard resizing (arrow keys, `role="separator"`, `aria-valuenow`); and persists width per pane in `localStorage`.

**R-69** — The sidebar SHALL be organised into two areas: **Catalog** (renamed from "Source Pipeline": contracts by entity, contracts by source, requirements, crawl refresh) and **Experiments** (Pipelines, Prompts, Runs, Compare runs). The legacy prompt-versioning pages (Prompt versions, single-step experiments, experiment compare) SHALL appear under a collapsed **Legacy** group labelled deprecated. This supersedes the area placement in R-38 and R-41.

**R-70** — The SPA SHALL provide a **Compare runs** page (`/runs/compare?a=<runId>&b=<runId>`) that shows two runs side by side: per-step label/model/prompt version/status, metrics, raw output, and a line diff of the two emitted test artifacts (R-65) where both exist.

**R-71** — WHEN a writer triggers a run, THE SPA SHALL display the `skipped` requirements (R-55) returned by the API — on the run detail page it navigates to (passed via router state), or inline on the trigger page when the API returns 422 and no run exists. WHEN a run has an `artifact`, the run detail page SHALL render the emitted test file with copy and download controls.

**R-72** — `POST /prompts/import-legacy` (writer-only) SHALL copy each legacy prompt-version record (`/prompt-versions`) into the prompt store as `promptKey: "legacy-<promptVersion>"` (version 1, body = legacy `text`), skipping keys that already exist (idempotent), and return `{ imported: string[], skipped: string[] }`. The Prompts page SHALL expose an "Import legacy prompt versions" action for writers. Legacy `/prompt-versions` and `/experiments` endpoints remain available and unchanged (see D-27).

**TS-51** — Given the full pipeline page with a step that has a `promptKey` → a "View prompt body" control renders and reveals the prompt text.
**TS-52** — Given the split pane, a pointer drag of −100 px on the divider → the panel width increases by 100 px from its measured width and is written to `localStorage`; a remount restores it.
**TS-53** — Given the split pane focused divider → ArrowLeft increases panel width; width never exceeds 70 vw or drops below 320 px.
**TS-54** — Given an authenticated session → the sidebar shows "Catalog" and "Experiments" areas; "Pipelines", "Prompts", "Runs", "Compare runs" are under Experiments; "Source Pipeline" text is absent.
**TS-55** — Given two completed runs with artifacts → the compare page renders both step columns and a diff of the artifacts.
**TS-56** — Given a run trigger response with 2 `skipped` entries → the SPA lists both requirements with reasons.
**TS-57** — Given 2 legacy prompt versions, one already imported → `POST /prompts/import-legacy` returns `imported` of length 1 and `skipped` of length 1; repeating returns `imported: []`.

---

### 3.12 Step Transparency (v0.5.0)

> Added because the run detail page showed only raw output JSON and metrics: the input sent to the model was never persisted, prompt version and output type were not shown, S3-stored outputs could not be viewed, and output-format guidance depended entirely on the prompt author (the seeded default prompt asks for TypeScript while the runtime forces the plan tool; that prompt is kept as the baseline — see R-78).

**R-73** — WHEN a step executes AND the step has `outputInstructions: true` (a new optional boolean step field, default `false`), THE system SHALL append an **Output instructions** section to the user message, generated by the runtime from the step's `outputType` (not stored in, or interpolated into, the prompt body — R-12 still holds):
- `plan` with no prior completed plan output in the injected context — instructs the model to produce one grounded cross-service test plan via `emit_functional_test_plan`, describing each plan field briefly;
- `plan` with a prior plan output in the injected context — instructs the model to produce a revised plan that addresses any critique among the prior outputs;
- `critique` — instructs the model to review the most recent prior plan against the requirement, contract schema, and API targets, and report via `emit_critique`;
- `freeform` — no section is appended.
The instruction texts are code constants versioned by `OUTPUT_INSTRUCTIONS_VERSION`; WHEN instructions are on, that version SHALL be part of the step cache key (amends R-27). WHEN `outputInstructions` is absent or `false`, the user message and cache key SHALL be identical to pre-v0.5.0, so baseline steps receive exactly the original input.

**R-79** — The legacy single-step generator (`generateFunctionalPlans`, used by `POST /generate-functional-tests` without a `pipelineId` and by `/experiments`) SHALL use the original v1 plan schema (`PLAN_SCHEMA_V1`, exactly as before v0.4.0) for both its forced tool and its validation, including cached plans. `PLAN_SCHEMA_V2` (R-61) applies only to pipeline `plan` steps. This keeps legacy experiment results comparable with prior baselines.

**R-74** — WHEN a step has assembled its input (after grounding, prior-output assembly, and R-73), THE system SHALL write an input snapshot to S3 at `pipeline-outputs/<runId>/<stepIndex 2-digit>.input.json` BEFORE the cache lookup and Bedrock call, and set `inputRef: { s3Key }` on the step record. The snapshot SHALL contain: `model`, `outputType`, `systemPrompt: { promptKey, version, body }`, `userMessage` (exact string sent), `sections: [{ name, text }]` (the user message split into its named parts — Requirement, Entity, Contract schema, API targets, Prior step outputs, Output instructions), `tool: { name, schemaVersion } | null`, `priorOutputsTruncated`, and `instructionsVersion`. Snapshot write failure SHALL be logged and SHALL NOT fail the step. Failed and cached steps therefore also have snapshots.

**R-75** — `GET /runs/{runId}/steps/{stepIndex}` (readers) SHALL return `{ step, input, output }` where `step` is the step record, `input` is the parsed snapshot or `null` if absent (pre-v0.5.0 steps), and `output` is the step output string resolved from inline or S3 (or `null`). Unknown run or step → 404.

**R-76** — The run detail page SHALL show, per step header: label, model, `outputType`, `promptKey@version` (linking to the prompt page), status, and a "cached" indicator when the output came from the step cache.

**R-77** — WHEN a step is expanded, THE SPA SHALL fetch R-75 and present tabs:
- **Output** — rendered by output type: `plan` as labelled sections (rationale, setup, trigger with example payload, propagation, assertions, negative cases); `critique` as a verdict badge, summary, and an issues table (severity, target, problem, suggestion); `freeform` as preformatted text. Unparseable output falls back to raw text with a notice.
- **Input** — the system prompt (key, version, body) and each user-message section as a collapsible block, with a notice when `priorOutputsTruncated`; "Input not recorded" for steps without a snapshot.
- **Changes** — for a `plan` step with an earlier completed `plan` step in the same run, a field-level diff (added / removed / changed per plan field and per list item) against that earlier plan; otherwise hidden.
- **Raw** — the raw output string (this replaces "Output stored in S3 — retrieve via artifacts bucket").
- **Metrics** — as today, plus `priorOutputsTruncated`.
Errors (`errorMessage`, `errorStack`) remain visible above the tabs for failed / warning steps.

**R-78** — _Withdrawn (v0.5.0)._ The seeded prompts (`functional-test-gen-default`, legacy v1) are the experiment baseline and SHALL NOT be changed by this amendment, even where their wording conflicts with the runtime output contract — that conflict is part of what experiments measure against.

**TS-58** — Given a `critique` step with `outputInstructions: true` after a plan step → the user message ends with an "Output instructions" section that refers to reviewing the prior plan; given a `freeform` step → no such section.
**TS-59** — Given a `plan` step whose prior outputs include a plan → the instructions are the "revise" variant.
**TS-60a** — Given a step without `outputInstructions` → the user message has no Output instructions section and the cache key equals the pre-v0.5.0 key.
**TS-60b** — Given the legacy generator → its Bedrock request's tool `input_schema` deep-equals `PLAN_SCHEMA_V1`; emitted legacy files match the golden fixtures.
**TS-60** — Given `OUTPUT_INSTRUCTIONS_VERSION` changes → the step cache key changes.
**TS-61** — Given a step executes → an S3 PutObject to `pipeline-outputs/<runId>/<nn>.input.json` happens before the Bedrock call, its JSON has all R-74 fields, and the step record has `inputRef`.
**TS-62** — Given the snapshot PutObject throws → the step still completes.
**TS-63** — Given a step whose output is in S3 → `GET /runs/{runId}/steps/{i}` returns the S3 content in `output`; given a pre-v0.5.0 step → `input: null`.
**TS-64** — Given an expanded plan step → the Output tab renders the trigger path and each assertion; the Input tab renders the system prompt body and a "Contract schema" section.
**TS-65** — Given a critique output with 2 issues → verdict badge and a 2-row issues table render.
**TS-66** — Given two plan steps whose assertions differ by one item → the Changes tab on the second shows one added/removed assertion.
**TS-67** — Given a step without `inputRef` → the Input tab shows "Input not recorded".

---

### 3.13 Unified Experiments (v0.6.0)

> Pipelines and the legacy prompt-versioning feature are the same activity at different granularity: a legacy experiment is one prompt version applied to every groundable requirement — i.e. one trigger of a single-step pipeline with `sampling: all`. v0.4.0–v0.5.0 left them as parallel nav areas with duplicate Prompts / Run / Compare pages, and pipelines had no record grouping the runs of one trigger, so they could only be compared run-by-run.

**R-80** — WHEN `POST /generate-functional-tests` is called with a `pipelineId`, THE system SHALL write a pipeline experiment record `PEXP#<experimentId> / PEXP` containing: `experimentId`, `kind: "PEXP"`, `pipelineId`, `pipelineName`, `pipelineConfigVersion`, `sampling`, `mode`, `runs: [{ runId, requirementIds }]`, `skipped`, `createdAt`, `startedAt` (= `createdAt`, so the `byKind` GSI indexes it), `createdBy`. Every PRUN created by that call SHALL carry `experimentId`. The `202` body SHALL add `experimentId`.

**R-81** — WHEN the request body includes `dryRun: true`, THE system SHALL perform grounding and sampling (R-55 – R-58) and return `200 { selected: string[], skipped }` without writing any record or dispatching any step. An empty selection is returned as `200` with `selected: []` (the R-56 422 applies only to real triggers).

**R-82** — `GET /experiment-index` (readers) SHALL return both pipeline experiments and legacy experiments, newest first, normalised to `{ id, kind: "pipeline" | "legacy", label, createdAt, status, requirementCount, resultCount, skipCount }`, where for pipeline experiments `label` is `<pipelineName> v<pipelineConfigVersion>` and `status` is aggregated from its runs (`running` if any run is non-terminal; else `failed` if all failed; else `completed_with_warnings` if any run failed or warned; else `completed`; `timed_out` counts as failed; a listed run whose PRUN does not exist counts as non-terminal), with `requirementCount` = selected requirements, `resultCount` = runs with an artifact, `skipCount` = `skipped.length`; for legacy experiments `requirementCount` = `planCount + skipCount`, `resultCount` = `planCount`, and `label` is the prompt version and the remaining fields map from the `EXPERIMENT` record.

**R-83** — `GET /experiment-results/{kind}/{id}` (readers) SHALL return `{ experiment, results: [{ requirementId, runId?, status, plan, testFile }], skipped }` normalised across kinds: for `pipeline`, one entry per run with `plan` = the parsed output of the run's last completed `plan` step (or `null`) and `testFile` = the run artifact `{ path, content }` (or `null`); for `legacy`, one entry per manifest plan (matched to its emitted file) from the experiment artifact. `requirementId` SHALL be source-qualified (R-57); legacy plans' `requirementIds[0]` SHALL be qualified using the experiment's catalog context where the bare ID is unambiguous. Unknown kind or id → 404.

**R-84** — A pipeline step MAY set `planSchema: "v1" | "v2"` (default `"v2"`), meaningful only for `outputType: "plan"`. WHEN `planSchema` is `"v1"`, THE system SHALL use `PLAN_SCHEMA_V1` for the forced tool and `validatePlanV1` for validation, and the run artifact SHALL be emitted with the legacy emitter options (no `apiTargets`), so the step reproduces the legacy generator's request and output format exactly (given `includeContext: false`, `outputInstructions` off, and the same system prompt and model).

**R-85** — The seeder SHALL idempotently create (never overwrite): the prompt `legacy-v1` imported from legacy prompt version `v1` (via the R-72 import path), and a pipeline `baseline-legacy-v1` named "Baseline (legacy v1)" with one step `{ stepId: "plan", label: "Legacy v1 plan", model: <legacy v1 modelId>, promptKey: "legacy-v1", outputType: "plan", planSchema: "v1", includeContext: false, optional: false, waitForHuman: false }` (no `outputInstructions`), `defaultSampling: { strategy: "all" }`, `defaultMode: "per_requirement"`. Existing seeded prompts are untouched (R-78).

**R-86** — `POST /prompts/import-legacy` SHALL accept an optional body `{ promptVersions: string[] }`; when present only those versions are imported (same idempotency and response). Absent body keeps R-72 behaviour.

**R-87** — The SPA Experiments area SHALL contain, in order: **Experiments**, **Pipelines**, **Prompts**, **Compare**. The Legacy nav group (R-69) is removed; legacy routes remain reachable by URL and redirect to their unified equivalents where one exists.

**R-88** — The **Experiments** page SHALL list `GET /experiment-index` entries with a kind badge (`pipeline` / `legacy`), label, created date, status, and counts; selecting a pipeline experiment shows its runs (requirement, status, link to run detail) and skipped list; selecting a legacy experiment shows its plans and skips read-only. A **New experiment** action SHALL let a writer pick a pipeline and optionally override sampling and mode, call the dry run (R-81), show the selected count and skipped list, and require explicit confirmation when the selected count exceeds 20 before triggering.

**R-89** — The **Prompts** page SHALL list pipeline prompts and legacy prompt versions together; legacy entries show a `legacy` badge, their model, and an "Import" action (R-86); once imported, a version is shown as its `legacy-<promptVersion>` prompt row (with the legacy badge) rather than as a separate row. The step editor's prompt picker SHALL offer un-imported legacy versions in a separate group; choosing one imports it and selects `legacy-<promptVersion>`.

**R-90** — The **Compare** page SHALL compare any two experiments of either kind (`/compare?a=<kind>:<id>&b=<kind>:<id>`) using R-83: a per-requirement table (requirement, status A, status B), with each row expandable to show the two plans side by side (rendered as in R-77), the plan field diff, and the test-file line diff; requirements present in only one experiment, or skipped in one, are listed separately. Each pipeline result links to its run detail. The v0.4.0 run-level compare (`/runs/compare`) remains, linked from expanded rows when both sides are pipeline runs.

**R-91** — The legacy experiment runner (`POST /experiments`) SHALL remain deployed and functional but SHALL NOT be offered in the SPA navigation; the Experiments page MAY expose it only as a secondary "Run legacy experiment (deprecated)" action until the baseline pipeline has been verified to reproduce legacy output (see Q5), after which that action is removed.

**TS-68** — Given a pipeline trigger with 3 selected requirements → one PEXP record with 3 `runs` entries; each PRUN has `experimentId`; the 202 includes `experimentId`.
**TS-69** — Given `dryRun: true` → 200 with `selected` and `skipped`; no PutCommand and no Lambda invoke.
**TS-70** — Given one legacy experiment and one pipeline experiment whose runs are `completed` and `failed` → `GET /experiment-index` returns both, newest first, the pipeline one with `status: "completed_with_warnings"`.
**TS-71** — Given a pipeline experiment with a run whose last plan step completed and has an artifact → `GET /experiment-results/pipeline/<id>` returns that plan and test file; given a legacy experiment artifact with 2 plans → 2 results with matching files.
**TS-72** — Given a step with `planSchema: "v1"`, no prior outputs, `outputInstructions` absent → the Bedrock request body's `system`, `messages`, `tools` and `tool_choice` deep-equal those produced by the legacy `createBedrockClient` for the same context, prompt text, and model.
**TS-73** — Given a `planSchema: "v1"` step returning a plan with `propagation.kind: "eventbridge"` → terminal validation failure (v1 rejects it).
**TS-74** — Given an empty table → seeding creates `legacy-v1` and `baseline-legacy-v1`; seeding twice writes nothing new; an existing `baseline-legacy-v1` is not overwritten.
**TS-75** — Given `POST /prompts/import-legacy` with `{ promptVersions: ["v2"] }` and legacy versions v1, v2 → only `legacy-v2` imported.
**TS-76** — Given the sidebar → Experiments area shows Experiments, Pipelines, Prompts, Compare; no "Legacy" group.
**TS-77** — Given a dry run selecting 45 requirements → the New experiment flow shows 45 and the trigger button requires a confirmation step.
**TS-78** — Given the Prompts page with pipeline prompt `p1`, legacy versions `v1` (imported) and `v2` → three rows; `v2` has an Import action, `v1` does not.
**TS-79** — Given compare of a legacy and a pipeline experiment sharing requirement `publisher/R-1` and each with one unique requirement → one shared row and two "only in" entries; expanding the shared row shows both plans and a test-file diff.

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
- **Q4 (batch-mode grounding, open — v0.4.0):** `batch` mode (R-49) still grounds only `requirementIds[0]` in the step worker. Combining several grounded contexts (possibly different entities) into one prompt needs its own design; tracked as a follow-on, not in v0.4.0 scope.
- **Q5 (baseline verification, open — v0.6.0):** After deploy, run the `baseline-legacy-v1` pipeline and a legacy `v1` experiment against the same catalog and compare them (R-90). Expect identical inputs (TS-72) but not identical outputs — Bedrock sampling is non-deterministic. Acceptance: same groundable/skipped sets and comparable plan validity rates. Then remove the deprecated legacy run action (R-91).

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

**D-22 — Steps gain a typed `outputType` (amends R-02, R-11).**
- **Decision:** Steps declare `outputType: plan | critique | freeform`; the runtime picks the Bedrock tool contract from it. R-11's "no typed input/output contracts" is withdrawn for outputs; steps still have no predefined roles.
- **Reason:** In v0.3.0 every step was forced through `emit_functional_test_plan`, so review/adversarial steps could only re-emit a plan — steps 1 and 2 of a two-step run produced near-identical output. A small closed set keeps the worker simple while letting non-plan steps say something different.
- **Affects:** R-02, R-11, R-59, R-60, R-62

**D-23 — Sample only from groundable requirements.**
- **Decision:** The run handler grounds the whole catalog first and samples from the groundable subset; exclusions are returned, not silently dropped.
- **Reason:** Ungroundable requirements (infra-only, single-service, unmapped entities) can never produce a plan; sampling them wasted runs and surfaced as `Grounding failed` run failures. Returning `skipped` preserves the R-121 "never silently dropped" principle.
- **Affects:** R-48, R-49, R-55, R-56

**D-24 — Requirement IDs are source-qualified end to end.**
- **Decision:** `<source>/<id>` everywhere a requirement is identified on a run.
- **Reason:** Requirement IDs are unique only within a source; bare-ID matching picked the first source's requirement when two sources shared an ID.
- **Affects:** R-57, R-58

**D-25 — Plan schema v2 is a strict superset of v1.**
- **Decision:** New plan fields are additive (only `rationale` is newly required for model output; stored plans without it still validate). Superseded for the legacy generator by D-30: it stays on `PLAN_SCHEMA_V1` and the enum on `assertions[].service` moves to runtime validation against grounded sources.
- **Reason:** The v1 enum (`publisher | consumer`) and `cdc`-only propagation predate the TaskPublished/EventBridge contracts; a static enum cannot track catalog sources. Keeping v1 fields means cached legacy plans and the legacy generator keep working.
- **Affects:** R-61, R-64, R-66

**D-26 — A run's deliverable is the emitted test from its last plan step.**
- **Decision:** On successful completion the worker renders the last completed plan step and stores it as the run artifact.
- **Reason:** v0.3.0 runs ended in plan JSON with no test file, so pipelines could not be compared with legacy experiments on their actual output.
- **Affects:** R-65, R-70, R-71

**D-27 — Converge legacy experiments into pipelines without deleting legacy endpoints.**
- **Decision:** The SPA groups pipelines/prompts/runs as "Experiments", demotes the legacy pages to a deprecated group, and offers a one-way idempotent import of legacy prompt versions. Legacy endpoints and data are left in place.
- **Reason:** Two parallel experiment systems in the nav was misleading, but removing deployed endpoints and DDB records is irreversible; removal is deferred until the legacy pages are unused.
- **Affects:** R-38, R-41, R-69, R-72

**D-28 — Output-format guidance is runtime-generated, not author-written.**
- **Decision:** The runtime can append output instructions keyed by `outputType` (opt-in per step — D-30), so new prompts can describe task focus only.
- **Reason:** The output shape is already enforced in code (forced tool use), so the text describing it belongs with the code. Leaving it to authors produced contradictions (the seeded default prompt asks for TypeScript); that prompt is deliberately left unchanged as the baseline. Instructions go in the user message, not the prompt body, so prompts stay static and versioned (R-12, R-32).
- **Affects:** R-12, R-27, R-73

**D-29 — Persist per-step input snapshots in this spec (narrow slice of generation-run-audit).**
- **Decision:** Each step writes its exact model input to S3; the SPA reads it via a per-step endpoint.
- **Reason:** The run detail page cannot show what a step was given without it, and R-54's "input context summary" was otherwise unimplementable. Baselines, crawl pinning, and diff APIs remain in `generation-run-audit`.
- **Affects:** R-54, R-74, R-75, R-77

**D-30 — Baselines are preserved: legacy stays on plan v1; output instructions are opt-in.**
- **Decision:** The legacy generator is pinned to `PLAN_SCHEMA_V1`; runtime output instructions are off unless a step sets `outputInstructions: true`.
- **Reason:** The seeded prompts and legacy experiments are the experiment baseline (R-78). v0.4.0 had silently moved the legacy generator to plan v2, and v0.5.0 instructions would have changed every step's input; either change makes new results incomparable with prior ones.
- **Affects:** R-61, R-73, R-78, R-79

**D-31 — A pipeline trigger is an experiment.**
- **Decision:** One trigger of `POST /generate-functional-tests` with a `pipelineId` creates a `PEXP` record grouping its runs. Experiments, not runs, are the unit of listing and comparison; legacy `EXPERIMENT` records are presented as the same concept via normalised read endpoints.
- **Reason:** A legacy experiment and a pipeline trigger with `sampling: all` are the same activity. Without a grouping record, pipeline results could only be compared one requirement at a time, which forced separate Run/Compare pages for each system.
- **Affects:** R-80 – R-83, R-88, R-90

**D-32 — The legacy baseline runs as a pipeline.**
- **Decision:** A seeded one-step pipeline with `planSchema: "v1"`, the imported legacy v1 prompt, and the legacy model reproduces the legacy generator's request exactly (TS-72). The legacy runner stays deployed but is withdrawn from the UI once the baseline is verified against it (Q5).
- **Reason:** Lets the baseline be re-run alongside new pipelines and compared on identical terms, without keeping two runners in active use. Old legacy results remain viewable and comparable.
- **Affects:** R-84, R-85, R-91

**D-33 — Legacy prompt-version text was not being used (bug fix, `dbd78bb`).**
- **Decision:** `createBedrockClient` now uses the registry record's text; the v1 code constant is only a fallback.
- **Reason:** Callers passed the text as a 4th argument the function did not accept, so every legacy experiment used the v1 prompt regardless of the chosen version. Results of past legacy experiments on non-v1 prompt versions therefore reflect the v1 prompt (with the version's model) and should not be read as prompt comparisons.
- **Affects:** R-79, R-85, R-91
