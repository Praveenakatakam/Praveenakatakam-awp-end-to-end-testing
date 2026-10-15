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
} from '@registry/core';

export class ApiError extends Error {
  /** Server-provided error message from the response body (e.g. 422 validation detail). */
  serverMessage?: string;
  constructor(public status: number, serverMessage?: string) {
    super(`API ${status}`);
    this.serverMessage = serverMessage;
  }
}

// ---------------------------------------------------------------------------
// Shared request helpers
// ---------------------------------------------------------------------------

function buildHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), authorization: `Bearer ${token}` };
}

export function createApi(token: string) {
  /** Read-only request — throws ApiError for any non-2xx. */
  const req = async (path: string, init: RequestInit = {}) => {
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
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: buildHeaders(token, init.headers),
    });
    if (!res.ok) {
      let serverMessage: string | undefined;
      try {
        const body = await res.json();
        if (typeof body.error === 'string') serverMessage = body.error;
      } catch {
        // ignore parse errors — leave serverMessage undefined
      }
      throw new ApiError(res.status, serverMessage);
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
    listPipelines: async (nextToken?: string): Promise<{ pipelines: PipelineConfig[]; nextToken?: string }> =>
      (await req(`/pipelines${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`)).json(),

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

    // -------------------------------------------------------------------------
    // Prompt CRUD (T-11, R-31, R-35, R-37, R-41)
    // -------------------------------------------------------------------------

    /**
     * GET /prompts[?nextToken=...]
     * Returns active prompts (soft-deleted excluded) with optional pagination.
     */
    listPrompts: async (nextToken?: string): Promise<{ prompts: PromptItem[]; nextToken?: string }> =>
      (await req(`/prompts${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ''}`)).json(),

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
  };
}

export type Api = ReturnType<typeof createApi>;
