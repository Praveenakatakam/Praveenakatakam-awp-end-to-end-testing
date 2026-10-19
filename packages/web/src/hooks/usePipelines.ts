/**
 * TanStack Query hooks for pipeline and prompt CRUD (T-11, D-14).
 *
 * Usage pattern: each hook accepts the `api` instance as its first argument.
 * The api instance is created by `createApi(token)` in AppShell/AppRoutes and
 * passed down as a prop to the new pipeline/prompt pages.
 *
 * QueryKey structure (matches design D-14):
 *   ['pipelines']                          — pipeline list
 *   ['pipelines', pipelineId]              — single pipeline
 *   ['pipelines', 'runs', runId]           — pipeline run with step records
 *   ['prompts']                            — prompt list
 *   ['prompts', promptKey]                 — single prompt
 *   ['prompts', promptKey, 'versions']     — prompt version history
 *   ['pipelines', 'runs', runId, 'artifact'] — emitted test file for a run (R-65)
 *   ['pipelines', 'runs', runId, 'steps', stepIndex] — step detail: input + output (R-75)
 *   ['prompt-versions']                    — legacy prompt versions (R-89)
 *   ['experiment-index']                   — unified experiment list (R-82)
 *   ['experiment-results', kind, id]       — one experiment's results (R-83)
 *
 * Requirements: R-35, R-37, R-38, R-39, R-41, R-54
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import type { Api, RunOverrides } from '../api.js';
import type { ExperimentIndexEntry, ExperimentKind, PipelineConfig } from '@registry/core';

// ---------------------------------------------------------------------------
// Pipeline hooks
// ---------------------------------------------------------------------------

/**
 * Fetches the active pipeline list.
 * Query key: ['pipelines']
 */
export function usePipelines(api: Api) {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: () => api.listPipelines(),
  });
}

/**
 * Fetches a single pipeline config by ID.
 * Query key: ['pipelines', id]
 */
export function usePipeline(api: Api, id: string) {
  return useQuery({
    queryKey: ['pipelines', id],
    queryFn: () => api.getPipeline(id),
    enabled: Boolean(id),
  });
}

/**
 * Mutation: create a new pipeline.
 * On success, invalidates the pipeline list cache.
 */
export function useCreatePipeline(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Parameters<Api['createPipeline']>[0]
    ) => api.createPipeline(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

/**
 * Mutation: update an existing pipeline.
 * On success, invalidates both the list and the specific pipeline entry.
 */
export function useUpdatePipeline(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<PipelineConfig>;
    }) => api.updatePipeline(id, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines', variables.id] });
    },
  });
}

/**
 * Mutation: soft-delete a pipeline.
 * On success, invalidates the pipeline list cache.
 */
export function useDeletePipeline(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePipeline(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

/**
 * Mutation: restore (un-archive) a soft-deleted pipeline by setting active: true.
 */
export function useRestorePipeline(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.updatePipeline(id, { active: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

/**
 * Mutation: start a pipeline run (POST /generate-functional-tests with pipelineId).
 */
export function useRunPipeline(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pipelineId: string) => api.runPipeline(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-index'] });
    },
  });
}

/** Mutation: dry-run a pipeline trigger (R-81) — returns `{ selected, skipped }`. */
export function useDryRunPipeline(api: Api) {
  return useMutation({
    mutationFn: ({ pipelineId, overrides }: { pipelineId: string; overrides?: RunOverrides }) =>
      api.dryRunPipeline(pipelineId, overrides),
  });
}

/** Mutation: trigger a pipeline experiment with optional overrides (R-80, R-88). */
export function useTriggerExperiment(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, overrides }: { pipelineId: string; overrides?: RunOverrides }) =>
      api.runPipeline(pipelineId, overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-index'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Unified experiment hooks (v0.6.0 — R-82, R-83, R-88)
// ---------------------------------------------------------------------------

const ACTIVE_EXPERIMENT_STATUSES = new Set(['pending', 'running']);

/**
 * Fetches the unified experiment index; polls every 5 s while any entry is
 * pending/running. Query key: ['experiment-index']
 */
export function useExperimentIndex(api: Api) {
  return useQuery({
    queryKey: ['experiment-index'],
    queryFn: () => api.listExperimentIndex(),
    refetchInterval: (query) => {
      const items = query.state.data as ExperimentIndexEntry[] | undefined;
      return items?.some((e) => ACTIVE_EXPERIMENT_STATUSES.has(e.status)) ? 5000 : false;
    },
  });
}

/**
 * Fetches one experiment's normalised results; polls every 5 s while the
 * experiment is pending/running. Query key: ['experiment-results', kind, id]
 */
export function useExperimentResults(api: Api, kind: ExperimentKind | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['experiment-results', kind, id],
    queryFn: () => api.getExperimentResults(kind!, id!),
    enabled: Boolean(kind && id),
    refetchInterval: (query) => {
      const status = (query.state.data as Awaited<ReturnType<Api['getExperimentResults']>> | undefined)
        ?.experiment?.status;
      return status && ACTIVE_EXPERIMENT_STATUSES.has(status) ? 5000 : false;
    },
  });
}

// ---------------------------------------------------------------------------
// Prompt hooks
// ---------------------------------------------------------------------------

/**
 * Fetches the active prompts list (soft-deleted excluded by the server).
 * Query key: ['prompts']
 */
export function usePrompts(api: Api) {
  return useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.listPrompts(),
  });
}

/**
 * Fetches a single prompt header record.
 * Query key: ['prompts', key]
 */
export function usePrompt(api: Api, key: string) {
  return useQuery({
    queryKey: ['prompts', key],
    queryFn: () => api.getPrompt(key),
    enabled: Boolean(key),
  });
}

/**
 * Mutation: create a new prompt.
 * On success, invalidates the prompt list cache.
 */
export function useCreatePrompt(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { promptKey: string; body: string }) =>
      api.createPrompt(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}

/**
 * Mutation: update a prompt body (creates a new immutable version record).
 * On success, invalidates the list, the specific prompt, and its version history.
 */
export function useUpdatePrompt(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: { body: string } }) =>
      api.updatePrompt(key, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      queryClient.invalidateQueries({ queryKey: ['prompts', variables.key] });
      queryClient.invalidateQueries({
        queryKey: ['prompts', variables.key, 'versions'],
      });
    },
  });
}

/**
 * Mutation: soft-delete a prompt.
 * On success, invalidates the prompt list cache.
 */
export function useDeletePrompt(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => api.deletePrompt(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}

/**
 * Mutation: import legacy prompt versions as `legacy-<promptVersion>` prompts (R-72).
 * On success, invalidates the prompt list cache.
 */
export function useImportLegacyPrompts(api: Api) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.importLegacyPrompts(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
    },
  });
}

/**
 * Fetches the legacy prompt versions (`GET /prompt-versions`, R-89).
 * Query key: ['prompt-versions']
 */
export function useLegacyPromptVersions(api: Api, enabled = true) {
  return useQuery({
    queryKey: ['prompt-versions'],
    queryFn: () => api.listPromptVersions(),
    enabled,
  });
}

/**
 * Fetches the version history for a prompt.
 * Query key: ['prompts', key, 'versions']
 */
export function usePromptVersions(api: Api, key: string) {
  return useQuery({
    queryKey: ['prompts', key, 'versions'],
    queryFn: () => api.getPromptVersions(key),
    enabled: Boolean(key),
  });
}

// ---------------------------------------------------------------------------
// Pipeline run hook (with polling support for RunDetailPage — R-54)
// ---------------------------------------------------------------------------

/** Terminal run statuses — polling stops when one of these is reached. */
const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'timed_out',
]);

/**
 * Fetches a pipeline run and its step records.
 * Query key: ['pipelines', 'runs', runId]
 *
 * Supports polling via `options.refetchInterval`. Pass a number (milliseconds)
 * for a fixed interval. When the run reaches a terminal status the hook
 * automatically stops polling regardless of the supplied interval.
 *
 * @param options.enabled       - Set false to defer the initial fetch (default: true when runId is set).
 * @param options.refetchInterval - Polling interval in ms; 0 or undefined disables polling.
 */
export function usePipelineRun(
  api: Api,
  runId: string,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useQuery({
    queryKey: ['pipelines', 'runs', runId],
    queryFn: () => api.getPipelineRun(runId),
    enabled: options?.enabled ?? Boolean(runId),
    refetchInterval: (query) => {
      const interval = options?.refetchInterval;
      if (!interval) return false;
      // Stop polling once the run reaches a terminal state.
      const status = (query.state.data as Awaited<ReturnType<Api['getPipelineRun']>> | undefined)
        ?.run?.status;
      if (status && TERMINAL_STATUSES.has(status)) return false;
      return interval;
    },
  });
}

/**
 * Fetches all pipeline runs newest-first.
 * Query key: ['runs', nextToken]
 */
export function useRunsList(api: Api, nextToken?: string) {
  return useQuery({
    queryKey: ['runs', nextToken],
    queryFn: () => api.listRuns(nextToken),
  });
}

/**
 * Fetches a run's emitted test file (R-65, R-71). Only enable when
 * `run.artifact` is set — the endpoint 404s otherwise.
 * Query key: ['pipelines', 'runs', runId, 'artifact']
 */
export function useRunArtifact(api: Api, runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['pipelines', 'runs', runId, 'artifact'],
    queryFn: () => api.getRunArtifact(runId),
    enabled: enabled && Boolean(runId),
    staleTime: Infinity, // artifacts are immutable once written
  });
}

/**
 * Fetches one step's detail — record, input snapshot, resolved output (R-75,
 * R-77). Enable only when the step card is expanded. Only terminal steps are
 * expandable, so the result is treated as immutable.
 * Query key: ['pipelines', 'runs', runId, 'steps', stepIndex]
 */
export function useRunStep(api: Api, runId: string, stepIndex: number, enabled: boolean) {
  return useQuery({
    queryKey: ['pipelines', 'runs', runId, 'steps', stepIndex],
    queryFn: () => api.getRunStep(runId, stepIndex),
    enabled: enabled && Boolean(runId),
    staleTime: Infinity,
  });
}
