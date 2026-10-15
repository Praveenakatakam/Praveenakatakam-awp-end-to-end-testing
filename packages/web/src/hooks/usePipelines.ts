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
 *
 * Requirements: R-35, R-37, R-38, R-39, R-41, R-54
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { Api } from '../api.js';
import type { PipelineConfig, PromptItem } from '@registry/core';

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
  return useMutation({
    mutationFn: (pipelineId: string) => api.runPipeline(pipelineId),
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
  } satisfies UseQueryOptions);
}
