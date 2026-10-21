/**
 * API client (T-14/T-15). Attaches the Cognito access token as a Bearer header
 * on every call, matching the HTTP API's Lambda authorizer.
 */
import { config } from './config.js';
import type { Entry, RequirementEntry, AdversarialRunSummary, AdversarialFindingsResponse } from './lib.js';

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
    listAdversarialRuns: async (kind: 'test' | 'code'): Promise<AdversarialRunSummary[]> =>
      (await req(`/adversarial-runs?kind=${kind}`)).json(),
    getAdversarialFindings: async (kind: 'test' | 'code', runDir: string): Promise<AdversarialFindingsResponse> =>
      (await req(`/adversarial-runs/${kind}/${runDir}/findings`)).json(),
  };
}

export type Api = ReturnType<typeof createApi>;
