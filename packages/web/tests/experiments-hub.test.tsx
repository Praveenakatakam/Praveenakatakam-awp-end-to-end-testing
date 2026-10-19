/**
 * [web] tier — v0.6.0 unified Experiments hub (T-32 · R-87, R-88, R-91 · TS-77).
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApi, type Api } from '../src/api.js';
import ExperimentsHubPage from '../src/pages/ExperimentsHubPage.js';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer'] });
const readerToken = jwt({ 'cognito:groups': ['reader'] });

const pipeline = {
  pipelineId: 'pipe-1', name: 'Baseline (legacy v1)', version: 2, active: true,
  defaultSampling: { strategy: 'all' }, defaultMode: 'per_requirement',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', steps: [],
};

const pipelineEntry = {
  id: 'pexp-1', kind: 'pipeline', label: 'Baseline (legacy v1) v2', createdAt: '2026-02-02T00:00:00Z',
  status: 'completed_with_warnings', requirementCount: 2, resultCount: 2, skipCount: 1,
};
const legacyEntry = {
  id: 'exp-1', kind: 'legacy', label: 'v1', createdAt: '2026-02-01T00:00:00Z',
  status: 'succeeded', requirementCount: 1, resultCount: 1, skipCount: 0,
};

const plan = {
  requirementIds: ['publisher/R-1'], title: 'Org created propagates',
  trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs' },
  assertions: [{ service: 'consumer', assertion: 'org exists' }],
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    listExperimentIndex: vi.fn().mockResolvedValue([pipelineEntry, legacyEntry]),
    getExperimentResults: vi.fn().mockImplementation(async (kind: string) =>
      kind === 'pipeline'
        ? {
            experiment: pipelineEntry,
            results: [
              { requirementId: 'publisher/R-1', runId: 'run-aaaaaaaa1', status: 'completed', plan, testFile: null },
              { requirementId: 'publisher/R-2', runId: 'run-bbbbbbbb2', status: 'failed', plan: null, testFile: null },
            ],
            skipped: [{ requirement: 'consumer/R-9', reason: 'no API target for source' }],
          }
        : {
            experiment: legacyEntry,
            results: [{ requirementId: 'publisher/R-1', status: 'valid', plan, testFile: { path: 'f.ts', content: 'code' } }],
            skipped: [],
          }),
    listPipelines: vi.fn().mockResolvedValue({ pipelines: [pipeline] }),
    dryRunPipeline: vi.fn().mockResolvedValue({ selected: ['publisher/R-1'], skipped: [] }),
    runPipeline: vi.fn().mockResolvedValue({ runIds: ['run-new'], skipped: [], experimentId: 'pexp-new' }),
    listPromptVersions: vi.fn().mockResolvedValue({ promptVersions: [{ promptVersion: 'v1', modelId: 'm1', createdAt: '2026-01-01T00:00:00Z' }] }),
    createExperiment: vi.fn().mockResolvedValue({ experimentId: 'exp-new', statusUrl: '/experiments/exp-new' }),
    ...overrides,
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname}{loc.search}</p>;
}

function renderHub(api: Api, path = '/experiments', token = writerToken) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/experiments" element={<><ExperimentsHubPage api={api} token={token} /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('API client — v0.6.0 experiment endpoints', () => {
  const api = createApi(async () => 't');

  it('listExperimentIndex accepts { experiments }, { items } or a bare array', async () => {
    stubFetch({ experiments: [pipelineEntry] });
    expect(await api.listExperimentIndex()).toEqual([pipelineEntry]);
    stubFetch({ items: [legacyEntry] });
    expect(await api.listExperimentIndex()).toEqual([legacyEntry]);
    const fetchMock = stubFetch([pipelineEntry, legacyEntry]);
    expect(await api.listExperimentIndex()).toHaveLength(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/experiment-index$/);
  });

  it('getExperimentResults GETs /experiment-results/{kind}/{id}', async () => {
    const fetchMock = stubFetch({ experiment: legacyEntry, results: [], skipped: [] });
    expect((await api.getExperimentResults('legacy', 'exp-1')).experiment).toEqual(legacyEntry);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/experiment-results\/legacy\/exp-1$/);
  });

  it('dryRunPipeline POSTs dryRun: true with overrides', async () => {
    const fetchMock = stubFetch({ selected: ['a/R-1'], skipped: [] });
    expect(await api.dryRunPipeline('pipe-1', { sampling: { strategy: 'all' }, mode: 'batch' }))
      .toEqual({ selected: ['a/R-1'], skipped: [] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ pipelineId: 'pipe-1', sampling: { strategy: 'all' }, mode: 'batch', dryRun: true });
  });

  it('runPipeline surfaces experimentId from the 202', async () => {
    stubFetch({ runIds: ['r1', 'r2'], skipped: [], experimentId: 'pexp-9' }, 202);
    expect(await api.runPipeline('pipe-1')).toEqual({ runIds: ['r1', 'r2'], skipped: [], experimentId: 'pexp-9' });
  });
});

// ---------------------------------------------------------------------------
// List + detail
// ---------------------------------------------------------------------------

describe('Experiments hub list + detail (T-32 · R-88)', () => {
  it('lists both kinds with kind badge, label, status and counts', async () => {
    renderHub(makeApi());
    const rows = await screen.findAllByTestId('experiment-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId('kind-badge')).toHaveTextContent('pipeline');
    expect(rows[0]).toHaveTextContent('Baseline (legacy v1) v2');
    expect(rows[0]).toHaveTextContent('completed with warnings');
    expect(rows[0]).toHaveTextContent('2 req · 2 results · 1 skipped');
    expect(within(rows[1]).getByTestId('kind-badge')).toHaveTextContent('legacy');
    expect(rows[1]).toHaveTextContent('v1');
  });

  it('selecting a pipeline experiment shows its runs with run-detail links and the skipped list', async () => {
    const api = makeApi();
    renderHub(api);
    const rows = await screen.findAllByTestId('experiment-row');
    await userEvent.click(rows[0]);
    const detail = await screen.findByLabelText('experiment detail');
    const table = await within(detail).findByRole('table', { name: 'experiment runs' });
    expect(api.getExperimentResults).toHaveBeenCalledWith('pipeline', 'pexp-1');
    expect(within(table).getByText('publisher/R-1')).toBeInTheDocument();
    expect(within(table).getByText('failed')).toBeInTheDocument();
    expect(within(table).getAllByRole('link')[0]).toHaveAttribute('href', '/runs/run-aaaaaaaa1');
    expect(within(detail).getByText(/1 requirement skipped/)).toBeInTheDocument();
    expect(within(detail).getByText('consumer/R-9')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('selected=pipeline%3Apexp-1');
  });

  it('selecting a legacy experiment (from the URL) shows its plans read-only', async () => {
    renderHub(makeApi(), '/experiments?selected=legacy:exp-1');
    const detail = await screen.findByLabelText('experiment detail');
    const plans = await within(detail).findByLabelText('experiment plans');
    expect(within(plans).getAllByText('publisher/R-1').length).toBeGreaterThan(0);
    expect(within(plans).getAllByText('Org created propagates').length).toBeGreaterThan(0);
    expect(within(detail).queryByRole('table', { name: 'experiment runs' })).not.toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: /compare with/i })).toHaveAttribute('href', '/compare?a=legacy%3Aexp-1');
  });

  it('hides New experiment and the legacy run action from readers', async () => {
    renderHub(makeApi(), '/experiments', readerToken);
    await screen.findAllByTestId('experiment-row');
    expect(screen.queryByRole('button', { name: /new experiment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run legacy experiment/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New experiment flow — TS-77
// ---------------------------------------------------------------------------

async function openNewExperiment(api: Api) {
  renderHub(api);
  await userEvent.click(await screen.findByRole('button', { name: /new experiment/i }));
  const form = screen.getByLabelText('new experiment');
  const picker = within(form).getByLabelText('Pipeline');
  await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
  await userEvent.selectOptions(picker, 'pipe-1');
  return form;
}

describe('New experiment dry-run flow (T-32 · R-81, R-88 · TS-77)', () => {
  it('TS-77: a dry run selecting 45 requirements shows 45 and requires a confirmation step', async () => {
    const selected = Array.from({ length: 45 }, (_, i) => `publisher/R-${i + 1}`);
    const api = makeApi({
      dryRunPipeline: vi.fn().mockResolvedValue({ selected, skipped: [{ requirement: 'consumer/R-9', reason: 'x' }] }),
      runPipeline: vi.fn().mockResolvedValue({ runIds: selected, skipped: [], experimentId: 'pexp-new' }),
    });
    const form = await openNewExperiment(api);

    await userEvent.click(within(form).getByRole('button', { name: /dry run/i }));
    expect(await within(form).findByTestId('selected-count')).toHaveTextContent('45');
    expect(within(form).getByText(/1 requirement skipped/)).toBeInTheDocument();

    // First click only asks for confirmation — nothing is triggered yet.
    await userEvent.click(within(form).getByRole('button', { name: /^run experiment$/i }));
    expect(api.runPipeline).not.toHaveBeenCalled();
    expect(within(form).getByRole('alert')).toHaveTextContent(/more than 20/);

    await userEvent.click(within(form).getByRole('button', { name: /confirm: run 45 requirements/i }));
    await waitFor(() => expect(api.runPipeline).toHaveBeenCalledWith('pipe-1', {}));
    // The new experiment is selected.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('selected=pipeline%3Apexp-new'));
    expect(screen.queryByLabelText('new experiment')).not.toBeInTheDocument();
  });

  it('triggers immediately (no confirmation) at or below 20 and passes overrides', async () => {
    const api = makeApi();
    const form = await openNewExperiment(api);
    await userEvent.click(within(form).getByLabelText('Override sampling'));
    await userEvent.selectOptions(within(form).getByLabelText('Sampling strategy'), 'first_n');
    await userEvent.click(within(form).getByLabelText('Override mode'));
    await userEvent.selectOptions(within(form).getByLabelText('Mode'), 'batch');
    await userEvent.click(within(form).getByRole('button', { name: /dry run/i }));
    expect(api.dryRunPipeline).toHaveBeenCalledWith('pipe-1', { sampling: { strategy: 'first_n', n: 3 }, mode: 'batch' });
    expect(await within(form).findByTestId('selected-count')).toHaveTextContent('1');

    await userEvent.click(within(form).getByRole('button', { name: /^run experiment$/i }));
    await waitFor(() =>
      expect(api.runPipeline).toHaveBeenCalledWith('pipe-1', { sampling: { strategy: 'first_n', n: 3 }, mode: 'batch' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('selected=pipeline%3Apexp-new'));
  });

  it('changing an input after a dry run hides the trigger until re-run', async () => {
    const api = makeApi();
    const form = await openNewExperiment(api);
    await userEvent.click(within(form).getByRole('button', { name: /dry run/i }));
    await within(form).findByTestId('selected-count');
    await userEvent.click(within(form).getByLabelText('Override mode'));
    expect(within(form).queryByRole('button', { name: /^run experiment$/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Deprecated legacy run action — R-91
// ---------------------------------------------------------------------------

describe('Run legacy experiment (deprecated) action (T-32 · R-91)', () => {
  it('starts a legacy experiment and selects it', async () => {
    const api = makeApi();
    renderHub(api);
    await userEvent.click(await screen.findByRole('button', { name: /run legacy experiment \(deprecated\)/i }));
    const form = screen.getByLabelText('legacy experiment form');
    const picker = within(form).getByLabelText('Prompt version');
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
    await userEvent.selectOptions(picker, 'v1');
    await userEvent.click(within(form).getByRole('button', { name: /^run legacy experiment$/i }));
    expect(api.createExperiment).toHaveBeenCalledWith({ promptVersion: 'v1' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('selected=legacy%3Aexp-new'));
  });
});
