# Configurable LLM Pipeline

**Status:** Pending — idea, not yet initiated

## Problem

The functional test generator today is a single hardcoded LLM step: one prompt, one model, one call per requirement. There is no way to:

- Chain multiple LLM calls (e.g. generate → adversarial review → refine → final review)
- Run steps in parallel when they are independent (DAG)
- Change the model, prompt, step count, or step order without a code change and redeploy
- Swap prompts or models at runtime for experimentation

## Proposed approach

### Pipeline config (DynamoDB)

A `PIPELINE#<pipelineId>` item holds the ordered step list and safety constraints:

```
steps:        [{ stepId, role, model, promptKey, dependsOn: [stepId], optional }]
maxSteps:     integer (hard ceiling enforced at config write time; suggested default 10, hard cap 20)
maxAgeMinutes: integer (run-level timeout; worker checks before enqueuing the next step)
```

Steps are added, removed, or reordered by writing a new pipeline config version. The SPA exposes a config editor. `maxSteps` is validated on every write — a pipeline that exceeds the ceiling is rejected before it can be saved.

### Step roles

Well-known roles with defined input/output contracts:

- `generate` — takes grounded context, produces an initial `FunctionalTestPlan`
- `adversarial` — takes a plan + grounded context, produces a critique and pass/fail verdict
- `refine` — takes a plan + critique, produces a revised plan
- `review` — takes a final plan, produces a quality score / notes (stored but not blocking)

### Execution model: SQS-driven per-step dispatch

**Not** a single long-running Lambda loop. Each step is a discrete SQS message → Lambda invocation:

1. `POST /generate-functional-tests` → API Lambda creates run record, enqueues step 0
2. Step Lambda processes one step for all requirements, writes step outputs to S3/DDB, enqueues step N+1
3. Terminal step (or error) writes the final run status; no further message enqueued

This replaces the current `InvocationType: 'Event'` async Lambda invoke with an SQS queue. Benefits:
- No 15-minute Lambda ceiling per multi-step run
- Step-level resume: a failed step can be retried without re-running earlier steps
- Natural infinite-loop kill: SQS `maxReceiveCount` → DLQ prevents a misconfigured pipeline from spinning forever; the DLQ message is the audit record

**Application-level loop prevention** (belt + suspenders):
- `maxSteps` on the pipeline config (enforced at write time, re-checked at enqueue time)
- `maxAgeMinutes` on the run record: worker checks `now - run.startedAt > maxAgeMinutes` before enqueuing; if exceeded, marks run `timed_out` and stops

### Control flow

Linear chain for v1: each step depends on the previous step's output. DAG (parallel independent steps, fan-in) is a follow-on for when a concrete parallel use case exists (e.g. adversarial + modality-check running concurrently, both feeding into refine). No loop-as-pipeline-primitive — a `refine` step that needs retrying handles that internally within its Lambda invocation.

### Cache key

`inputHash + pipelineId + pipelineConfigVersion + stepId + promptKey + promptVersion`

A step whose full input tuple is unchanged is skipped; its cached output (stored in DDB/S3) is reused verbatim. Changing any prompt bumps its version, busting the cache for that step and all downstream steps.

### Prompts (DynamoDB)

`PROMPT#<promptKey>` items, versioned. Changing a prompt bumps its version. Prompt text stored in DDB for short prompts; S3 ref for long ones.

### SPA: Pipeline & Prompt CRUD

Writer-group-gated UI for managing pipeline configs and prompts without a redeploy:

**Pipeline config management:**
- List all pipelines (id, step count, active/inactive, last modified)
- Create pipeline — name, initial step list
- Edit pipeline — add step, remove step, reorder steps, set model/promptKey/role per step, set `maxSteps` / `maxAgeMinutes`
- Delete pipeline (soft-delete / deactivate; cannot delete a pipeline referenced by an active run)
- View pipeline — read-only step graph with current prompt versions resolved

**Prompt management:**
- List prompts (promptKey, current version, last modified, used-by pipelines)
- Create / edit prompt body — textarea with preview of resolved variables; saving creates a new version automatically
- View prompt version history — diff between versions
- Delete prompt version (only if not referenced by any cached plan or run record)

**API surface needed** (new routes, writer-only):
- `GET/POST /pipelines` — list + create
- `GET/PUT/DELETE /pipelines/{pipelineId}` — read, update, deactivate
- `GET/POST /prompts` — list + create
- `GET/PUT /prompts/{promptKey}` — read current version + update (creates new version)
- `GET /prompts/{promptKey}/versions` — version history

## Questions to resolve before initiating

- Step output schema: typed per role, or a generic JSON envelope passed between steps?
- What does the adversarial step return that the refine step can consume? Structured critique or free text?
- Should optional steps that fail be recorded as skipped or as warnings on the run?
- Does DAG support belong in v1 or is it a confirmed follow-on?
- SQS queue per pipeline, or a single shared queue with pipeline/step type in the message?

## Related

- [pending/prompt-versioning-experiments](../prompt-versioning-experiments/stub.md) — overlapping concern; this supersedes the prompt-storage and run-tagging parts of that stub
- [pending/generation-run-audit](../generation-run-audit/stub.md) — audit trail for pipeline runs; step records and DLQ autopsy land here
- [pending/parallel-llm-generation](../parallel-llm-generation/stub.md) — per-requirement parallelism within a single step
- [active/odcs-contract-registry/requirements.md](../../active/odcs-contract-registry/requirements.md) §3.11 — current single-step LLM gen this replaces
