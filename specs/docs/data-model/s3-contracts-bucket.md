# S3 — `ContractsBucket`

SSE-S3 (`BucketEncryption.S3_MANAGED`, AES-256). All public access blocked.

## Object layout

```
contracts/{source}/{id}/{versionNumber}-{shortHash}.odcs.yaml
    One object per contract version. Addressed by version number + short content hash.
    Referenced by the Version item's s3Key field.
    Never overwritten — append-only, mirrors the DynamoDB version history.

requirements/{source}/spec.md
    One object per source (latest snapshot only).
    Overwritten on content change — no version history.
    Stores the raw bytes of each source's docs/spec.md for provenance.

test-artifacts/{runId}/artifacts.json
    One object per generation run.
    Contains the full artifact set: { manifest, files: [{path, contents}] }.
    Returned inline in GET /test-artifacts/{runId} responses.

functional-tests/{jobId}/...
    One object per functional job (legacy single-step generator).
    Contains the functional test manifest + synthesised plans + emitted test files.

pipeline-outputs/{runId}/{nn}.json
    Step output (if >64KB). Step index zero-padded to 2 digits (00, 01, ...).
    Referenced by StepRecord.outputRef.s3Key.

pipeline-outputs/{runId}/{nn}.input.json
    Step input snapshot (v0.5.0). Full context + sections sent to Bedrock.
    Referenced by StepRecord.inputRef.s3Key.

pipeline-outputs/{runId}/test.generated.ts
    Emitted test file from the last plan step (v0.4.0).
    Referenced by PipelineRun.artifact.s3Key.

prompts/{promptKey}/{nnnnn}.txt
    Prompt body (if >64KB). Version number zero-padded to 5 digits.
    Referenced by PromptVersionItem.s3Ref or PromptItem.s3Ref.
```

## Addressing

- Contract raw bytes: keyed by `{source}/{id}/{versionNumber}-{shortHash}` — unique per version
- Requirements raw spec: keyed by `{source}` — latest snapshot only, one object per source
- Generation artifacts: keyed by `{runId}` — one object per generation run
- Functional job artifacts (legacy): keyed by `{jobId}` — one object per job
- Pipeline step outputs: keyed by `{runId}/{nn}` — one per step if >64KB, else stored inline in DDB
- Pipeline step inputs: keyed by `{runId}/{nn}.input` — one per step (v0.5.0)
- Pipeline run artifacts: keyed by `{runId}/test.generated.ts` — one per run if a plan step completed
- Prompt bodies: keyed by `{promptKey}/{nnnnn}` — one per version if >64KB, else stored inline in DDB

## Encryption

`BucketEncryption.S3_MANAGED` (SSE-S3, AES-256). All public access blocked via `BlockPublicAccess.BLOCK_ALL`. IAM roles follow least privilege — each Lambda is bound only to the bucket resources it needs.
