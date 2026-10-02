# Bedrock Integration

Used by the LLM Functional Test Generator (§3.11) to synthesize structured cross-service test plans from EARS requirements + ODCS contracts.

## Auth

IAM-role auth (SigV4) — the worker Lambda's execution role is granted `bedrock:InvokeModel`. No API key, no SST Secret. Nothing sensitive is logged or returned.

## Client

`@aws-sdk/client-bedrock-runtime` `InvokeModel` call, wrapped behind an injectable `LlmClient` interface in `packages/functest/src/llm.ts`. The offline test suite injects a stub — no network calls in unit tests.

## Model

Default: `us.anthropic.claude-sonnet-4-6` (overridable via `BEDROCK_MODEL_ID` env var). The model must have access granted in the deployment region.

## Structured output

Uses **forced tool use** — a single tool whose `input_schema` is the `FunctionalTestPlan` JSON schema with `tool_choice` pinned to it. This is because the beta `output_format`/`messages.parse` path is not routable on Bedrock (`?beta=true` → `UnknownOperationException`). The pure core re-validates every response with Ajv before caching.

## Prompt versioning

The prompt text and model id are both included in the input hash for each plan (alongside requirement text, contract content hash, and API map entry). This means changing the prompt or model id will cause a cache miss and re-synthesis for every affected requirement.

The `promptVersion` string is recorded on every functional job record in DynamoDB for provenance. Current approach: hardcoded version string in `packages/functest/src/prompt.ts`.

**Future work:** [prompt-versioning-experiments](../../../pending/prompt-versioning-experiments/stub.md) — store prompt versions in DynamoDB, enable experiment comparison across prompt iterations.

## Determinism

LLM synthesis is non-deterministic. Determinism is preserved by caching the validated plan by input hash (S3/DDB-backed `PlanCache`). An unchanged input → cache hit → no LLM call → byte-identical re-render. Only changed inputs re-synthesize.
