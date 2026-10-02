# DynamoDB — `Registry` Table

Single-table design. On-demand capacity, `TableEncryption.AWS_MANAGED` (SSE-KMS).

## Item kinds

| Kind | PK | SK | Key attributes |
|---|---|---|---|
| **Catalog entry** — current state of `{source, id}` | `SRC#{source}` | `CON#{id}` | `entity`, `name`, `filePath`, `currentVersion` (int), `currentHash` (git blob SHA), `declaredVersion`, `validation` (`valid`\|`invalid`), `validationErrors?`, `commitSha`, `lastCrawledAt` |
| **Version** — immutable history row | `VER#{source}#{id}` | `V#{000n}` (zero-padded) | `versionNumber`, `hash`, `declaredVersion`, `versionNotBumped` (bool), `commitSha`, `crawledAt`, `validation`, `s3Key` |
| **Crawl run** | `RUN#{runId}` | `RUN` | `kind:"CRAWL"`, `startedAt`, `endedAt`, `sources[]` (label, outcome, counts), `collisions[]` |
| **Single-flight lock** | `LOCK` | `CRAWL` | `runId`, `acquiredAt`, `ttl` (DynamoDB TTL attribute) |
| **Requirement** — latest snapshot of `{source, R-id}` | `REQ#{source}` | `R#{id}` | `text`, `earsType` (event/unwanted/state/optional/ubiquitous), `modality` (SHALL/SHOULD/MAY/null), `section`, `earsConforming` (bool), `changedInLastCrawl` (bool), `specHash`, `specVersion?`, `lastCrawledAt` |
| **Generation run** | `GEN#{runId}` | `GEN` | `kind:"GENERATION"`, `startedAt`, `endedAt`, `counts`, `skipped[]`, `catalogContext`, `artifactS3Key` |
| **Functional job** | `FJOB#{jobId}` | `FJOB` | `kind:"FUNCTIONAL_GEN"`, `status` (pending/running/succeeded/failed), `startedAt`, `finishedAt?`, `modelId`, `promptVersion`, `planCount`, `skipCount`, `skips[]`, `artifactKey`, `error?` |

## GSIs

### `byEntity`
- PK: `entity`, SK: `source`
- Only catalog-entry items populate `entity`
- Backs `GET /entities/{entity}` — returns all source variants of an entity
- Read handler re-orders publisher-first before diffing so A/B is deterministic

### `byKind`
- PK: `kind`, SK: `startedAt`
- Three disjoint partitions: `CRAWL` (crawl runs), `GENERATION` (test gen runs), `FUNCTIONAL_GEN` (functional jobs)
- Backs `GET /crawls`, `GET /test-artifacts`, `GET /functional-test-jobs` — newest-first via SK sort

## Key semantics

**Catalog key:** `{source label, contract id}`. Same `id` from two different sources = two distinct entries (never merged).

**Version transitions:**
- Fresh hash ≠ stored `currentHash` → append a new `Version` row, bump `currentVersion`
- Fresh hash = stored `currentHash` → unchanged; bump `lastCrawledAt`/`commitSha` only
- Content changed but declared `version` field unchanged → `versionNotBumped: true` on the new version row

**Lock:** Conditional write (`attribute_not_exists`) at crawl start, release at end. TTL fallback frees a crashed crawl's lock automatically.

**Requirements:** No `REQVER#` history rows — latest snapshot only. Wholesale BatchWrite replace (puts for current + deletes for removed ids). Collisions (same `R-nn` twice) keep-first with a logged warning.
