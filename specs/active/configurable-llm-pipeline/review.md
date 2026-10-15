# Pre-Implementation Review — Configurable LLM Pipeline

> **Reviewer:** adversarial pre-implementation check
> **Spec version:** requirements.md v0.3.0 / design.md v0.2.0
> **Date:** 2026-10-14

---

## BLOCKING Issues (must fix before implementation begins)

### B-1 — `PromptItem` data model missing `active` field in design.md

design.md's `PRMPT#<promptKey> / PRMPT` table lists only `pk`, `sk`, `kind`, `promptKey`, `currentVersion`, `body`, `s3Ref`, `createdAt`, `updatedAt`. The `active` boolean required by R-52 is absent.

T-01's acceptance criteria correctly says `PromptItem` includes `active` (citing R-52), but an implementer reading the design.md data model table would produce a type without the field. T-03's `deletePipeline` active-run guard and T-04's soft-delete path both depend on `active` being defined on the type.

**Fix:** Add `active: boolean` to the `PRMPT` data model table in design.md.

---

### B-2 — R-02 step-level `sampling` / `mode` fields conflict with design data model

R-02 requires each `PipelineStep` to contain `sampling` and `mode` fields. T-01's acceptance criteria cites this and includes both. However, design.md's `PipelineStep` field table lists only `stepId`, `label`, `model`, `promptKey`, `optional`, `waitForHuman`, `includeContext` — no `sampling` or `mode`.

The design's Sampling section (§ "Sampling and Execution Mode") treats sampling entirely at pipeline/run level — there is no reference to per-step sampling anywhere in the execution flow, context construction, or step Lambda sequence. R-47–R-50 all operate at run level, not step level.

An implementer given T-01 will add `sampling` and `mode` to `PipelineStep` per the requirements. An implementer given T-06 (step worker) will find no step-level sampling in the design's 19-step execution sequence and ignore it. The result is dead schema fields that are never read.

**Fix:** Either (a) remove `sampling` and `mode` from R-02's step field list (they appear to be vestigial from an earlier draft — the design already resolved them at pipeline/run level) and update T-01's acceptance criteria accordingly, or (b) add per-step sampling override logic to the design's execution sequence and T-06/T-08 task scopes.

---

### B-3 — TS-19 (cache invalidation on prompt update) assigned to no test task

TS-19: "Given a prompt is updated → prompt version increments → cache key for steps referencing that prompt no longer matches prior cache entries."

This covers R-29. T-04a covers prompt CRUD tests (TS-20, TS-21, TS-34) but does not include TS-19. T-06a covers caching (TS-18, TS-28) but does not include TS-19. No test task in tasks.md claims this skeleton.

**Fix:** Add TS-19 to T-06a acceptance criteria (it requires a stubbed DDB/prompt scenario inside the step worker test suite, which already has the caching infrastructure) or to T-04a (if the test is better expressed as: after PUT /prompts, the old cache key string no longer matches the new one).

---

### B-4 — TS-23 (pagination nextToken) assigned to no test task

TS-23: "Given 15 pipelines in DDB → GET /pipelines with default page size → response includes nextToken for the second page."

This covers R-37. T-03a lists TS-01 through TS-06 and TS-27/TS-35 — no TS-23. T-05a covers authorizer and lease expiry — no TS-23. T-04a covers prompt CRUD. No task claims TS-23.

**Fix:** Add TS-23 to T-05a acceptance criteria (T-05 adds GET /pipelines to `read.ts` and T-05a is its test task). A parallel case for prompt list pagination should be added at the same time.

---

### B-5 — T-03 and T-04 marked parallel but share a single file

The parallelization rationale states "Phase 2 tasks (T-03, T-04, T-05) can run in parallel." T-03 **creates** `packages/functions/src/pipeline.ts`; T-04 **modifies** that same file. Two implementer agents working in parallel on the same file will produce merge conflicts.

**Fix:** Mark T-04 as sequentially dependent on T-03, not parallel with it. Update the parallelization rationale. Alternatively, restructure T-04 to use a separate file (e.g., `pipeline-prompts.ts`) and re-export, but this would deviate from the design.

---

## ADVISORY Issues (worth fixing, not blocking)

### A-1 — R-30 has no owning task in Requirements field and no test skeleton

R-30: "WHEN a pipeline config is updated, THE system SHALL increment `pipelineConfigVersion`, which invalidates cache keys for all steps in that pipeline."

T-03's Requirements list (R-01 through R-10, R-35, R-45, R-52) does not include R-30. T-06's list does not include R-30. The behavior is implicit — R-07 causes a version increment, and R-27's cache key includes `pipelineConfigVersion` — but there is no TS-nn that explicitly verifies a pipeline update busts downstream cache entries. If a future reviewer audits R-30 coverage, it will appear uncovered.

**Fix:** Add R-30 to T-03's Requirements list and add a test assertion in T-06a: "Given a step with a cache hit, after the pipeline config is updated (version increments), the cache key no longer matches the prior entry."

---

### A-2 — `completed_with_warnings` edge case has no TS-nn

The §5 edge case "All steps in pipeline are `optional: true` and all fail → `completed_with_warnings`" is referenced in T-06's acceptance criteria but has no corresponding test skeleton in requirements.md. T-06a covers TS-11 (single optional step → warning, next step dispatched) but no test covers the terminal condition when the final optional step also fails and the run must be closed as `completed_with_warnings`.

**Fix:** Add a test skeleton (e.g., TS-39) to requirements.md: "Given a 2-step pipeline where both steps are optional and both fail → run record has `status: 'completed_with_warnings'`." Then add it to T-06a acceptance criteria.

---

### A-3 — T-05a GET handler coverage is thin

T-05 adds GET handlers for `/pipelines`, `/pipelines/{id}`, `/prompts`, `/prompts/{key}`, `/prompts/{key}/versions` to `read.ts`. T-05a's acceptance criteria focuses on the authorizer (TS-22) and lease expiry (TS-17, TS-17b) — no acceptance criteria tests the response shape of any GET pipeline or prompt handler. An empty list response, a not-found 404, and a full item response are untested.

**Fix:** Add acceptance criteria to T-05a for at least: `GET /pipelines/{id}` returns the full pipeline item; `GET /pipelines/{id}` for unknown ID returns 404.

---

### A-4 — `SYSTEM_MAX_RUN_AGE_MINUTES = 5` will silently cap pipelines with `maxAgeMinutes > 5`

D-18 intentionally sets the system cap to 5 minutes, but any pipeline with multiple slow steps will time out before `maxAgeMinutes` (default 60) takes effect. The check happens at the start of each step Lambda invocation, so a 3-step pipeline where each step takes 2 minutes will time out on step 3's entry (T+6 > 5). Authors setting `maxAgeMinutes: 60` will see `timed_out` and have no obvious explanation.

This is a documented design decision. However, neither the requirements, design, nor tasks include any user-visible warning or documentation string. **Consider adding a note to the seeder's seed pipeline and to the `POST /pipelines` response** to make the constraint discoverable.

---

### A-5 — T-09 Bedrock IAM policy spec differs from design

T-09 acceptance criteria says the Bedrock policy should cover `arn:aws:bedrock:*::foundation-model/anthropic.*` and `arn:aws:bedrock:*:*:inference-profile/*`. The design's SST snippet in §SST/CDK Changes specifies `resources: ['*']`. The more restrictive ARN patterns in T-09 are good security practice but may block models added to the allowlist that don't match the prefix (e.g., Amazon Titan, Cohere). The model allowlist (R-10) is intentionally open-ended. Verify the Bedrock ARN patterns in T-09 cover all models that will be seeded into `MODEL_ALLOWLIST`.

---

## Summary

5 blocking issues require resolution before implementation begins:

- **B-1** `active` field missing from design.md PRMPT data model table
- **B-2** R-02 step-level `sampling`/`mode` fields are inconsistent with the design's execution model — decision needed on whether they are real or vestigial
- **B-3** TS-19 is a dangling test skeleton with no owning test task
- **B-4** TS-23 is a dangling test skeleton with no owning test task
- **B-5** T-03 and T-04 are incorrectly marked as parallelizable; they share a single file with a create/modify dependency
