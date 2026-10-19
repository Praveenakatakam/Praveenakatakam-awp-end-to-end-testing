/**
 * Shared types and sampling helpers for the configurable LLM pipeline feature.
 *
 * Covers all DynamoDB item shapes for PIPELINE, PRUN, STEP, PRMPT, PRMPTVER,
 * and SYSCONFIG/MODEL_ALLOWLIST, plus the supporting union types used across
 * packages (functions, web, testgen).
 *
 * T-01: types only; T-08: adds sampling strategy helper functions.
 *
 * Design refs: specs/active/configurable-llm-pipeline/design.md §Data Model Changes,
 *              §Sampling and Execution Mode
 * Requirements: R-01, R-02, R-11, R-17–R-21, R-27, R-31, R-32, R-45, R-47–R-50,
 *               R-51, R-52
 */
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Primitive unions
// ---------------------------------------------------------------------------

/**
 * Status values for a pipeline run record (PRUN).
 * Non-terminal: `running`. Terminal: all others.
 */
export type PipelineRunStatus =
  | 'running'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'timed_out';

/**
 * Status values for an individual step record (STEP#<index>).
 * `cached` means the step output was satisfied from the cache — no LLM call
 * was made.
 */
export type StepStatus =
  | 'running'
  | 'completed'
  | 'cached'
  | 'failed'
  | 'warning';

/**
 * Execution mode for a pipeline run.
 * - `per_requirement`: one independent PRUN per selected requirement (R-48).
 * - `batch`: one PRUN with all selected requirements injected together (R-49).
 */
export type ExecutionMode = 'per_requirement' | 'batch';

// ---------------------------------------------------------------------------
// Sampling config — discriminated union (R-45, R-48)
// ---------------------------------------------------------------------------

/**
 * Sampling strategy that selects the first `n` requirements when sorted
 * lexicographically by requirement ID.
 */
export interface SamplingFirstN {
  strategy: 'first_n';
  /** Number of requirements to select. Required for this strategy. */
  n: number;
}

/**
 * Sampling strategy that selects a deterministic subset based on a SHA-256
 * hash of each requirement ID modulo 100 (R-48).
 */
export interface SamplingPercentage {
  strategy: 'percentage';
  /** Percentage threshold (0–100). Required for this strategy. */
  percentage: number;
}

/**
 * Sampling strategy that selects only the requirements whose IDs appear in the
 * provided list.
 */
export interface SamplingIds {
  strategy: 'ids';
  /** Explicit list of requirement IDs to include. Required for this strategy. */
  ids: string[];
}

/**
 * Sampling strategy that selects all requirements without filtering.
 */
export interface SamplingAll {
  strategy: 'all';
}

/**
 * Discriminated union covering all four sampling strategies.
 * Used on `PipelineConfig.defaultSampling`, `PipelineRun.sampling`, and as the
 * optional run-request override on `POST /generate-functional-tests`.
 */
export type SamplingConfig =
  | SamplingFirstN
  | SamplingPercentage
  | SamplingIds
  | SamplingAll;

// ---------------------------------------------------------------------------
// Pipeline config item — PIPELINE#<pipelineId> / PIPELINE (R-01, R-02, R-45)
// ---------------------------------------------------------------------------

/**
 * Output contract a step's Bedrock call is shaped by (R-59, R-60, D-22):
 * - `plan`     — forced `emit_functional_test_plan` tool (PLAN_SCHEMA v2)
 * - `critique` — forced `emit_critique` tool (CRITIQUE_SCHEMA)
 * - `freeform` — no tools; the response text is the output
 */
export type StepOutputType = 'plan' | 'critique' | 'freeform';

/** Plan schema generation a `plan` step uses (R-84, D-32). */
export type PlanSchemaVersion = 'v1' | 'v2';

export const STEP_OUTPUT_TYPES: readonly StepOutputType[] = ['plan', 'critique', 'freeform'];

/**
 * A single step in an ordered pipeline step list (R-02).
 * Steps have no predefined roles; `outputType` selects the output contract (R-11, R-59).
 * `sampling` and `mode` are pipeline-level fields, not step-level.
 */
export interface PipelineStep {
  /** Unique identifier within the pipeline (e.g. `s1`). */
  stepId: string;
  /** Human-readable display name. */
  label: string;
  /** Bedrock model ID; validated against the model allowlist (R-10). */
  model: string;
  /** Reference to a `PRMPT#` item by promptKey. */
  promptKey: string;
  /**
   * When `true`, a terminal error on this step is recorded as `warning` and
   * execution continues rather than marking the run `failed` (R-15).
   * Default: `false`.
   */
  optional: boolean;
  /**
   * Reserved for a future human-review gate. In v1, treated as a no-op:
   * a warning is logged and execution proceeds immediately (R-14).
   * Default: `false`.
   */
  waitForHuman: boolean;
  /**
   * When `true`, prior step outputs (`priorOutputs`) are included in the
   * context passed to the LLM. When `false`, only the original grounded
   * context is included (R-12).
   * Default: `true`.
   */
  includeContext: boolean;
  /**
   * Output contract for this step (R-59). Optional on the type because steps
   * persisted before v0.4.0 lack it — read via `resolveOutputType()`.
   * Default: `'plan'`.
   */
  outputType?: StepOutputType;
  /**
   * When true, the runtime appends output-format instructions for this step's
   * outputType to the user message (R-73). Default false — baseline steps
   * receive exactly the pre-v0.5.0 input.
   */
  outputInstructions?: boolean;
  /**
   * Plan schema for `outputType: 'plan'` steps (R-84). `'v1'` reproduces the
   * legacy generator exactly (PLAN_SCHEMA_V1, legacy emitter). Default `'v2'`.
   */
  planSchema?: PlanSchemaVersion;
}

/** A step's effective output type — `'plan'` when unset (R-59, TS-45). */
export function resolveOutputType(step: Pick<PipelineStep, 'outputType'>): StepOutputType {
  return step.outputType ?? 'plan';
}

/**
 * DynamoDB item shape for a pipeline configuration record.
 * PK: `PIPELINE#<pipelineId>` / SK: `PIPELINE`
 */
export interface PipelineConfig {
  /** DynamoDB partition key: `PIPELINE#<pipelineId>`. */
  pk: string;
  /** DynamoDB sort key: `PIPELINE`. */
  sk: string;
  /** GSI partition key used by `byKind` GSI for list queries. */
  kind: 'PIPELINE';

  /** UUID identifying this pipeline. */
  pipelineId: string;
  /** Human-readable name. */
  name: string;
  /** Ordered list of steps. */
  steps: PipelineStep[];
  /**
   * Maximum number of steps allowed for this pipeline.
   * Hard cap: 20 (R-04). Default: 10 (R-05).
   */
  maxSteps: number;
  /**
   * Maximum wall-clock run age in minutes; the step Lambda halts and marks the
   * run `timed_out` if exceeded before dispatching the next step (R-23).
   * Default: 60.
   */
  maxAgeMinutes: number;
  /** `false` indicates a soft-deleted pipeline (R-08). */
  active: boolean;
  /**
   * Default sampling config used when no override is provided on the run
   * request (R-45, R-50). Default: `{ strategy: "first_n", n: 3 }`.
   */
  defaultSampling: SamplingConfig;
  /**
   * Default execution mode used when no override is provided on the run
   * request (R-45, R-50). Default: `"per_requirement"`.
   */
  defaultMode: ExecutionMode;
  /**
   * Monotonically increasing integer bumped on every `PUT` (R-07, R-30).
   * Included in step cache keys so that any pipeline edit busts the cache.
   */
  version: number;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp (R-07). */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pipeline run record — PRUN#<runId> / PRUN (R-17)
// ---------------------------------------------------------------------------

/**
 * DynamoDB item shape for a pipeline run record.
 * PK: `PRUN#<runId>` / SK: `PRUN`
 *
 * Step records for the same run share the same PK (`PRUN#<runId>`) with SK
 * `STEP#<index>`, allowing a single `Query` to return the run plus all steps.
 */
export interface PipelineRun {
  /** DynamoDB partition key: `PRUN#<runId>`. */
  pk: string;
  /** DynamoDB sort key: `PRUN`. */
  sk: string;
  /** GSI partition key. */
  kind: 'PRUN';

  /** UUID for this run. */
  runId: string;
  /** The pipeline that produced this run. */
  pipelineId: string;
  /**
   * Snapshot of the pipeline `version` at run start. Steps execute with this
   * config version so in-flight runs are not affected by pipeline edits (R-30).
   */
  pipelineConfigVersion: number;
  /** Current run status. */
  status: PipelineRunStatus;
  /** ISO-8601 timestamp when the run was created. */
  startedAt: string;
  /** ISO-8601 timestamp set on terminal transition. */
  completedAt?: string;
  /** ISO-8601 timestamp set when `status` transitions to `failed`. */
  failedAt?: string;
  /** Sanitized terminal error message (set on `failed`). */
  errorMessage?: string;
  /** Sanitized stack trace (set on `failed`; truncated to fit DDB item limit). */
  errorStack?: string;
  /**
   * Resolved sampling config used for this run (after run-request override
   * applied — R-47, R-50).
   */
  sampling: SamplingConfig;
  /**
   * Resolved execution mode used for this run (after run-request override
   * applied — R-47, R-50).
   */
  mode: ExecutionMode;
  /**
   * Requirement IDs selected by the sampling strategy for this run (R-48, R-49).
   * For `per_requirement` mode this contains exactly one ID; for `batch` mode
   * it contains all selected IDs.
   */
  requirementIds: string[];
  /**
   * Count of steps attempted; incremented by the step Lambda before each
   * invocation. Compared against `maxSteps` to detect over-run (R-22).
   */
  executedSteps: number;
  /** Collected warning messages from optional steps that failed (R-15). */
  warnings: string[];
  /** The pipeline experiment (one trigger) this run belongs to (R-80); absent on pre-v0.6.0 runs. */
  experimentId?: string;
  /**
   * The emitted functional test rendered from the last completed `plan` step,
   * set when the run completes (R-65, D-26). Absent if no plan step produced output.
   */
  artifact?: RunArtifact;
}

/** Pointer to a run's emitted test file (R-65). */
export interface RunArtifact {
  /** The pipeline step whose plan was rendered. */
  stepId: string;
  /** S3 key — `pipeline-outputs/<runId>/test.generated.ts`. */
  s3Key: string;
  /** Suggested repo-relative path, e.g. `functional/<slug>.generated.test.ts`. */
  path: string;
}

/** A requirement excluded from sampling because it could not be grounded (R-55). */
export interface SkippedRequirement {
  /** Source-qualified requirement ID, `<source>/<id>` (R-57). */
  requirement: string;
  reason: string;
}

/** `202` body of `POST /generate-functional-tests` on the pipeline path (R-48, R-49, R-55). */
export type GeneratePipelineResponse =
  | { runIds: string[]; skipped: SkippedRequirement[]; experimentId: string }
  | { runId: string; skipped: SkippedRequirement[]; experimentId: string };

// ---------------------------------------------------------------------------
// Step record — PRUN#<runId> / STEP#<stepIndex> (R-18, R-19, R-51)
// ---------------------------------------------------------------------------

/**
 * Where a step's output is stored.
 * Inline for outputs ≤ 64 KB; S3 reference for larger outputs (R-19, R-34).
 */
export type StepOutputRef =
  | { inline: string }
  | { s3Key: string };

/**
 * DynamoDB item shape for a step execution record.
 * PK: `PRUN#<runId>` / SK: `STEP#<zero-padded-index>` (e.g. `STEP#00`)
 *
 * All metric fields are optional because they are populated during or after
 * execution; the record is created at step-start with only status and lease.
 */
export interface StepRecord {
  /** DynamoDB partition key: `PRUN#<runId>` (same as the parent run). */
  pk: string;
  /** DynamoDB sort key: `STEP#<zero-padded-index>`, e.g. `STEP#00`, `STEP#01`. */
  sk: string;

  /** Step ID from the pipeline config. */
  stepId: string;
  /** Zero-based index within the pipeline step list. */
  stepIndex: number;
  /** Step label from the pipeline config at execution time. */
  label: string;
  /** Bedrock model ID from the pipeline config at execution time. */
  model: string;
  /** Prompt key from the pipeline config at execution time. */
  promptKey: string;
  /** Version of the prompt fetched at execution time (used in cache key — R-27). */
  promptVersion: number;
  /** Current step status. */
  status: StepStatus;
  /**
   * ISO-8601 timestamp after which this step's lease is considered expired.
   * Written before each LLM attempt (R-18) and cleared on successful completion
   * or terminal failure (R-19). Absence of this field after a step reaches a
   * terminal state is expected.
   */
  leaseExpiresAt?: string;
  /** SHA-256 hex digest of the cache key tuple (R-27). */
  cacheKey: string;
  /** Where the step's output string is stored. Present after successful completion. */
  outputRef?: StepOutputRef;
  /** S3 pointer to this step's input snapshot (R-74); absent for pre-v0.5.0 steps. */
  inputRef?: { s3Key: string };

  // — Metrics (R-51) — all optional; populated on completion or failure —

  /** Total step execution time in milliseconds (from lease write to step record update). */
  durationMs?: number;
  /** Time in milliseconds from Bedrock `InvokeModel` call start to response received. */
  bedrockLatencyMs?: number;
  /** Input token count from Bedrock response `usage.input_tokens`. */
  inputTokens?: number;
  /** Output token count from Bedrock response `usage.output_tokens`. */
  outputTokens?: number;
  /** Character count of the full context string sent to Bedrock. */
  inputCharacters?: number;
  /** Character count of the raw output string received from Bedrock. */
  outputCharacters?: number;
  /**
   * Estimated token count of the full context payload (character heuristic:
   * `Math.ceil(serialized.length / 4)`) — R-13, D-15.
   */
  contextTokenEstimate?: number;
  /**
   * Estimated cost in USD: `(inputTokens × inputPricePerToken) +
   * (outputTokens × outputPricePerToken)` using the per-model price table
   * from `SYSCONFIG / MODEL_ALLOWLIST` — R-51, D-21.
   */
  costEstimateUsd?: number;
  /**
   * Sanitized error message if the step failed; API keys, tokens, and secrets
   * redacted via the existing `redact()` utility (R-51).
   */
  errorMessage?: string;
  /**
   * Sanitized stack trace if the step failed; same redaction applied (R-51).
   */
  errorStack?: string;
  /** `true` when prior outputs were cut to fit `PRIOR_OUTPUT_BUDGET_CHARS` (R-63). */
  priorOutputsTruncated?: boolean;

  /** ISO-8601 timestamp when this step began execution. */
  startedAt: string;
  /** ISO-8601 timestamp set on terminal transition (success or failure). */
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Prompt header — PRMPT#<promptKey> / PRMPT (R-31, R-52, D-11)
// ---------------------------------------------------------------------------

/**
 * DynamoDB item shape for a prompt header record.
 * PK: `PRMPT#<promptKey>` / SK: `PRMPT`
 *
 * Note: uses `PRMPT` prefix (not `PROMPT`) to avoid collision with existing
 * `PROMPT#v1` PromptVersionRecord items already in the table (D-11).
 */
export interface PromptItem {
  /** DynamoDB partition key: `PRMPT#<promptKey>`. */
  pk: string;
  /** DynamoDB sort key: `PRMPT`. */
  sk: string;
  /** GSI partition key. */
  kind: 'PRMPT';

  /** Human-readable identifier (e.g. `functional-test-gen-v2`). */
  promptKey: string;
  /** Monotonically increasing version number; incremented on each `PUT` (R-32). */
  currentVersion: number;
  /** Inline prompt body for prompts ≤ 64 KB (R-34). */
  body?: string;
  /** S3 key reference for prompt bodies > 64 KB (R-34). */
  s3Ref?: string;
  /**
   * `false` indicates a soft-deleted prompt (R-52). Soft-deleted prompts are
   * excluded from `GET /prompts` list responses and cause a 422 on pipeline
   * writes that reference them.
   */
  active: boolean;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Prompt version record — PRMPTVER#<promptKey>#<version> / PRMPTVER (R-32)
// ---------------------------------------------------------------------------

/**
 * DynamoDB item shape for an immutable prompt version record.
 * PK: `PRMPTVER#<promptKey>#<zero-padded-version>` (e.g. `PRMPTVER#my-prompt#00001`)
 * SK: `PRMPTVER`
 *
 * Once written, version records are immutable (R-32).
 */
export interface PromptVersionItem {
  /** DynamoDB partition key: `PRMPTVER#<promptKey>#<zero-padded-version>`. */
  pk: string;
  /** DynamoDB sort key: `PRMPTVER`. */
  sk: string;
  /** GSI partition key. */
  kind: 'PRMPTVER';

  /** The prompt this version belongs to. */
  promptKey: string;
  /** Version number (1-based). */
  version: number;
  /** Inline prompt body for versions ≤ 64 KB (R-34). */
  body?: string;
  /** S3 key reference for versions > 64 KB (R-34). */
  s3Ref?: string;
  /** ISO-8601 timestamp when this version was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Model allowlist — SYSCONFIG / MODEL_ALLOWLIST (R-10, D-16, D-21)
// ---------------------------------------------------------------------------

/**
 * Per-model pricing entry stored in the `pricing` map on `ModelAllowlist`.
 * Prices are in USD per million tokens (D-21).
 */
export interface ModelPricing {
  /** Cost in USD per one million input tokens. */
  inputPricePerMillionTokens: number;
  /** Cost in USD per one million output tokens. */
  outputPricePerMillionTokens: number;
}

/**
 * DynamoDB item shape for the model allowlist system config.
 * PK: `SYSCONFIG` / SK: `MODEL_ALLOWLIST`
 *
 * Seeded at deploy time; updatable at runtime via direct DDB write (no API
 * route in v1). The step Lambda reads this at execution time to validate step
 * models and compute `costEstimateUsd` (R-10, D-21).
 */
export interface ModelAllowlist {
  /** DynamoDB partition key: `SYSCONFIG`. */
  pk: string;
  /** DynamoDB sort key: `MODEL_ALLOWLIST`. */
  sk: string;

  /** Permitted Bedrock model IDs (e.g. `us.anthropic.claude-sonnet-4-6`). */
  allowedModels: string[];
  /**
   * Per-model pricing map used to compute `costEstimateUsd` on step records.
   * Keyed by model ID; values contain input and output prices per million
   * tokens (D-21).
   */
  pricing: Record<string, ModelPricing>;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sampling strategy helper — selectRequirements (T-08, R-47, R-48, R-49, R-50)
// ---------------------------------------------------------------------------

/**
 * Apply a sampling strategy to a list of requirement IDs, returning the
 * selected subset.
 *
 * - `first_n`:    Sort lexicographically, take first `n`. (R-48)
 * - `percentage`: Deterministic SHA-256 hash subset — same IDs selected on
 *                 every call with the same percentage. (R-48)
 * - `ids`:        Filter to only the IDs in `sampling.ids`, sorted. (R-48)
 * - `all`:        Return all IDs (no filtering). (R-48)
 *
 * The function is pure with no AWS dependencies. It is placed in `@registry/core`
 * so it can be shared between `packages/functions` and `packages/functest`
 * without creating a cross-package dependency on the Lambda runtime.
 */
export function selectRequirements(allReqs: string[], sampling: SamplingConfig): string[] {
  switch (sampling.strategy) {
    case 'first_n': {
      const sorted = [...allReqs].sort();
      return sorted.slice(0, sampling.n);
    }
    case 'percentage': {
      const pct = sampling.percentage;
      return allReqs
        .filter((reqId) => {
          const hash = createHash('sha256').update(reqId).digest('hex');
          return parseInt(hash.slice(0, 8), 16) % 100 < pct;
        })
        .sort();
    }
    case 'ids': {
      const idSet = new Set(sampling.ids);
      return allReqs.filter((id) => idSet.has(id)).sort();
    }
    case 'all': {
      return [...allReqs].sort();
    }
  }
}

// ---------------------------------------------------------------------------
// Step transparency (v0.5.0 — R-74, R-75)
// ---------------------------------------------------------------------------

/** One named part of the user message sent to the model (R-74). */
export interface UserMessageSection {
  /** e.g. `Requirement`, `Entity`, `Contract schema`, `API targets`, `Prior step outputs`, `Output instructions`. */
  name: string;
  text: string;
}

/**
 * Exact model input for one step, written to S3 at
 * `pipeline-outputs/<runId>/<nn>.input.json` before the Bedrock call (R-74, D-29).
 */
export interface StepInputSnapshot {
  model: string;
  outputType: StepOutputType;
  systemPrompt: { promptKey: string; version: number; body: string };
  /** The exact user-message string sent. */
  userMessage: string;
  sections: UserMessageSection[];
  /** Forced tool, or `null` for `freeform`. */
  tool: { name: string; schemaVersion: string } | null;
  priorOutputsTruncated: boolean;
  /** `OUTPUT_INSTRUCTIONS_VERSION` when the step opted in to output instructions; `null` otherwise. */
  instructionsVersion: string | null;
}

/** `GET /runs/{runId}/steps/{stepIndex}` response (R-75). */
export interface RunStepDetail {
  step: StepRecord;
  /** `null` for steps recorded before v0.5.0. */
  input: StepInputSnapshot | null;
  /** Output resolved from inline or S3; `null` if the step produced none. */
  output: string | null;
}

// ---------------------------------------------------------------------------
// Unified experiments (v0.6.0 — R-80 – R-83, D-31)
// ---------------------------------------------------------------------------

/** `PEXP#<experimentId> / PEXP` — one trigger of a pipeline, grouping its runs (R-80). */
export interface PipelineExperiment {
  pk: string;
  sk: 'PEXP';
  kind: 'PEXP';
  experimentId: string;
  pipelineId: string;
  pipelineName: string;
  pipelineConfigVersion: number;
  sampling: SamplingConfig;
  mode: ExecutionMode;
  runs: { runId: string; requirementIds: string[] }[];
  skipped: SkippedRequirement[];
  createdAt: string;
  /** Equal to `createdAt`; present so the `byKind` GSI indexes PEXP items. */
  startedAt: string;
  createdBy: string;
}

export type ExperimentKind = 'pipeline' | 'legacy';

/** One row of `GET /experiment-index` (R-82). */
export interface ExperimentIndexEntry {
  id: string;
  kind: ExperimentKind;
  /** `<pipelineName> v<configVersion>` for pipeline; the prompt version for legacy. */
  label: string;
  createdAt: string;
  status: PipelineRunStatus | 'pending' | 'running' | 'succeeded' | 'failed';
  requirementCount: number;
  resultCount: number;
  skipCount: number;
}

/** One requirement's outcome within an experiment (R-83). */
export interface ExperimentResult {
  /** Source-qualified where resolvable (R-57). */
  requirementId: string;
  /** Pipeline experiments only. */
  runId?: string;
  status: string;
  /** Parsed plan (v1 or v2 shape), or `null` if none was produced. */
  plan: unknown | null;
  testFile: { path: string; content: string } | null;
}

/** `GET /experiment-results/{kind}/{id}` response (R-83). */
export interface ExperimentResults {
  experiment: ExperimentIndexEntry;
  results: ExperimentResult[];
  skipped: SkippedRequirement[];
}

/** `POST /generate-functional-tests` with `dryRun: true` (R-81). */
export interface GeneratePipelineDryRunResponse {
  selected: string[];
  skipped: SkippedRequirement[];
}
