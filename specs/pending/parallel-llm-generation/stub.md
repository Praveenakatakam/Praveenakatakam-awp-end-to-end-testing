# Parallel LLM Generation

**Status:** Pending — idea, not yet initiated

## Problem

The functional test generator processes requirements sequentially (`for` loop in `generateFunctionalPlans`). With many requirements and a multi-step pipeline, wall-clock time scales linearly. Bedrock supports concurrent requests; the bottleneck is artificial.

## Proposed approach

1. **Fan-out per requirement** — replace the sequential loop with `Promise.all` (or a concurrency-limited equivalent) over requirements. Each requirement's full pipeline (all steps) runs independently.

2. **Concurrency limit** — Bedrock has per-account TPS limits. Use a simple semaphore (e.g. `p-limit`) with a configurable `maxConcurrency` (default 5, overridable via SST Parameter). Do not use `Promise.all` unbounded.

3. **Per-step parallelism within a requirement** — when the pipeline config is a DAG (see [configurable-llm-pipeline](../configurable-llm-pipeline/stub.md)), steps with no `dependsOn` relationship within a single requirement's pipeline can also run in parallel. This is a follow-on to linear chain support.

4. **Cache hits are free** — requirements whose input hash is unchanged skip the LLM entirely; the concurrency limit only needs to govern actual Bedrock calls, not cache lookups.

5. **Failure isolation** — a Bedrock error or plan validation failure on one requirement must not cancel in-flight requests for others. Each requirement's result is collected independently; failures are recorded as skipped entries in the manifest.

## Questions to resolve before initiating

- Should `maxConcurrency` be a pipeline-level config or a global SST Parameter?
- Do we need per-model concurrency limits (different models may have different TPS budgets)?
- Should the Lambda timeout be extended to accommodate parallel runs with many requirements?

## Related

- [pending/configurable-llm-pipeline](../configurable-llm-pipeline/stub.md) — pipeline structure this parallelises
- [active/odcs-contract-registry/requirements.md](../../active/odcs-contract-registry/requirements.md) §3.11 — current sequential implementation
