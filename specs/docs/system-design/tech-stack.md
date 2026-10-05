# Tech Stack

## Core

| Choice | Why |
|---|---|
| TypeScript everywhere | NFR-7 mandated; shared types across packages |
| SST v2 (CDK) | Single-command deploy; L2 constructs for Table/Bucket/Api/Cognito/StaticSite/Config.Secret |
| API Gateway HTTP API + Lambda | Low-latency reads (cached catalog); cheaper than REST API |
| DynamoDB on-demand single-table + 2 GSIs | Scales to 10+ sources × 25+ contracts without capacity planning |
| S3 for raw bytes | Exact-byte retrieval of every historical contract version |
| Node 22 Lambda runtime, arm64 | Matches sibling apps |

## Key libraries

| Library | Use |
|---|---|
| `@octokit/rest` | GitHub API client (Trees/Blobs, typed errors) |
| `ajv ^8.17.1` + `ajv-formats ^3.0.1` + `js-yaml ^4.1.0` | ODCS YAML parsing + JSON Schema validation (same versions as sibling apps) |
| `aws-jwt-verify ^4` | Cognito access token verification in the Lambda authorizer |
| `amazon-cognito-identity-js` | Native SRP sign-in in the React SPA |
| `@aws-sdk/client-bedrock-runtime` | LLM plan synthesis via `InvokeModel` (forced tool use) |
| `vitest ^3.2.6` | All test suites (unit, infra, web, gen-unit, llm-unit) |
| `react ^18.3.1` + `vite ^5.3.3` | SPA |

## Test tiers

| Tier | What | Where |
|---|---|---|
| `[unit]` | Pure logic + mocked AWS SDK | `packages/*/tests/` |
| `[infra]` | CDK template assertions (offline synth) | `stacks/tests/` |
| `[web]` | jsdom + stub fetch | `packages/web/tests/` |
| `[gen-unit]` | `@registry/testgen` over catalog fixtures, no AWS | `packages/testgen/tests/` |
| `[llm-unit]` | `@registry/functest` with stubbed `LlmClient`, no network | `packages/functest/tests/` |
