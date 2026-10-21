/**
 * T-AR-05a — adversarial API client methods (listAdversarialRuns, getAdversarialFindings).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApi, ApiError } from '../src/api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

const api = createApi('test-token');

describe('api.listAdversarialRuns (T-AR-05a)', () => {
  it('(a) fetches /adversarial-runs?kind=test with Bearer header', async () => {
    const spy = mockFetch(200, [{ reviewKind: 'test', run_dir: 'r1' }]);
    const runs = await api.listAdversarialRuns('test');
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/adversarial-runs?kind=test');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-token');
    expect(runs).toHaveLength(1);
    expect(runs[0].reviewKind).toBe('test');
  });

  it('(b) fetches /adversarial-runs?kind=code', async () => {
    const spy = mockFetch(200, []);
    await api.listAdversarialRuns('code');
    expect((spy.mock.calls[0] as [string])[0]).toContain('kind=code');
  });

  it('(c) throws ApiError on non-2xx', async () => {
    mockFetch(401, { error: 'unauthorized' });
    await expect(api.listAdversarialRuns('test')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('api.getAdversarialFindings (T-AR-05a)', () => {
  it('(d) fetches /adversarial-runs/{kind}/{run_dir}/findings', async () => {
    const spy = mockFetch(200, { findings: [], verificationStatus: 'not_run' });
    const result = await api.getAdversarialFindings('test', '20261021-1430_test_main');
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain('/adversarial-runs/test/20261021-1430_test_main/findings');
    expect(result.verificationStatus).toBe('not_run');
  });
});
