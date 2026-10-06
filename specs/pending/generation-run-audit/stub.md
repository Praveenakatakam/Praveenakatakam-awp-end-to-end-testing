# Generation Run Audit & Stable Test-Data Snapshots

**Status:** Pending — idea, not yet initiated

## Problem

Generation runs today are partially tracked (crawl run IDs, test-artifact records) but there is no:

- Per-step audit trail (what model, what prompt version, what tokens, what duration, was it a cache hit)
- Snapshot of the exact contracts + requirements that fed a run, so a run can be replayed against identical inputs
- Baseline concept — designating a run as the reference point for a pipeline/prompt version so new runs can be diffed against it
- Stable test-data set for QA: without pinned inputs, iterating on prompts produces outputs that differ for two reasons (prompt change AND data change), making apples-to-apples quality comparison impossible

## Proposed approach

1. **Run record** (DynamoDB):
   ```
   PK: RUN#<runId>   SK: META
   pipelineId, pipelineConfigSnapshot, crawlRunId (FK), triggeredBy,
   startedAt, completedAt, status, baselineFor (pipelineId | null)
   ```
   `pipelineConfigSnapshot` stores the full pipeline config at time of run — not just a reference — so the audit is self-contained even after the config changes.

2. **Step record** (DynamoDB):
   ```
   PK: RUN#<runId>   SK: STEP#<stepId>#<requirementId>
   model, promptKey, promptVersion, inputHash, outputRef (S3 key),
   tokensUsed, durationMs, cacheHit (bool), skipped (bool), skipReason
   ```

3. **Input snapshot** — at generation time, resolve contracts + requirements from the linked `crawlRunId` and store their content hashes. `POST /generate-tests?crawlRunId=<id>` replays against that pinned crawl snapshot rather than latest data. This gives QA a stable baseline.

4. **Baseline runs** — `POST /runs/<runId>/set-baseline` marks a run as the reference for its pipeline version. A comparison API (`GET /runs/<runId>/diff/<baselineRunId>`) returns per-requirement: plan unchanged / changed / new / dropped, and adversarial score delta if available.

5. **SPA view** — run history with baseline badge, per-requirement diff viewer.

## Storage cost consideration

Full step-level output storage (S3 per step per requirement per run) can grow quickly at production scale. For development this is acceptable. Before production:

- **Retention policy** — TTL on non-baseline run records (e.g. 90 days); baseline runs are retained until explicitly superseded
- **Output compression** — step outputs are structured JSON; gzip before S3 write
- **Step output tiering** — store full output only for the final step; intermediate steps store a content hash + summary (tokens, verdict) rather than full payload
- **Baseline-only full retention** — non-baseline runs drop intermediate step outputs after N days, keeping only the final artifact and the audit metadata

These are policy decisions, not architecture changes — the schema supports them without redesign.

## Questions to resolve before initiating

- Should `crawlRunId` be required on generation runs, or optional (falling back to latest crawl)?
- Is the diff surface qualitative (human review) or does the adversarial step produce a score we can diff numerically?
- Who can mark a run as a baseline — any writer, or a separate `admin` group?

## Related

- [pending/configurable-llm-pipeline](../configurable-llm-pipeline/stub.md) — defines the step model this audit table tracks
- [active/odcs-contract-registry/requirements.md](../../active/odcs-contract-registry/requirements.md) §3.9, §3.11 — existing run tracking this extends
