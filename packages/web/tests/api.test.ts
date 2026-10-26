// @vitest-environment node
/**
 * Web-tier unit tests for the T-11 api.ts additions (T-11a).
 * Uses stub fetch — no real network or AWS calls.
 * Uses the node environment because this module has no DOM dependencies;
 * jsdom is broken in CI due to an undici version mismatch (pre-existing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub config before importing api so the base URL is predictable regardless
// of any VITE_* env vars that may be set in local .env files.
// NOTE: vi.mock is hoisted — the literal must be inlined, not a variable reference.
vi.mock('../src/config.js', () => ({ config: { apiUrl: 'http://test-api.local' } }));

import { createApi, ApiError } from '../src/api.js';

const BASE_URL = 'http://test-api.local';
const TEST_TOKEN = 'test-bearer-token';

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(String(body)),
  } as unknown as Response;
}

describe('createApi — T-11 additions (T-11a · R-50–R-54)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    api = createApi(() => Promise.resolve(TEST_TOKEN));
  });

  // createPromptVersion and createExperiment were legacy methods removed in PR #21

  // ------------------------------------------------------------------ //
  // listPromptVersions — GET /prompt-versions
  // ------------------------------------------------------------------ //
  describe('listPromptVersions', () => {
    it('GETs /prompt-versions with auth header; returns { promptVersions } shape', async () => {
      // GIVEN
      const body = { promptVersions: [{ promptVersion: 'v1', modelId: 'm', createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' }] };
      fetchMock.mockResolvedValueOnce(makeResponse(body));

      // WHEN
      const result = await api.listPromptVersions();

      // THEN
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/prompt-versions`);
      expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
      const headers = init.headers as Record<string, string>;
      expect(headers['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
      expect(result).toEqual(body);
    });
  });


  // ------------------------------------------------------------------ //
  // listExperiments — GET /experiments
  // ------------------------------------------------------------------ //
  describe('listExperiments', () => {
    it('GETs /experiments with auth header; returns { experiments } array', async () => {
      // GIVEN
      const body = { experiments: [{ PK: 'EXP#exp-1', SK: 'METADATA', experimentId: 'exp-1', promptVersion: 'v1', status: 'succeeded', createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' }] };
      fetchMock.mockResolvedValueOnce(makeResponse(body));

      // WHEN
      const result = await api.listExperiments();

      // THEN
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/experiments`);
      expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
      expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
      expect(result).toEqual(body);
    });
  });

  // ------------------------------------------------------------------ //
  // getExperiment — GET /experiments/{experimentId}
  // ------------------------------------------------------------------ //
  describe('getExperiment', () => {
    it('GETs /experiments/{id} with auth header; returns ExperimentRecord', async () => {
      // GIVEN
      const experimentId = 'exp-abc';
      const record = { PK: `EXP#${experimentId}`, SK: 'METADATA', experimentId, promptVersion: 'v1', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' };
      fetchMock.mockResolvedValueOnce(makeResponse(record));

      // WHEN
      const result = await api.getExperiment(experimentId);

      // THEN
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/experiments/${experimentId}`);
      expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
      expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
      expect(result).toEqual(record);
    });

    it('throws ApiError for a non-existent experiment (404)', async () => {
      // GIVEN
      fetchMock.mockResolvedValueOnce(makeResponse({}, false, 404));

      // WHEN / THEN
      await expect(api.getExperiment('missing')).rejects.toBeInstanceOf(ApiError);
    });
  });

  // ------------------------------------------------------------------ //
  // getExperimentArtifact — GET /experiments/{experimentId}/artifact
  // ------------------------------------------------------------------ //
  describe('getExperimentArtifact', () => {
    it('GETs /experiments/{id}/artifact with auth header; returns full artifact shape', async () => {
      // GIVEN
      const experimentId = 'exp-xyz';
      const body = {
        experimentId,
        promptVersion: 'v1',
        status: 'succeeded',
        planCount: 3,
        skipCount: 0,
        artifact: { plans: [] },
      };
      fetchMock.mockResolvedValueOnce(makeResponse(body));

      // WHEN
      const result = await api.getExperimentArtifact(experimentId);

      // THEN
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/experiments/${experimentId}/artifact`);
      expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
      expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${TEST_TOKEN}`);
      expect(result).toEqual(body);
    });

    it('throws ApiError for a non-succeeded experiment (404)', async () => {
      // GIVEN
      fetchMock.mockResolvedValueOnce(makeResponse({}, false, 404));

      // WHEN / THEN
      await expect(api.getExperimentArtifact('pending-exp')).rejects.toBeInstanceOf(ApiError);
    });
  });
});
