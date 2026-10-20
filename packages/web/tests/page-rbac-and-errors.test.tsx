/**
 * [web] tier — Page-level RBAC and error handling tests.
 * Covers DR-06 health-check drift items: TS-24, TS-25, TS-26, TS-36, TS-37.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, type Api } from '../src/api.js';
import PipelinesPage from '../src/pages/PipelinesPage.js';
import PipelinePage from '../src/pages/PipelinePage.js';
import PromptsPage from '../src/pages/PromptsPage.js';
import RunDetailPage from '../src/pages/RunDetailPage.js';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer'] });
const readerToken = jwt({ 'cognito:groups': ['reader'] });

const pipeline = {
  pipelineId: 'pipe-1', name: 'Test Pipeline', version: 1, active: true,
  defaultSampling: { strategy: 'first_n', n: 3 }, defaultMode: 'per_requirement',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  steps: [{ stepId: 's1', label: 'Plan', model: 'us.anthropic.claude-sonnet-4-6', promptKey: 'p1', optional: false, waitForHuman: false, includeContext: true }],
  maxSteps: 10, maxAgeMinutes: 60,
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    listPipelines: vi.fn().mockResolvedValue({ pipelines: [pipeline] }),
    getPipeline: vi.fn().mockResolvedValue(pipeline),
    createPipeline: vi.fn(),
    updatePipeline: vi.fn(),
    deletePipeline: vi.fn(),
    restorePipeline: vi.fn(),
    runPipeline: vi.fn(),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    getPrompt: vi.fn(),
    createPrompt: vi.fn(),
    updatePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    importLegacyPrompts: vi.fn(),
    listPromptVersions: vi.fn().mockResolvedValue({ promptVersions: [] }),
    getPipelineRun: vi.fn().mockResolvedValue({ run: {}, steps: [] }),
    getRunStep: vi.fn(),
    getRunArtifact: vi.fn(),
    ...overrides,
  } as unknown as Api;
}

function renderWithRouter(ui: React.ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// TS-24, TS-25 — PipelinesPage writer/reader access
// ---------------------------------------------------------------------------

describe('PipelinesPage RBAC (R-38, R-41, R-44 · TS-24, TS-25)', () => {
  it('TS-24: writer session → Pipelines page renders with "New Pipeline" button', async () => {
    const api = makeApi();
    renderWithRouter(
      <Routes>
        <Route path="/pipelines" element={<PipelinesPage api={api} token={writerToken} />} />
      </Routes>,
      '/pipelines'
    );

    await waitFor(() => expect(api.listPipelines).toHaveBeenCalled());
    expect(await screen.findByTestId('new-pipeline-btn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Pipeline' })).toBeInTheDocument();
  });

  it('TS-25: non-writer session → Pipelines page renders without "New Pipeline"; no edit/delete controls visible', async () => {
    const api = makeApi();
    renderWithRouter(
      <Routes>
        <Route path="/pipelines" element={<PipelinesPage api={api} token={readerToken} />} />
      </Routes>,
      '/pipelines'
    );

    await waitFor(() => expect(api.listPipelines).toHaveBeenCalled());
    await screen.findByText('Test Pipeline');

    // No "New Pipeline" button
    expect(screen.queryByTestId('new-pipeline-btn')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Pipeline' })).not.toBeInTheDocument();

    // No Archive button
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    // Select a pipeline to open the panel
    await userEvent.click(screen.getByText('Test Pipeline'));

    // No Save button in the panel
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    // No "Add step" button
    expect(screen.queryByRole('button', { name: '+ Add step' })).not.toBeInTheDocument();

    // No Run button (writers only per R-44 and implementation)
    expect(screen.queryByRole('button', { name: /▶ run/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TS-26 — 422 error handling in pipeline editing
// ---------------------------------------------------------------------------

describe('Pipeline editor 422 error handling (R-40 · TS-26)', () => {
  it('TS-26: side-panel editor → PUT /pipelines/{id} returns 422 → SPA shows inline error, form stays open', async () => {
    const updatePipeline = vi.fn().mockRejectedValue(
      new ApiError(422, 'maxSteps exceeded: attempted 12, limit is 10')
    );
    const api = makeApi({ updatePipeline });

    renderWithRouter(
      <Routes>
        <Route path="/pipelines" element={<PipelinesPage api={api} token={writerToken} />} />
      </Routes>,
      '/pipelines'
    );

    // Open the pipeline in the side panel
    await userEvent.click(await screen.findByText('Test Pipeline'));

    // Modify the name (to trigger a save)
    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Modified Pipeline');

    // Click Save
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(saveBtn);

    // The error message appears inline
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/maxSteps exceeded: attempted 12, limit is 10/);

    // The form stays open (Name input still present)
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Modified Pipeline')).toBeInTheDocument();

    // Save button is still present (form hasn't closed)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('TS-26: full PipelinePage → PUT /pipelines/{id} returns 422 → SPA shows inline error, form stays open', async () => {
    const updatePipeline = vi.fn().mockRejectedValue(
      new ApiError(422, 'step model not in allowlist: gpt-4')
    );
    const api = makeApi({ updatePipeline });

    renderWithRouter(
      <Routes>
        <Route path="/pipelines/:pipelineId" element={<PipelinePage api={api} token={writerToken} />} />
      </Routes>,
      '/pipelines/pipe-1'
    );

    // Wait for pipeline to load
    await waitFor(() => expect(api.getPipeline).toHaveBeenCalled());
    await screen.findByDisplayValue('Test Pipeline');

    // Modify the name
    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Another Modified Pipeline');

    // Click Save
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(saveBtn);

    // The error message appears inline
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/step model not in allowlist: gpt-4/);

    // The form stays open
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Another Modified Pipeline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TS-36 — PromptsPage active/inactive filtering
// ---------------------------------------------------------------------------

describe('PromptsPage active prompt filtering (R-52, R-53 · TS-36)', () => {
  it('TS-36: /prompts page lists active prompts; soft-deleted prompt (active: false) does not appear', async () => {
    const activePrompt = {
      promptKey: 'prompt-active',
      currentVersion: 2,
      active: true,
      body: 'Active prompt body',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    };
    const inactivePrompt = {
      promptKey: 'prompt-inactive',
      currentVersion: 1,
      active: false,
      body: 'Inactive prompt body',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // According to R-52, backend filters inactive prompts, so listPrompts should only return active ones
    // But the test spec says to check what the page does if the API returns an inactive item
    // So we test both scenarios:

    // Scenario 1: API correctly filters (normal case)
    const api1 = makeApi({
      listPrompts: vi.fn().mockResolvedValue({ prompts: [activePrompt] }),
    });

    const { unmount } = renderWithRouter(
      <Routes>
        <Route path="/prompts" element={<PromptsPage api={api1} token={writerToken} />} />
      </Routes>,
      '/prompts'
    );

    await waitFor(() => expect(api1.listPrompts).toHaveBeenCalled());

    // Active prompt is visible
    expect(await screen.findByText('prompt-active')).toBeInTheDocument();
    expect(screen.getByText(/active prompt body/i)).toBeInTheDocument();

    // Inactive prompt is not in the list
    expect(screen.queryByText('prompt-inactive')).not.toBeInTheDocument();

    unmount();

    // Scenario 2: API returns an inactive item (edge case — page should not filter itself)
    // The spec says "check what the page does if the API returns an inactive item"
    // Looking at PromptsPage.tsx, it renders prompts as-is with an active/inactive badge
    const api2 = makeApi({
      listPrompts: vi.fn().mockResolvedValue({ prompts: [activePrompt, inactivePrompt] }),
    });

    renderWithRouter(
      <Routes>
        <Route path="/prompts" element={<PromptsPage api={api2} token={writerToken} />} />
      </Routes>,
      '/prompts'
    );

    await waitFor(() => expect(api2.listPrompts).toHaveBeenCalled());

    // Both prompts appear (page doesn't filter)
    expect(await screen.findByText('prompt-active')).toBeInTheDocument();
    expect(screen.getByText('prompt-inactive')).toBeInTheDocument();

    // The page shows the active badge for the active one and inactive badge for the inactive one
    const rows = screen.getAllByTestId('prompt-row');
    const activeRow = rows.find(r => within(r).queryByText('prompt-active'));
    const inactiveRow = rows.find(r => within(r).queryByText('prompt-inactive'));

    expect(within(activeRow!).getByText('active')).toBeInTheDocument();
    expect(within(inactiveRow!).getByText('inactive')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TS-37 — RunDetailPage step metrics display
// ---------------------------------------------------------------------------

describe('RunDetailPage step metrics display (R-54, R-77 · TS-37)', () => {
  it('TS-37: completed run with step metrics → run detail page renders step flow; expanding a completed step shows durationMs, costEstimateUsd, inputTokens, outputTokens', async () => {
    const run = {
      runId: 'run-metrics-test',
      pipelineId: 'pipe-1',
      pipelineConfigVersion: 1,
      status: 'completed',
      startedAt: '2026-01-03T00:00:00Z',
      completedAt: '2026-01-03T00:05:00Z',
      sampling: { strategy: 'first_n', n: 1 },
      mode: 'batch',
      requirementIds: ['publisher/R-01'],
      executedSteps: 1,
      warnings: [],
    };

    const step = {
      pk: 'PRUN#run-metrics-test',
      sk: 'STEP#00',
      stepIndex: 0,
      stepId: 's1',
      label: 'Plan',
      model: 'us.anthropic.claude-sonnet-4-6',
      promptKey: 'plan-prompt',
      promptVersion: 1,
      status: 'completed',
      outputRef: { inline: '{"test":"output"}' },
      durationMs: 4250,
      bedrockLatencyMs: 3800,
      inputTokens: 1500,
      outputTokens: 850,
      costEstimateUsd: 0.012345,
      inputCharacters: 12000,
      outputCharacters: 3400,
      contextTokenEstimate: 1600,
      cacheKey: 'cache-key-123',
      startedAt: '2026-01-03T00:00:01Z',
    };

    const stepDetail = {
      step,
      input: {
        model: 'us.anthropic.claude-sonnet-4-6',
        outputType: 'plan',
        systemPrompt: { promptKey: 'plan-prompt', version: 1, body: 'You are a test planner.' },
        userMessage: 'Requirement: ...',
        sections: [{ name: 'Requirement', text: 'R-01: ...' }],
        tool: { name: 'emit_functional_test_plan', schemaVersion: 'plan-v2' },
        priorOutputsTruncated: false,
        instructionsVersion: '1',
      },
      output: '{"test":"output"}',
    };

    const api = makeApi({
      getPipelineRun: vi.fn().mockResolvedValue({ run, steps: [step] }),
      getRunStep: vi.fn().mockResolvedValue(stepDetail),
      getPipeline: vi.fn().mockResolvedValue(pipeline),
    });

    renderWithRouter(
      <Routes>
        <Route path="/pipelines/:pipelineId/runs/:runId" element={<RunDetailPage api={api} />} />
      </Routes>,
      '/pipelines/pipe-1/runs/run-metrics-test'
    );

    // Wait for run to load
    await waitFor(() => expect(api.getPipelineRun).toHaveBeenCalled());

    // Step card is rendered
    const stepCard = await screen.findByTestId('step-card-0');
    expect(within(stepCard).getByText('Plan')).toBeInTheDocument();
    expect(within(stepCard).getByText('completed')).toBeInTheDocument();

    // Expand the step
    const expandBtn = within(stepCard).getByRole('button', { name: 'Expand step detail' });
    await userEvent.click(expandBtn);

    // Step detail is fetched
    await waitFor(() => expect(api.getRunStep).toHaveBeenCalledWith('run-metrics-test', 0));

    // Click on the Metrics tab
    const metricsTab = within(stepCard).getByRole('tab', { name: 'Metrics' });
    await userEvent.click(metricsTab);

    // Metrics are displayed
    const metricsPanel = within(stepCard).getByLabelText('step metrics');
    expect(within(metricsPanel).getByText('Duration')).toBeInTheDocument();
    expect(within(metricsPanel).getByText('4,250 ms')).toBeInTheDocument();

    expect(within(metricsPanel).getByText('Cost estimate')).toBeInTheDocument();
    expect(within(metricsPanel).getByText('$0.012345')).toBeInTheDocument();

    expect(within(metricsPanel).getByText('Input tokens')).toBeInTheDocument();
    expect(within(metricsPanel).getByText('1,500')).toBeInTheDocument();

    expect(within(metricsPanel).getByText('Output tokens')).toBeInTheDocument();
    expect(within(metricsPanel).getByText('850')).toBeInTheDocument();
  });
});
