/**
 * [web] tier — v0.6.0 experiment-level Compare page (T-34 · R-90 · TS-79).
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Api } from '../src/api.js';
import ComparePage from '../src/pages/ComparePage.js';

const legacyEntry = {
  id: 'exp-1', kind: 'legacy', label: 'v1', createdAt: '2026-02-01T00:00:00Z',
  status: 'succeeded', requirementCount: 2, resultCount: 2, skipCount: 0,
};
const pipelineEntry = {
  id: 'pexp-1', kind: 'pipeline', label: 'Baseline (legacy v1) v1', createdAt: '2026-02-02T00:00:00Z',
  status: 'completed', requirementCount: 2, resultCount: 2, skipCount: 1,
};

const planA = {
  requirementIds: ['publisher/R-1'], title: 'Legacy plan title',
  trigger: { source: 'publisher', entity: 'org', method: 'POST', path: '/orgs' },
  assertions: [{ service: 'consumer', assertion: 'org exists' }],
};
const planB = {
  ...planA, title: 'Pipeline plan title', rationale: 'because',
  assertions: [{ service: 'consumer', assertion: 'org exists' }, { service: 'audit', assertion: 'event logged' }],
};

const legacyResults = {
  experiment: legacyEntry,
  results: [
    { requirementId: 'publisher/R-1', status: 'valid', plan: planA, testFile: { path: 'a.ts', content: 'line one\nold line\n' } },
    { requirementId: 'publisher/R-legacy-only', status: 'valid', plan: planA, testFile: null },
  ],
  skipped: [],
};
const pipelineResults = {
  experiment: pipelineEntry,
  results: [
    { requirementId: 'publisher/R-1', runId: 'run-1111aaaa', status: 'completed', plan: planB, testFile: { path: 'b.ts', content: 'line one\nnew line\n' } },
    { requirementId: 'consumer/R-pipe-only', runId: 'run-2222bbbb', status: 'failed', plan: null, testFile: null },
  ],
  skipped: [{ requirement: 'publisher/R-legacy-only', reason: 'references no cataloged entity' }],
};

function makeApi() {
  return {
    listExperimentIndex: vi.fn().mockResolvedValue([pipelineEntry, legacyEntry]),
    getExperimentResults: vi.fn().mockImplementation(async (kind: string) => (kind === 'legacy' ? legacyResults : pipelineResults)),
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

function renderAt(api: Api, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/compare" element={<ComparePage api={api} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());

describe('Experiment Compare page (T-34 · R-90 · TS-79)', () => {
  it('TS-79: legacy vs pipeline sharing publisher/R-1 → one shared row, two "only in" entries; expanding shows both plans and a test-file diff', async () => {
    const api = makeApi();
    renderAt(api, '/compare?a=legacy:exp-1&b=pipeline:pexp-1');

    const table = await screen.findByRole('table', { name: 'shared requirements' });
    expect(api.getExperimentResults).toHaveBeenCalledWith('legacy', 'exp-1');
    expect(api.getExperimentResults).toHaveBeenCalledWith('pipeline', 'pexp-1');
    const rows = within(table).getAllByTestId('shared-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('publisher/R-1');
    expect(rows[0]).toHaveTextContent('valid');
    expect(rows[0]).toHaveTextContent('completed');
    // Pipeline results link to run detail.
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/runs/run-1111aaaa');

    const onlyA = screen.getByLabelText('only in A');
    const onlyB = screen.getByLabelText('only in B');
    expect(within(onlyA).getAllByTestId('only-A')).toHaveLength(1);
    expect(within(onlyB).getAllByTestId('only-B')).toHaveLength(1);
    expect(onlyA).toHaveTextContent('publisher/R-legacy-only');
    expect(onlyA).toHaveTextContent('skipped in B: references no cataloged entity');
    expect(onlyB).toHaveTextContent('consumer/R-pipe-only');
    expect(onlyB).toHaveTextContent('not in A');

    await userEvent.click(within(rows[0]).getByRole('button', { name: /publisher\/R-1/ }));
    expect(within(screen.getByLabelText('plan A')).getAllByText('Legacy plan title').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('plan B')).getAllByText('Pipeline plan title').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('plan changes')).toBeInTheDocument();
    const diff = screen.getByLabelText('test file diff');
    expect(diff.querySelector('[data-op="remove"]')).toHaveTextContent('old line');
    expect(diff.querySelector('[data-op="add"]')).toHaveTextContent('new line');
    // Not both pipeline runs → no run-level compare link.
    expect(screen.queryByRole('link', { name: /compare these runs/i })).not.toBeInTheDocument();
  });

  it('links to the run-level compare when both sides are pipeline runs', async () => {
    const api = makeApi();
    renderAt(api, '/compare?a=pipeline:pexp-1&b=pipeline:pexp-1');
    const table = await screen.findByRole('table', { name: 'shared requirements' });
    const rows = within(table).getAllByTestId('shared-row');
    expect(rows).toHaveLength(2);
    await userEvent.click(within(rows[1]).getByRole('button', { name: /publisher\/R-1/ }));
    expect(screen.getByRole('link', { name: /compare these runs/i }))
      .toHaveAttribute('href', '/runs/compare?a=run-1111aaaa&b=run-1111aaaa');
  });

  it('populates the pickers from the experiment index and fetches on selection', async () => {
    const api = makeApi();
    renderAt(api, '/compare');
    expect(screen.getByText(/select two experiments/i)).toBeInTheDocument();
    const pickerA = screen.getByLabelText('Experiment A');
    await waitFor(() => expect(within(pickerA).getAllByRole('option')).toHaveLength(3));
    await userEvent.selectOptions(pickerA, 'legacy:exp-1');
    await userEvent.selectOptions(screen.getByLabelText('Experiment B'), 'pipeline:pexp-1');
    expect(await screen.findByRole('table', { name: 'shared requirements' })).toBeInTheDocument();
    expect(api.getExperimentResults).toHaveBeenCalledWith('legacy', 'exp-1');
  });
});
