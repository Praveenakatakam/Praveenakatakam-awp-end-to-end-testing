# Bedrock Integration

Used by the LLM Functional Test Generator (§3.11 legacy single-step, §3.12 configurable pipeline) to synthesize structured cross-service test plans from EARS requirements + ODCS contracts.

## Auth

IAM-role auth (SigV4) — the worker Lambda's execution role is granted `bedrock:InvokeModel`. No API key, no SST Secret. Nothing sensitive is logged or returned.

## Client

`@aws-sdk/client-bedrock-runtime` `InvokeModel` call, wrapped behind an injectable `LlmClient` interface in `packages/functest/src/llm.ts`. The offline test suite injects a stub — no network calls in unit tests.

## Model

Default: `us.anthropic.claude-sonnet-4-6` (overridable via `BEDROCK_MODEL_ID` env var). The model must have access granted in the deployment region.

## Structured output

Uses **forced tool use** — a single tool whose `input_schema` is selected by the step's `outputType`:

- `plan` with `planSchema: "v1"` → `PLAN_SCHEMA_V1` (legacy generator, baseline pipeline)
- `plan` with `planSchema: "v2"` (default) → `PLAN_SCHEMA_V2` (extended with `rationale`, `examplePayload`, `negativeCases`, service-validated assertions)
- `critique` → `CRITIQUE_SCHEMA` (`{verdict, summary, issues[]}`)
- `freeform` → no tool; concatenated text blocks are the output

Tool choice is pinned to the selected tool. This is because the beta `output_format`/`messages.parse` path is not routable on Bedrock (`?beta=true` → `UnknownOperationException`). The step worker re-validates every response with Ajv before caching.

## Prompt versioning and caching

**Legacy generator:** Prompt version string recorded on FJOB record. Cached by `{inputHash, modelId, promptVersion}`.

**Pipeline steps:** Each step references a `PRMPT#` item by `promptKey`. The step's cache key includes `{inputHash, pipelineId, pipelineConfigVersion, stepId, promptKey, promptVersion, instructionsVersion?}`. Updating a prompt creates a new `PRMPTVER` record and increments `currentVersion`, invalidating cache keys for steps referencing that prompt.

## Output instructions (v0.5.0)

Steps may set `outputInstructions: true` (default `false`) to append runtime-generated output format guidance to the user message. Instructions are generated from the step's `outputType` and the presence of a prior plan in the context:

- `plan` (first occurrence) → instructs to produce one grounded cross-service test plan via `emit_functional_test_plan`
- `plan` (with prior plan) → instructs to revise the prior plan addressing any critique
- `critique` → instructs to review the most recent prior plan and report via `emit_critique`
- `freeform` → no section appended

When `outputInstructions` is on, `OUTPUT_INSTRUCTIONS_VERSION` is part of the cache key. When absent or `false`, the user message is identical to pre-v0.5.0 (preserving baseline step inputs).

## Determinism

LLM synthesis is non-deterministic. Determinism is preserved by caching:

- **Legacy generator:** `PlanCache` keyed by `{inputHash, modelId, promptVersion}`
- **Pipeline steps:** `STEPCACHE` keyed by SHA-256 of `{inputHash, pipelineId, pipelineConfigVersion, stepId, promptKey, promptVersion, instructionsVersion?}`

An unchanged input → cache hit → no LLM call → cached output used verbatim. Only changed inputs or config re-synthesize.

## Input snapshots (v0.5.0)

Before the cache lookup and Bedrock call, each pipeline step writes its exact input to `pipeline-outputs/{runId}/{nn}.input.json`: `model`, `outputType`, `systemPrompt {promptKey, version, body}`, `userMessage`, `sections[]`, `tool {name, schemaVersion} | null` (`plan-v1`, `plan-v2`, `critique-v1`), `priorOutputsTruncated`, `instructionsVersion | null`. Best-effort (failure logged, step continues). Read via `GET /runs/{runId}/steps/{stepIndex}`.

## Legacy client system prompt (D-33)

`createBedrockClient(model, region, promptVersion, systemText?)` (`packages/functions/src/llm.ts`): `systemText` (the prompt-version record's `text`) is authoritative; the in-code `PROMPTS.v1` is only a fallback. Before `dbd78bb` the 4th argument did not exist and was dropped, so every legacy experiment used the v1 text — non-v1 legacy results predating that fix do not reflect their prompts.

## Grounding

A requirement is **grounded** if:
1. Its text mentions a cataloged entity name (whole-word, case-insensitive, optional plural)
2. That entity exists in ≥2 sources
3. The entity has an API target in `api-map.ts`

Ungroundable requirements (infra-only, single-service, unmapped entity) are returned as `skipped` with a reason. Grounding is literal name-matching; semantic similarity is out of scope.
