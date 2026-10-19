/**
 * API client. Attaches the Cognito access token as a Bearer header
 * on every call, matching the HTTP API's Lambda authorizer.
 */
import { config } from './config.js';
import type { Entry, RequirementEntry } from './lib.js';
import type { PromptVersionRecord, ExperimentRecord } from '@registry/core';
import type {
  PipelineConfig,
  PromptItem,
  PipelineRun,
  StepRecord,
  SkippedRequirement,
  RunStepDetail,
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
    createPromptVersion: async (payload: { promptVersion: string; text: string; modelId: string; notes?: string }): Promise<PromptVersionRecord> =>
      (await reqMut('/prompt-versions', { method: 'POST', ...jsonBody(payload) })).json(),
    listPromptVersions: async (): Promise<{ promptVersions: Omit<PromptVersionRecord, 'text'>[] }> =>
      (await req('/prompt-versions')).json(),
    getPromptVersion: async (promptVersion: string): Promise<PromptVersionRecord> =>
      (await req(`/prompt-versions/${encodeURIComponent(promptVersion)}`)).json(),
    createExperiment: async (payload: { promptVersion: string }): Promise<{ experimentId: string; statusUrl: string }> =>
      (await reqMut('/experiments', { method: 'POST', ...jsonBody(payload) })).json(),
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
    runPipeline: async (pipelineId: string): Promise<RunTriggerResult> => {
      const res = await (await reqMut('/generate-functional-tests', { method: 'POST', ...jsonBody({ pipelineId }) })).json();
      const runIds: string[] = Array.isArray(res.runIds) ? res.runIds : res.runId ? [res.runId] : [];
      return { runIds, skipped: Array.isArray(res.skipped) ? res.skipped : [] };
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
     * POST /prompts/import-legacy (writer-only, R-72)
     * Copies legacy prompt versions into the prompt store; idempotent.
     */
    importLegacyPrompts: async (): Promise<ImportLegacyResult> => {
      const res = await (await reqMut('/prompts/import-legacy', { method: 'POST' })).json();
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
  };
}

export type Api = ReturnType<typeof createApi>;
