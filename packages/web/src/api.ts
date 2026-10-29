/**
 * API client. Attaches the Cognito access token as a Bearer header
 * on every call, matching the HTTP API's Lambda authorizer.
 */
import { config } from './config.js';
import type { Entry, RequirementEntry, AdversarialFinding, AdversarialRunSummary, VerificationStatus } from './lib.js';
import type { PromptVersionRecord, ExperimentRecord } from '@registry/core';
import type {
  PipelineConfig,
  PromptItem,
  PipelineRun,
  StepRecord,
  SkippedRequirement,
  RunStepDetail,
  ExecutionMode,
  ExperimentIndexEntry,
  ExperimentKind,
  ExperimentResults,
  GeneratePipelineDryRunResponse,
  SamplingConfig,
} from '@registry/core';

export class ApiError extends Error {
  /** Server-provided error message from the response body (e.g. 422 validation detail). */
  serverMessage?: string;
  /** Requirements excluded by grounding, when a run trigger is rejected with 422 (R-56). */
  skipped?: SkippedRequirement[];
  constructor(public status: number, serverMessage?: string, skipped?: SkippedRequirement[]) {
    super(`API ${status}`);
    this.serverMessage = serverMessage;
    this.skipped = skipped;
  }
}

/** Normalised `202` body of a pipeline run trigger (R-48, R-49, R-55). */
export interface RunTriggerResult {
  /** One id for batch mode; one per selected requirement for per_requirement mode. */
  runIds: string[];
  skipped: SkippedRequirement[];
  /** The pipeline experiment grouping these runs (R-80); absent from pre-v0.6.0 backends. */
  experimentId?: string;
}

/** Optional per-trigger overrides of the pipeline's defaults (R-50, D-19). */
export interface RunOverrides {
  sampling?: SamplingConfig;
  mode?: ExecutionMode;
}

/** `GET /runs/{runId}/artifact` (R-65). */
export interface RunArtifactContent {
  path: string;
  content: string;
}

/** `POST /prompts/import-legacy` (R-72). */
export interface ImportLegacyResult {
  imported: string[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Shared request helpers
// ---------------------------------------------------------------------------

function buildHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), authorization: `Bearer ${token}` };
}

export function createApi(getToken: () => Promise<string>) {
  /** Read-only request — throws ApiError for any non-2xx. */
  const req = async (path: string, init: RequestInit = {}) => {
    const token = await getToken();
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: buildHeaders(token, init.headers),
    });
    if (!res.ok) throw new ApiError(res.status);
    return res;
  };

  /**
   * Mutation request — same as req but parses the response body on non-2xx to
   * populate ApiError.serverMessage (e.g. for 422 validation errors).
   */
  const reqMut = async (path: string, init: RequestInit = {}) => {
    const token = await getToken();
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: buildHeaders(token, init.headers),
    });
    if (!res.ok) {
      let serverMessage: string | undefined;
      let skipped: SkippedRequirement[] | undefined;
      try {
        const body = await res.json();
        if (typeof body.error === 'string') serverMessage = body.error;
        if (Array.isArray(body.skipped)) skipped = body.skipped;
      } catch {
        // ignore parse errors — leave serverMessage undefined
      }
      throw new ApiError(res.status, serverMessage, skipped);
    }
    return res;
  };

  const jsonBody = (payload: unknown): RequestInit => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // ---------------------------------------------------------------------------
  // Existing methods (unchanged)
  // ---------------------------------------------------------------------------

  return {
    listContracts: async (): Promise<Entry[]> => (await (await req('/contracts')).json()).items,
    getContract: async (source: string, id: string) => (await req(`/contracts/${source}/${id}`)).json(),
    getRaw: async (source: string, id: string, version?: number) =>
      (await req(`/contracts/${source}/${id}/raw${version ? `?version=${version}` : ''}`)).text(),
    getEntity: async (entity: string) => (await req(`/entities/${entity}`)).json(),
    listCrawls: async () => (await (await req('/crawls')).json()).runs,
    refresh: async () => (await req('/refresh', { method: 'POST' })).json(),
    listRequirements: async (): Promise<RequirementEntry[]> => (await (await req('/requirements')).json()).items,
    listPromptVersions: async (): Promise<{ promptVersions: Omit<PromptVersionRecord, 'text'>[] }> =>
      (await req('/prompt-versions')).json(),
    getPromptVersion: async (promptVersion: string): Promise<PromptVersionRecord> =>
      (await req(`/prompt-versions/${encodeURIComponent(promptVersion)}`)).json(),
    listExperiments: async (): Promise<{ experiments: ExperimentRecord[] }> =>
      (await req('/experiments')).json(),
    getExperiment: async (experimentId: string): Promise<ExperimentRecord> =>
      (await req(`/experiments/${experimentId}`)).json(),
    getExperimentArtifact: async (experimentId: string): Promise<{ experimentId: string; promptVersion: string; status: string; planCount?: number; skipCount?: number; artifact: unknown }> =>
      (await req(`/experiments/${experimentId}/artifact`)).json(),

    // -------------------------------------------------------------------------
    // Pipeline CRUD (T-11, R-35, R-37, R-38, R-39)
    // -------------------------------------------------------------------------

    /**
     * GET /pipelines[?nextToken=...]
     * Returns the active-pipeline list with optional pagination token.
     */
    listPipelines: async (nextToken?: string): Promise<{ pipelines: PipelineConfig[]; nextToken?: string }> => {
      const res = await (await req(`/pipelines${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`)).json();
      // Backend returns { items, nextToken? } — remap to { pipelines, nextToken? }
      return { pipelines: res.items ?? res.pipelines ?? [], nextToken: res.nextToken };
    },

    /**
     * GET /pipelines/{id}
     * Returns the full pipeline config record.
     */
    getPipeline: async (id: string): Promise<PipelineConfig> =>
      (await req(`/pipelines/${encodeURIComponent(id)}`)).json(),

    /**
     * POST /pipelines
     * Creates a new pipeline. Returns the created record (HTTP 201).
     * Throws ApiError(422) with serverMessage on validation failure.
     */
    createPipeline: async (
      body: Omit<PipelineConfig, 'pk' | 'sk' | 'kind' | 'pipelineId' | 'version' | 'createdAt' | 'updatedAt'>
    ): Promise<PipelineConfig> =>
      (await reqMut('/pipelines', { method: 'POST', ...jsonBody(body) })).json(),

    /**
     * PUT /pipelines/{id}
     * Updates an existing pipeline; bumps version. Returns the updated record.
     * Throws ApiError(422) on validation failure; ApiError(409) on active-run
     * guard conflict.
     */
    updatePipeline: async (id: string, body: Partial<PipelineConfig>): Promise<PipelineConfig> =>
      (await reqMut(`/pipelines/${encodeURIComponent(id)}`, { method: 'PUT', ...jsonBody(body) })).json(),

    /**
     * DELETE /pipelines/{id}
     * Soft-deletes the pipeline (sets active: false). Returns void.
     * Throws ApiError(409) if a run is in `running` status.
     */
    deletePipeline: async (id: string): Promise<void> => {
      await reqMut(`/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /**
     * POST /generate-functional-tests with pipelineId
     * Starts a pipeline run. Backend returns `{ runId, skipped }` (batch) or
     * `{ runIds, skipped }` (per_requirement) — normalised to `{ runIds, skipped }`.
     * Throws ApiError(422) with `skipped` when nothing grounds (R-56).
     */
    runPipeline: async (pipelineId: string, overrides: RunOverrides = {}): Promise<RunTriggerResult> => {
      const res = await (await reqMut('/generate-functional-tests', { method: 'POST', ...jsonBody({ pipelineId, ...overrides }) })).json();
      const runIds: string[] = Array.isArray(res.runIds) ? res.runIds : res.runId ? [res.runId] : [];
      const out: RunTriggerResult = { runIds, skipped: Array.isArray(res.skipped) ? res.skipped : [] };
      if (typeof res.experimentId === 'string') out.experimentId = res.experimentId;
      return out;
    },

    /**
     * POST /generate-functional-tests with `dryRun: true` (R-81) — grounding +
     * sampling only; nothing is written or dispatched. `200 { selected, skipped }`.
     */
    dryRunPipeline: async (pipelineId: string, overrides: RunOverrides = {}): Promise<GeneratePipelineDryRunResponse> => {
      const res = await (await reqMut('/generate-functional-tests', { method: 'POST', ...jsonBody({ pipelineId, ...overrides, dryRun: true }) })).json();
      return {
        selected: Array.isArray(res.selected) ? res.selected : [],
        skipped: Array.isArray(res.skipped) ? res.skipped : [],
      };
    },

    // -------------------------------------------------------------------------
    // Unified experiments (v0.6.0 — R-82, R-83)
    // -------------------------------------------------------------------------

    /**
     * GET /experiment-index — pipeline + legacy experiments, newest first.
     * Spec shape is `{ experiments }`; a bare array or `{ items }` is also accepted.
     */
    listExperimentIndex: async (): Promise<ExperimentIndexEntry[]> => {
      const res = await (await req('/experiment-index')).json();
      if (Array.isArray(res)) return res;
      return res.experiments ?? res.items ?? [];
    },

    /** GET /experiment-results/{kind}/{id} — normalised per-requirement results (R-83). */
    getExperimentResults: async (kind: ExperimentKind, id: string): Promise<ExperimentResults> => {
      const res = await (await req(`/experiment-results/${kind}/${encodeURIComponent(id)}`)).json();
      return { experiment: res.experiment, results: res.results ?? [], skipped: res.skipped ?? [] };
    },

    // -------------------------------------------------------------------------
    // Prompt CRUD (T-11, R-31, R-35, R-37, R-41)
    // -------------------------------------------------------------------------

    /**
     * GET /prompts[?nextToken=...]
     * Returns active prompts (soft-deleted excluded) with optional pagination.
     */
    listPrompts: async (nextToken?: string): Promise<{ prompts: PromptItem[]; nextToken?: string }> => {
      const res = await (await req(`/prompts${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`)).json();
      // Backend returns { items, nextToken? } — remap to { prompts, nextToken? }
      return { prompts: res.items ?? res.prompts ?? [], nextToken: res.nextToken };
    },

    /**
     * GET /prompts/{key}
     * Returns the full prompt header record.
     */
    getPrompt: async (key: string): Promise<PromptItem> =>
      (await req(`/prompts/${encodeURIComponent(key)}`)).json(),

    /**
     * POST /prompts
     * Creates a new prompt (version 1). Returns the created record (HTTP 201).
     */
    createPrompt: async (body: { promptKey: string; body: string }): Promise<PromptItem> =>
      (await reqMut('/prompts', { method: 'POST', ...jsonBody(body) })).json(),

    /**
     * PUT /prompts/{key}
     * Updates prompt body; writes a new immutable version record.
     * Returns the updated prompt header.
     */
    updatePrompt: async (key: string, body: { body: string }): Promise<PromptItem> =>
      (await reqMut(`/prompts/${encodeURIComponent(key)}`, { method: 'PUT', ...jsonBody(body) })).json(),

    /**
     * DELETE /prompts/{key}
     * Soft-deletes the prompt (sets active: false). Returns void.
     * Throws ApiError(422) if the prompt is still referenced by an active pipeline.
     */
    deletePrompt: async (key: string): Promise<void> => {
      await reqMut(`/prompts/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },

    /**
     * GET /prompts/{key}/versions
     * Returns the version history for a prompt (version number + createdAt per entry).
     */
    getPromptVersions: async (
      key: string
    ): Promise<{ promptKey: string; versions: { version: number; createdAt: string }[] }> =>
      (await req(`/prompts/${encodeURIComponent(key)}/versions`)).json(),

    /**
     * POST /prompts/import-legacy (writer-only, R-72, R-86)
     * Copies legacy prompt versions into the prompt store; idempotent. With
     * `{ promptVersions }` only those versions are imported.
     */
    importLegacyPrompts: async (body?: { promptVersions: string[] }): Promise<ImportLegacyResult> => {
      const init: RequestInit = body ? { method: 'POST', ...jsonBody(body) } : { method: 'POST' };
      const res = await (await reqMut('/prompts/import-legacy', init)).json();
      return { imported: res.imported ?? [], skipped: res.skipped ?? [] };
    },

    // -------------------------------------------------------------------------
    // Pipeline run (T-11, R-54)
    // -------------------------------------------------------------------------

    /**
     * GET /runs/{runId}
     * Returns the pipeline run record plus all associated step records.
     * The read handler performs a lazy lease-expiry check (T-05, R-25).
     */
    getPipelineRun: async (runId: string): Promise<{ run: PipelineRun; steps: StepRecord[] }> =>
      (await req(`/runs/${encodeURIComponent(runId)}`)).json(),

    /**
     * GET /runs/{runId}/artifact (R-65) — the emitted test file. 404 when unset.
     */
    getRunArtifact: async (runId: string): Promise<RunArtifactContent> =>
      (await req(`/runs/${encodeURIComponent(runId)}/artifact`)).json(),

    /**
     * GET /runs/{runId}/steps/{stepIndex} (R-75) — one step's record, its input
     * snapshot (`null` before v0.5.0) and its output resolved from inline or S3.
     */
    getRunStep: async (runId: string, stepIndex: number): Promise<RunStepDetail> =>
      (await req(`/runs/${encodeURIComponent(runId)}/steps/${stepIndex}`)).json(),

    listRuns: async (nextToken?: string): Promise<{ items: PipelineRun[]; nextToken?: string }> => {
      const res = await (await req(`/runs${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`)).json();
      return { items: res.items ?? [], nextToken: res.nextToken };
    },

    // -------------------------------------------------------------------------
    // Adversarial review API (auto-polling support)
    // -------------------------------------------------------------------------

    /**
     * GET /adversarial-runs?kind={test|code}
     * Lists adversarial review runs for the given kind, newest first.
     */
    listAdversarialRuns: async (kind: 'test' | 'code' | 'requirements'): Promise<AdversarialRunSummary[]> => {
      const res = await (await req(`/adversarial-runs?kind=${encodeURIComponent(kind)}`)).json();
      return Array.isArray(res) ? res : [];
    },

    /**
     * GET /adversarial-runs/{kind}/{run_dir}/findings
     * Fetches findings for a specific adversarial review run.
     */
    getAdversarialFindings: async (
      kind: 'test' | 'code' | 'requirements',
      runDir: string
    ): Promise<{ findings: AdversarialFinding[]; verificationStatus: VerificationStatus }> => {
      const res = await (await req(`/adversarial-runs/${encodeURIComponent(kind)}/${encodeURIComponent(runDir)}/findings`)).json();
      return res;
    },

    /**
     * GET /adversarial-runs/{kind}/{run_dir}/metadata
     * Gets metadata about a run, including lastModified timestamp for polling detection.
     * Used to detect when review.json has been updated without fetching the full findings.
     */
    getAdversarialRunMetadata: async (
      kind: 'test' | 'code' | 'requirements',
      runDir: string
    ): Promise<{ lastModified: number; sha256: string; updatedAt?: string }> => {
      try {
        const res = await (await req(`/adversarial-runs/${encodeURIComponent(kind)}/${encodeURIComponent(runDir)}/metadata`)).json();
        return res;
      } catch {
        // Fallback if metadata endpoint doesn't exist
        return { lastModified: Date.now(), sha256: '', updatedAt: new Date().toISOString() };
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
