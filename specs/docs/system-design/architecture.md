# Architecture

## SST Stacks

| Stack | Key resources |
|---|---|
| `StorageStack` | DynamoDB `Registry` table (single-table, 2 GSIs) + S3 `ContractsBucket` |
| `AuthStack` | Cognito user pool (`reader`/`writer` groups) + seed Script |
| `ApiStack` | HTTP API + Lambda REQUEST authorizer + all Lambda handlers |
| `WebStack` | CloudFront + S3 `StaticSite` (React SPA built with Vite) |

## Lambda handlers (`packages/functions/`)

| Handler | Route | Responsibility |
|---|---|---|
| `RegistryAuthorizer` | (authorizer) | Verifies Cognito access token; enforces reader/writer groups per route |
| `refresh` | `POST /refresh` | Single-flight crawl: GitHub → validate → catalog → run summary |
| `read` | `GET /contracts*`, `/entities/*`, `/crawls*`, `/requirements*`, `/test-artifacts*`, `/functional-test-jobs*` | Serve pre-crawled catalog from DynamoDB/S3 |
| `generate` | `POST /generate-tests` | Load catalog → `generateArtifacts` → persist → summary |
| `functest-job` | `POST /generate-functional-tests` | Create async job → enqueue worker |
| functest worker | (async invoke) | `generateFunctionalPlans` with real Bedrock LLM → persist artifacts |

## Packages (`packages/`)

| Package | Type | Responsibility |
|---|---|---|
| `@registry/core` | Pure TS, no AWS | ODCS validator, metadata extractor, semantic differ, EARS parser, GitHub source client, API map |
| `@registry/testgen` | Pure TS, no AWS | Deterministic contract-driven test generation (`generateArtifacts`) |
| `@registry/functest` | Pure TS, no AWS | LLM plan synthesis (`generateFunctionalPlans`), injectable `LlmClient` |
| `@registry/functions` | Lambda, AWS SDK | All handlers + DynamoDB/S3 repository layer |
| `@registry/web` | React + Vite | SPA — by-entity, by-source, requirements views |

## Key design choices

- **Single-table DynamoDB** with 2 GSIs (`byEntity`, `byKind`) — no capacity planning needed, scales to 10+ sources
- **Pure offline cores** — `testgen` and `functest` have no AWS deps; unit-tested without deploying
- **Fault-isolating crawl** — one bad file/source never aborts the rest
- **Append-only contract history** keyed on content hash (git blob SHA)
- **Latest-snapshot requirements** — no history rows, wholesale replace on each crawl

Full detail: [active/odcs-contract-registry/design.md](../../active/odcs-contract-registry/design.md)
