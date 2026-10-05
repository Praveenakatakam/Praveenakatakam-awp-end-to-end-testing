# Data Model

## Files

| File | Contents |
|---|---|
| [registry-table.md](registry-table.md) | DynamoDB `Registry` single-table design — item kinds, GSIs, key semantics |
| [s3-contracts-bucket.md](s3-contracts-bucket.md) | S3 `ContractsBucket` — object layout and addressing |

## Key principles

- **Single table** — all item kinds share one DynamoDB table, distinguished by key shape
- **Content hash = GitHub git blob SHA** — stable, content-addressed, free from the Trees API, no extra hashing
- **Contracts: append-only history** — a new version row on every content-hash change
- **Requirements: latest-snapshot only** — wholesale replace on each crawl, no history rows (deliberately unlike contracts)
- **Generation artifacts: one S3 object per run** — returned inline in API responses at v1 scale

Full detail with JSON shapes and query patterns: [active/odcs-contract-registry/design.md §2](../../active/odcs-contract-registry/design.md)
