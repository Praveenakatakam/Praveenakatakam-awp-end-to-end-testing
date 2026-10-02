# docs/

Agent-facing reference documentation. Each file is intentionally small — load only what you need.

## Index

### SDD workflow
- [sdd/README.md](sdd/README.md) — lifecycle, EARS format, decisions log, version bumping
- [sdd/subagents.md](sdd/subagents.md) — the 7-stage SDD agent pipeline (requirements → design → plan → review → implement → review → write)

### System design
- [system-design/overview.md](system-design/overview.md) — what the system is, components, key principles, out-of-scope
- [system-design/architecture.md](system-design/architecture.md) — SST stacks, Lambda handlers, package responsibilities
- [system-design/api-surface.md](system-design/api-surface.md) — all API routes with method, path, auth, response
- [system-design/tech-stack.md](system-design/tech-stack.md) — stack choices, key libraries, test tiers

### Data model
- [data-model/README.md](data-model/README.md) — principles, index
- [data-model/registry-table.md](data-model/registry-table.md) — DynamoDB single-table: item kinds, GSIs, key semantics
- [data-model/s3-contracts-bucket.md](data-model/s3-contracts-bucket.md) — S3 object layout and addressing

### Integrations
- [integrations/README.md](integrations/README.md) — boundary index
- [integrations/github.md](integrations/github.md) — GitHub API crawl (PAT, Trees/Blobs, fault isolation)
- [integrations/cognito.md](integrations/cognito.md) — Cognito auth, groups, SRP login, Lambda authorizer
- [integrations/bedrock.md](integrations/bedrock.md) — Bedrock LLM integration (IAM, forced tool use, prompt versioning)
