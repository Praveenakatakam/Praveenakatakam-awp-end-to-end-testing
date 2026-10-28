# Pre-Implementation Review — Prompt Versioning & Experiment Tracking

> Reviewer mode: Pre-implementation adversarial review
> Spec version: requirements.md 0.2.0 / design.md 0.2.0

---

## Findings

### BLOCKING-1 — `byKind` GSI sort key is `startedAt`; PROMPT and EXPERIMENT items write `createdAt`

**Location:** `stacks/StorageStack.ts:36`, design.md §Data Model, T-02 task description

**What the code says:** The `byKind` GSI is defined as `{ partitionKey: 'kind', sortKey: 'startedAt' }`. The `startedAt` attribute is declared in the table fields. There is no `createdAt` field declared.

**What the design says:** PROMPT and EXPERIMENT items store `createdAt` (ISO-8601) and "both new item kinds use `createdAt` as the SK." The design states the GSI "already exists with `kind` (PK) and `createdAt` / `startedAt` (SK)" — but the slash notation is misleading. The actual GSI SK attribute is `startedAt`.

**Consequence:** PROMPT and EXPERIMENT items will be written without a `startedAt` attribute. DynamoDB will include them in the GSI (because they have the PK `kind`) but with a null/absent SK. The GSI does not sort null-SK items by `createdAt` — their sort position is implementation-defined and will not be newest-first. This breaks R-05 and R-40 on the very first query.

**T-02 makes this worse:** T-02 explicitly says "No new GSI or table changes are required — `byKind` already exists." This is incorrect and will be false confidence that no schema change is needed.

**Resolution needed before T-04:** Choose one approach and add a task (or update T-02/T-04) to implement it:
- Option A: populate `startedAt` on PROMPT and EXPERIMENT items (set equal to `createdAt`). This requires no GSI change and is the smallest fix.
- Option B: add `createdAt` as a declared table field and change the GSI SK to `createdAt`. This is a breaking change to existing crawl/generation items that use `startedAt` and is not recommended.
- Option C: define a second GSI on `createdAt`. Adds cost and complexity; not recommended given D-3/D-9.

Option A is the correct path; it just needs to be made explicit in T-04 and the data model tables in requirements.md and design.md.

---

### BLOCKING-2 — Deploy atomicity: seeder and Lambda code update have no guaranteed ordering

**Location:** design.md §Failure Modes (row 8), T-03 task description, T-06 task description

**The risk:** T-03 adds the SST `Script` seeder that writes `PROMPT#v1` to DynamoDB. T-06 removes the `PROMPTS` in-file registry and makes `rawPromptText` a required parameter (all callers must now read from DynamoDB). Both changes are deployed together in one `sst deploy`, but the SST Script custom resource and the Lambda function code update are independent CloudFormation resources with no explicit `DependsOn` ordering.

CloudFormation can update the Lambda code (making `PROMPT#v1` lookup mandatory) before the custom resource seeder runs. In that window, any call to `POST /generate-functional-tests` hits the new code path, calls `getPromptVersion('v1')`, gets a miss, and returns `400 Bad Request`. The window closes when the seeder completes, but for a deployed service this is an outage.

The design failure modes table acknowledges this: "Seed not yet present | 400; this should not occur in normal operation — seed runs at deploy time." That note is optimistic — without an explicit dependency, the ordering is not guaranteed.

**Resolution needed:** Add a CDK `addDependency` (or SST `dependsOn`) from the seeder Script construct to the FunctionalGen Lambda function construct in `ApiStack.ts`. This ensures CloudFormation does not mark the Lambda update complete before the seeder fires. Document this in T-03.

---

### BLOCKING-3 — T-09a missing test for Lambda invoke-failure → 500 path

**Location:** design.md §Failure Modes (boundary 3), T-09a task description

**The failure mode:** design.md documents: "experiments.ts :: handler → Lambda invoke | Invoke fails (throttle, IAM) | Return `500`; `EXP#{}` record left in `pending`."

**What T-09a covers:** "handler 202 happy path" and "handler 400 unknown promptVersion (no DDB write)." There is no test for the invoke-fails branch.

**Consequence:** The 500 error path and the "EXP#{} left in pending on dispatch failure" behavior (which affects user-facing recovery) go untested. If the implementer adds a try/catch around the Lambda invoke but forgets to write the 500 response, or forgets to let the pending record persist (vs. writing failed), tests will not catch it.

**Resolution needed:** Add a case to T-09a: "handler returns 500 and does not mark experiment as failed when `InvokeCommand` throws (record remains in `pending` — caller must re-trigger)."

---

## Non-Blocking Findings

### NON-BLOCKING-1 — T-06 interim state: rawPromptText value between T-06 and T-07 is unspecified

**Location:** T-06 task description, functional-gen.ts:201

T-06 removes `PROMPTS` from `llm.ts`, makes `rawPromptText: string` required in `createBedrockClient`, and updates the call site in `functional-gen.ts` — but "no new logic; that comes in T-07." After T-06 alone, `functional-gen.ts` worker needs to call `createBedrockClient(model, region, something)` without a DDB lookup (that arrives in T-07). The task is silent on what `something` is.

If T-06 passes an empty string or a constant, the TypeScript compiles but runtime Bedrock calls send a blank or wrong prompt until T-07 is merged. If T-06 types the event rawPromptText as `string | undefined` to defer the requirement, that conflicts with T-06's validation criterion ("createBedrockClient without rawPromptText is a type error").

Recommended: T-06 and T-07 could be merged into a single task, or T-06's description should explicitly state it passes the resolved text as a temporary constant (e.g., the literal v1 prompt text) that T-07 replaces with a DDB lookup. The implementer should not have to guess.

---

### NON-BLOCKING-2 — T-03 satisfies R-63 but does not mention the required IAM additions

**Location:** T-03 task description, requirements.md R-63

R-63 says "Additional permissions (writing to new item kinds and new S3 prefixes) SHALL be added additively." T-03 claims `Satisfies: R-20, R-09, R-62, R-63` but its task description only mentions the Function construct, routes, and seeder Script — there is no sentence about adding DynamoDB write permissions for `PROMPT#` and `EXP#` prefixes or S3 write/read permissions for the `experiments/` prefix to the ExperimentWorker IAM role.

In SST v2 this is handled via `permissions` on the Function construct or `attachPermissions`. If the implementer follows the task description literally they may omit these grants, resulting in IAM access denied at runtime.

Recommended: add an explicit bullet in T-03's task description: "Grant ExperimentWorker `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem` on the Registry table, and `s3:PutObject`, `s3:GetObject` on the `experiments/*` prefix of the Contracts bucket."

---

## Summary

3 blocking findings must be resolved before implementation starts:

- **BLOCKING-1** is a data-model defect that will silently return unsorted results for two required list endpoints. Fix: populate `startedAt` on PROMPT and EXPERIMENT items (same value as `createdAt`) — add this to T-04 and update the data model tables.
- **BLOCKING-2** is a deployment race condition on first deploy that can cause a brief 400 outage for `POST /generate-functional-tests`. Fix: add an explicit CDK `DependsOn` from the seeder to the FunctionalGen Lambda in T-03.
- **BLOCKING-3** is a gap in T-09a that leaves the documented invoke-failure → 500 path untested. Fix: add one test case to T-09a.

---

## Post-Implementation Review — 2026-10-09

> Reviewer mode: Post-implementation pattern check
> All 24 tasks complete; all tests passing.

### Findings

**[BLOCKING] ExperimentStatus terminal value is `'completed'` throughout — spec requires `'succeeded'`**

R-30 states: "The experiment record SHALL be updated to … a terminal state (`'succeeded'` or `'failed'`) when it ends."
The data model in R-60 explicitly shows: `'pending'` → `'running'` → `'succeeded'` / `'failed'`.
R-42 states the artifact endpoint must 404 "if … status is not `succeeded`."
The acceptance criteria list "succeeded" as the expected terminal state.

The implementation uses `'completed'` instead of `'succeeded'` uniformly:

- `packages/core/src/prompt-versioning.ts:6` — `ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed'`
- `packages/functions/src/experiments.ts:251` — worker sets `status: 'completed'`
- `packages/functions/src/read.ts:199` — `experimentArtifact` guards with `record.status !== 'completed'`
- `packages/web/src/App.tsx:331,341,343,373` — SPA checks `data.status === 'completed'`

The implementation is internally consistent (it uses `'completed'` everywhere), so functionality is intact in isolation. But it violates the published API contract. Any external caller, integration test, or future feature written against the spec — which says `'succeeded'` — will not match.

Fix: rename `'completed'` → `'succeeded'` in `ExperimentStatus`, the worker's success branch, the `experimentArtifact` status guard, and the SPA status checks. This is a one-word change in four files; all existing tests should remain green after updating their expected values.

---

**[WARNING] `PromptVersionRecord` carries a `startedAt` required field not in the design data model**

`packages/core/src/prompt-versioning.ts:13` declares `startedAt: string` as a required field on `PromptVersionRecord`. The design data model (design.md §Data Model) shows no `startedAt` attribute for `PROMPT#{}` items — only `createdAt`. The field was added to satisfy the `byKind` GSI SK (`startedAt`), which is the correct resolution to the pre-implementation BLOCKING-1 finding. The value is always set equal to `createdAt` (`packages/functions/src/prompt-versions.ts:55`), so ordering is correct.

The deviation is functional but undocumented: the data model table in design.md does not list `startedAt` for PROMPT items, so a reader of that doc cannot understand why the field is there. Consider adding `startedAt` to the design data model table with a note "same value as `createdAt`; required for `byKind` GSI SK membership."

---

**[INFO] `CellStatus` type exported from `prompt-versioning.ts` is dead code**

`packages/core/src/prompt-versioning.ts:5` exports `type CellStatus = 'pending' | 'running' | 'succeeded' | 'failed'`. This type has no consumers; it is a leftover from the matrix/multi-cell experiment model that was deferred to `parallel-llm-generation` (D-1). Safe to remove.

---

### Summary

1 blocking issue: the `'completed'` / `'succeeded'` status mismatch violates R-30, R-42, and the published data model in R-60. Fix before archiving or sharing the API contract with any downstream consumer.
