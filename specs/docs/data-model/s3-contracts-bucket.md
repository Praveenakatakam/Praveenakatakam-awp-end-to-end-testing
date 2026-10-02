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
    One object per functional job.
    Contains the functional test manifest + synthesised plans + emitted test files.
```

## Addressing

- Contract raw bytes: keyed by `{source}/{id}/{versionNumber}-{shortHash}` — unique per version
- Requirements raw spec: keyed by `{source}` — latest snapshot only, one object per source
- Generation artifacts: keyed by `{runId}` — one object per generation run
- Functional job artifacts: keyed by `{jobId}` — one object per job

## Encryption

`BucketEncryption.S3_MANAGED` (SSE-S3, AES-256). All public access blocked via `BlockPublicAccess.BLOCK_ALL`. IAM roles follow least privilege — each Lambda is bound only to the bucket resources it needs.
