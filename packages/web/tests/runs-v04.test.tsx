/**
 * [web] tier — v0.4.0 run UI (T-23 · R-70, R-71, R-72 · TS-55, TS-56, TS-57 UI half).
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, createApi, type Api } from '../src/api.js';
import PipelinePage from '../src/pages/PipelinePage.js';
import PipelinesPage from '../src/pages/PipelinesPage.js';
import RunDetailPage from '../src/pages/RunDetailPage.js';
import RunsComparePage from '../src/pages/RunsComparePage.js';
import PromptsPage from '../src/pages/PromptsPage.js';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer'] });
const readerToken = jwt({ 'cognito:groups': ['reader'] });

const pipeline = {
  pipelineId: 'pipe-1', name: 'My Pipeline', version: 1, active: true,
  defaultSampling: { strategy: 'first_n', n: 3 }, defaultMode: 'per_requirement',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  steps: [{ stepId: 's1', label: 'Plan', model: 'm', promptKey: 'p', optional: false, waitForHuman: false, includeContext: true }],
};

function makeRun(runId: string, extra: object = {}) {
  return {
    runId, pipelineId: 'pipe-1', pipelineConfigVersion: 1, status: 'completed',
    startedAt: '2026-01-03T00:00:00Z', sampling: { strategy: 'first_n', n: 1 }, mode: 'batch',
    requirementIds: ['publisher/R-01'], executedSteps: 2, warnings: [], ...extra,
  };
}
function makeStep(stepIndex: number, label: string, output: string, promptVersion = 1) {
  return {
    sk: `STEP#${stepIndex}`, stepIndex, stepId: `s${stepIndex + 1}`, label, model: 'us.anthropic.claude-sonnet-4-6',
    promptKey: 'plan-prompt', promptVersion, status: 'completed', outputRef: { inline: output },
    durationMs: 1200 + stepIndex, inputTokens: 100, outputTokens: 50, costEstimateUsd: 0.001,
  };
}

const skipped = [
  { requirement: 'publisher/R-07', reason: 'references no cataloged entity' },
  { requirement: 'consumer/R-11', reason: 'no API target for source' },
];

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getPipeline: vi.fn().mockResolvedValue(pipeline),
    listPipelines: vi.fn().mockResolvedValue({ pipelines: [pipeline] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    getPrompt: vi.fn().mockResolvedValue({ promptKey: 'p', body: 'b' }),
    runPipeline: vi.fn().mockResolvedValue({ runIds: ['run-1'], skipped }),
    getPipelineRun: vi.fn().mockImplementation(async (id: string) => ({ run: makeRun(id), steps: [] })),
    getRunArtifact: vi.fn(),
    listRuns: vi.fn().mockResolvedValue({ items: [] }),
    importLegacyPrompts: vi.fn(),
    ...overrides,
  } as unknown as Api;
}

function renderRoutes(api: Api, path: string, token = writerToken) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pipelines" element={<PipelinesPage api={api} token={token} />} />
          <Route path="/pipelines/:pipelineId" element={<PipelinePage api={api} token={token} />} />
          <Route path="/pipelines/:pipelineId/runs/:runId" element={<RunDetailPage api={api} />} />
          <Route path="/runs/compare" element={<RunsComparePage api={api} />} />
          <Route path="/prompts" element={<PromptsPage api={api} token={token} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// API client shapes
// ---------------------------------------------------------------------------

function stubFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('API client — v0.4.0 run endpoints', () => {
  const api = createApi(async () => 't');

  it('normalises a batch trigger { runId, skipped } to { runIds, skipped }', async () => {
    stubFetchOnce(202, { runId: 'r-1', skipped });
    expect(await api.runPipeline('pipe-1')).toEqual({ runIds: ['r-1'], skipped });
  });

  it('passes through a per_requirement trigger and defaults skipped to []', async () => {
    stubFetchOnce(202, { runIds: ['a', 'b'] });
    expect(await api.runPipeline('pipe-1')).toEqual({ runIds: ['a', 'b'], skipped: [] });
  });

  it('surfaces skipped on a 422 trigger rejection (R-56)', async () => {
    stubFetchOnce(422, { error: 'no groundable requirements', skipped });
    const err = (await api.runPipeline('pipe-1').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.serverMessage).toBe('no groundable requirements');
    expect(err.skipped).toEqual(skipped);
  });

  it('GETs /runs/{runId}/artifact', async () => {
    const fetchMock = stubFetchOnce(200, { path: 'functional/x.generated.test.ts', content: 'code' });
    expect(await api.getRunArtifact('r-1')).toEqual({ path: 'functional/x.generated.test.ts', content: 'code' });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/runs\/r-1\/artifact$/);
  });

  it('POSTs /prompts/import-legacy', async () => {
    const fetchMock = stubFetchOnce(200, { imported: ['legacy-v2'], skipped: ['legacy-v1'] });
    expect(await api.importLegacyPrompts()).toEqual({ imported: ['legacy-v2'], skipped: ['legacy-v1'] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/prompts\/import-legacy$/);
    expect(init.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// TS-56 — skipped requirements after triggering a run
// ---------------------------------------------------------------------------

describe('Run trigger skipped display (T-23 · R-71 · TS-56)', () => {
  it('TS-56: full pipeline page → run → run detail lists both skipped requirements with reasons', async () => {
    const api = makeApi();
    renderRoutes(api, '/pipelines/pipe-1');
    await userEvent.click(await screen.findByRole('button', { name: /run/i }));

    const list = await screen.findByLabelText('skipped requirements');
    expect(api.getPipelineRun).toHaveBeenCalledWith('run-1');
    expect(within(list).getByText(/2 requirements skipped/i)).toBeInTheDocument();
    expect(within(list).getByText('publisher/R-07')).toBeInTheDocument();
    expect(within(list).getByText(/references no cataloged entity/)).toBeInTheDocument();
    expect(within(list).getByText('consumer/R-11')).toBeInTheDocument();
    expect(within(list).getByText(/no API target for source/)).toBeInTheDocument();
  });

  it('pipelines side panel → run rejected with 422 lists skipped in place', async () => {
    const api = makeApi({
      runPipeline: vi.fn().mockRejectedValue(new ApiError(422, 'no groundable requirements', skipped)),
    });
    renderRoutes(api, '/pipelines');
    await userEvent.click(await screen.findByText('My Pipeline'));
    await userEvent.click(await screen.findByRole('button', { name: /▶ run/i }));

    expect(await screen.findByText(/no groundable requirements/)).toBeInTheDocument();
    const list = screen.getByLabelText('skipped requirements');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows no skipped disclosure when nothing was skipped', async () => {
    const api = makeApi({ runPipeline: vi.fn().mockResolvedValue({ runIds: ['run-1'], skipped: [] }) });
    renderRoutes(api, '/pipelines/pipe-1');
    await userEvent.click(await screen.findByRole('button', { name: /run/i }));
    await screen.findByText('Pipeline Run');
    expect(screen.queryByLabelText('skipped requirements')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// R-71 — artifact view
// ---------------------------------------------------------------------------

describe('Run detail artifact view (T-23 · R-71)', () => {
  const content = "import { it } from 'vitest';\nit('works', () => {});\n";

  it('renders the emitted test with Copy and Download when run.artifact is set', async () => {
    const api = makeApi({
      getPipelineRun: vi.fn().mockResolvedValue({
        run: makeRun('run-9', { artifact: { stepId: 's1', s3Key: 'pipeline-outputs/run-9/test.generated.ts', path: 'functional/user.generated.test.ts' } }),
        steps: [],
      }),
      getRunArtifact: vi.fn().mockResolvedValue({ path: 'functional/user.generated.test.ts', content }),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderRoutes(api, '/pipelines/pipe-1/runs/run-9');
    const card = await screen.findByLabelText('emitted test');
    expect(await within(card).findByLabelText('artifact content')).toHaveTextContent("it('works'");
    expect(within(card).getByText('functional/user.generated.test.ts')).toBeInTheDocument();
    expect(api.getRunArtifact).toHaveBeenCalledWith('run-9');

    await userEvent.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(content);
    expect(await within(card).findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Download' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('user.generated.test.ts');
    clickSpy.mockRestore();
  });

  it('does not request an artifact when the run has none', async () => {
    const api = makeApi();
    renderRoutes(api, '/pipelines/pipe-1/runs/run-1');
    await screen.findByText('Pipeline Run');
    expect(screen.queryByLabelText('emitted test')).not.toBeInTheDocument();
    expect(api.getRunArtifact).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TS-55 — compare runs
// ---------------------------------------------------------------------------

describe('RunsComparePage (T-23 · R-70 · TS-55)', () => {
  const artifact = (id: string) => ({ stepId: 's1', s3Key: `pipeline-outputs/${id}/test.generated.ts`, path: 'functional/x.generated.test.ts' });
  const runs: Record<string, unknown> = {
    'run-a': { run: makeRun('run-a', { artifact: artifact('run-a') }), steps: [makeStep(0, 'Draft A', '{"a":1}'), makeStep(1, 'Critique A', 'ok')] },
    'run-b': { run: makeRun('run-b', { artifact: artifact('run-b') }), steps: [makeStep(0, 'Draft B', '{"b":2}', 2)] },
  };
  const contents: Record<string, string> = {
    'run-a': 'line 1\nold line\nline 3',
    'run-b': 'line 1\nnew line\nline 3\nline 4',
  };

  function compareApi() {
    return makeApi({
      getPipelineRun: vi.fn().mockImplementation(async (id: string) => runs[id]),
      getRunArtifact: vi.fn().mockImplementation(async (id: string) => ({ path: 'functional/x.generated.test.ts', content: contents[id] })),
      listRuns: vi.fn().mockResolvedValue({ items: [(runs['run-a'] as { run: object }).run, (runs['run-b'] as { run: object }).run] }),
    });
  }

  it('TS-55: renders both runs\' step columns aligned by index and a diff of the artifacts', async () => {
    const api = compareApi();
    renderRoutes(api, '/runs/compare?a=run-a&b=run-b');

    expect(await screen.findByLabelText('run A')).toHaveTextContent('run-a');
    expect(screen.getByLabelText('run B')).toHaveTextContent('run-b');

    const step0 = await screen.findByLabelText('step 0');
    const cells0 = within(step0).getAllByTestId('compare-step');
    expect(cells0).toHaveLength(2);
    expect(cells0[0]).toHaveTextContent('Draft A');
    expect(cells0[0]).toHaveTextContent('plan-prompt v1');
    expect(cells0[1]).toHaveTextContent('Draft B');
    expect(cells0[1]).toHaveTextContent('plan-prompt v2');
    expect(cells0[0]).toHaveTextContent('1,200 ms');

    // Step 1 exists only in run A.
    const step1 = screen.getByLabelText('step 1');
    expect(within(step1).getAllByTestId('compare-step')).toHaveLength(1);
    expect(step1).toHaveTextContent('— no step —');

    const diff = await screen.findByLabelText('artifact diff');
    const removed = diff.querySelectorAll('[data-op="remove"]');
    const added = diff.querySelectorAll('[data-op="add"]');
    expect([...removed].map((n) => n.textContent)).toEqual(['- old line']);
    expect([...added].map((n) => n.textContent)).toEqual(['+ new line', '+ line 4']);
    expect(diff).toHaveTextContent('+2');
    expect(diff).toHaveTextContent('−1');
  });

  it('explains when a run has no artifact to diff', async () => {
    const noArt = { run: makeRun('run-c'), steps: [] };
    const api = makeApi({
      getPipelineRun: vi.fn().mockImplementation(async (id: string) => (id === 'run-c' ? noArt : runs[id])),
      getRunArtifact: vi.fn().mockImplementation(async (id: string) => ({ path: 'p', content: contents[id] })),
    });
    renderRoutes(api, '/runs/compare?a=run-a&b=run-c');
    expect(await screen.findByText(/run B has no emitted test/)).toBeInTheDocument();
    expect(screen.queryByLabelText('artifact diff')).not.toBeInTheDocument();
  });

  it('updates the query string from the run pickers', async () => {
    const api = compareApi();
    renderRoutes(api, '/runs/compare');
    const pickerA = await screen.findByLabelText('Run A');
    await waitFor(() => expect(within(pickerA).getAllByRole('option')).toHaveLength(3));
    await userEvent.selectOptions(pickerA, 'run-a');
    expect(await screen.findByLabelText('run A')).toHaveTextContent('run-a');
    expect(api.getPipelineRun).toHaveBeenCalledWith('run-a');
  });
});

// ---------------------------------------------------------------------------
// TS-57 (UI half) — legacy prompt import
// ---------------------------------------------------------------------------

describe('Prompts page legacy import (T-23 · R-72 · TS-57 UI)', () => {
  it('writer clicks "Import legacy prompt versions" and sees imported/skipped counts', async () => {
    const importLegacyPrompts = vi.fn()
      .mockResolvedValueOnce({ imported: ['legacy-v2'], skipped: ['legacy-v1'] })
      .mockResolvedValueOnce({ imported: [], skipped: ['legacy-v1', 'legacy-v2'] });
    const api = makeApi({ importLegacyPrompts });
    renderRoutes(api, '/prompts');

    const btn = await screen.findByRole('button', { name: /import legacy prompt versions/i });
    await userEvent.click(btn);
    expect(await screen.findByText(/Imported 1 legacy prompt version; skipped 1 already imported/)).toBeInTheDocument();
    // The prompt list is refetched after import.
    await waitFor(() => expect(api.listPrompts).toHaveBeenCalledTimes(2));

    await userEvent.click(btn);
    expect(await screen.findByText(/Imported 0 legacy prompt versions; skipped 2 already imported/)).toBeInTheDocument();
  });

  it('hides the import action from non-writers', async () => {
    const api = makeApi();
    renderRoutes(api, '/prompts', readerToken);
    await screen.findByText(/no prompts yet/i);
    expect(screen.queryByRole('button', { name: /import legacy prompt versions/i })).not.toBeInTheDocument();
  });
});
