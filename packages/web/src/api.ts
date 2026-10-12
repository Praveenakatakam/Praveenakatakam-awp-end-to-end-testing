/**
 * API client (T-14/T-15). Attaches the Cognito access token as a Bearer header
 * on every call, matching the HTTP API's Lambda authorizer.
 */
import { config } from './config.js';
import type { Entry, RequirementEntry } from './lib.js';
import type { PromptVersionRecord, ExperimentRecord } from '@registry/core';

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API ${status}`);
  }
}

export function createApi(token: string) {
  const req = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(res.status);
    return res;
  };
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
      (await req('/prompt-versions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json(),
    listPromptVersions: async (): Promise<{ promptVersions: Omit<PromptVersionRecord, 'text'>[] }> =>
      (await req('/prompt-versions')).json(),
    getPromptVersion: async (promptVersion: string): Promise<PromptVersionRecord> =>
      (await req(`/prompt-versions/${encodeURIComponent(promptVersion)}`)).json(),
    createExperiment: async (payload: { promptVersion: string }): Promise<{ experimentId: string; statusUrl: string }> =>
      (await req('/experiments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).json(),
    listExperiments: async (): Promise<{ experiments: ExperimentRecord[] }> =>
      (await req('/experiments')).json(),
    getExperiment: async (experimentId: string): Promise<ExperimentRecord> =>
      (await req(`/experiments/${experimentId}`)).json(),
    getExperimentArtifact: async (experimentId: string): Promise<{ experimentId: string; promptVersion: string; status: string; planCount?: number; skipCount?: number; artifact: unknown }> =>
      (await req(`/experiments/${experimentId}/artifact`)).json(),
  };
}

export type Api = ReturnType<typeof createApi>;
