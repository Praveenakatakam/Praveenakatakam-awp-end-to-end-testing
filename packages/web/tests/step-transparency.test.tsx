/**
 * [web] tier — v0.5.0 step transparency UI (T-27 · R-75, R-76, R-77 · TS-64 – TS-67).
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApi, type Api } from '../src/api.js';
import RunDetailPage from '../src/pages/RunDetailPage.js';

const MODEL = 'us.anthropic.claude-sonnet-4-6';

const pipeline = {
  pipelineId: 'pipe-1', name: 'P', version: 1, active: true,
  defaultSampling: { strategy: 'first_n', n: 1 }, defaultMode: 'batch',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  steps: [
    { stepId: 's1', label: 'Draft plan', model: MODEL, promptKey: 'plan-prompt', optional: false, waitForHuman: false, includeContext: true },
    { stepId: 's2', label: 'Review', model: MODEL, promptKey: 'critique-prompt', optional: false, waitForHuman: false, includeContext: true, outputType: 'critique' },
    { stepId: 's3', label: 'Revise plan', model: MODEL, promptKey: 'plan-prompt', optional: false, waitForHuman: false, includeContext: true, outputType: 'plan' },
    { stepId: 's4', label: 'Notes', model: MODEL, promptKey: 'notes', optional: true, waitForHuman: false, includeContext: true, outputType: 'freeform' },
  ],
};

const plan1 = {
  requirementIds: ['publisher/R-01'],
  title: 'Task publish propagates to consumer',
  rationale: 'R-01 says a published task must reach the consumer.',
  setup: [{ description: 'a writer access token' }],
  trigger: {
    source: 'publisher', entity: 'Task', method: 'POST', path: '/tasks/{taskId}/publish',
    payloadShape: 'Task body', examplePayload: '{"taskId":"t-1"}',
  },
  propagation: { kind: 'eventbridge', waitFor: 'TaskPublished event', channel: 'default/TaskPublished' },
  assertions: [
    { service: 'consumer', assertion: 'GET /tasks/t-1 returns status PUBLISHED' },
    { service: 'publisher', assertion: 'task row has publishedAt set' },
  ],
  negativeCases: [{ description: 'unknown taskId', expectedOutcome: '404' }],
};
const plan2 = {
  ...plan1,
  assertions: [...plan1.assertions, { service: 'consumer', assertion: 'audit log has a TaskPublished entry' }],
};
const critique = {
  verdict: 'revise',
  summary: 'Plan misses the audit trail.',
  issues: [
    { severity: 'major', target: 'assertions', problem: 'No audit log check', suggestion: 'Assert the audit entry' },
    { severity: 'minor', target: 'trigger.examplePayload', problem: 'Payload is minimal', suggestion: 'Add title' },
  ],
};

function makeStep(stepIndex: number, label: string, extra: object = {}) {
  return {
    pk: 'PRUN#run-1', sk: `STEP#0${stepIndex}`, stepIndex, stepId: `s${stepIndex + 1}`, label, model: MODEL,
    promptKey: stepIndex === 1 ? 'critique-prompt' : 'plan-prompt', promptVersion: 3, status: 'completed',
    cacheKey: `ck-${stepIndex}`, startedAt: '2026-01-03T00:00:00Z', durationMs: 1000, ...extra,
  };
}

const snapshot = {
  model: MODEL, outputType: 'plan',
  systemPrompt: { promptKey: 'plan-prompt', version: 3, body: 'You are a careful test planner.' },
  userMessage: 'Requirement: ...',
  sections: [
    { name: 'Requirement', text: 'R-01: WHEN a task is published ...' },
    { name: 'Contract schema', text: '{"Task":{"taskId":"string"}}' },
    { name: 'Output instructions', text: 'Produce one grounded plan via emit_functional_test_plan.' },
  ],
  tool: { name: 'emit_functional_test_plan', schemaVersion: 'plan-v2' },
  priorOutputsTruncated: true,
  instructionsVersion: '1',
};

const steps = [
  // Step 0 — plan output stored in S3, with an input snapshot.
  makeStep(0, 'Draft plan', { outputRef: { s3Key: 'pipeline-outputs/run-1/00.json' }, inputRef: { s3Key: 'pipeline-outputs/run-1/00.input.json' } }),
  makeStep(1, 'Review', { status: 'cached', outputRef: { inline: JSON.stringify(critique) } }),
  makeStep(2, 'Revise plan', { outputRef: { inline: JSON.stringify(plan2) }, priorOutputsTruncated: false }),
  // Step 3 — pre-v0.5.0 freeform step, no inputRef.
  makeStep(3, 'Notes', { promptKey: 'notes', status: 'warning', errorMessage: 'model refused', outputRef: { inline: 'not json at all' } }),
];

const details: Record<number, unknown> = {
  0: { step: steps[0], input: snapshot, output: JSON.stringify(plan1) },
  1: { step: steps[1], input: { ...snapshot, outputType: 'critique' }, output: JSON.stringify(critique) },
  2: { step: steps[2], input: snapshot, output: JSON.stringify(plan2) },
  3: { step: steps[3], input: null, output: 'not json at all' },
};

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getPipeline: vi.fn().mockResolvedValue(pipeline),
    getPipelineRun: vi.fn().mockResolvedValue({
      run: {
        runId: 'run-1', pipelineId: 'pipe-1', pipelineConfigVersion: 1, status: 'completed_with_warnings',
        startedAt: '2026-01-03T00:00:00Z', sampling: { strategy: 'first_n', n: 1 }, mode: 'batch',
        requirementIds: ['publisher/R-01'], executedSteps: 4, warnings: [],
      },
      steps,
    }),
    getRunArtifact: vi.fn(),
    getRunStep: vi.fn().mockImplementation(async (_runId: string, i: number) => details[i]),
    ...overrides,
  } as unknown as Api;
}

function renderPage(api: Api) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/pipelines/pipe-1/runs/run-1']}>
        <Routes>
          <Route path="/pipelines/:pipelineId/runs/:runId" element={<RunDetailPage api={api} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function expand(index: number) {
  const card = await screen.findByTestId(`step-card-${index}`);
  await userEvent.click(within(card).getByRole('button', { name: 'Expand step detail' }));
  return card;
}

const tab = (card: HTMLElement, name: string) => within(card).getByRole('tab', { name });

describe('api.getRunStep (R-75)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('GETs /runs/{runId}/steps/{stepIndex}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(details[3]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi(async () => 'tok');
    expect(await api.getRunStep('run 1', 3)).toEqual(details[3]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/runs\/run%201\/steps\/3$/);
  });
});

describe('RunDetailPage step header (R-76)', () => {
  it('shows output type, linked promptKey@version, and a cached indicator', async () => {
    renderPage(makeApi());
    const card0 = await screen.findByTestId('step-card-0');
    await waitFor(() => expect(within(card0).getByTestId('step-output-type')).toHaveTextContent('plan'));
    expect(within(card0).getByRole('link', { name: 'plan-prompt@v3' })).toHaveAttribute('href', '/prompts/plan-prompt');

    const card1 = screen.getByTestId('step-card-1');
    expect(within(card1).getByTestId('step-output-type')).toHaveTextContent('critique');
    expect(within(card1).getByText('from cache')).toBeInTheDocument();
    expect(within(card0).queryByText('from cache')).not.toBeInTheDocument();
  });

  it('does not fetch step detail until a card is expanded', async () => {
    const api = makeApi();
    renderPage(api);
    await screen.findByTestId('step-card-0');
    expect(api.getRunStep).not.toHaveBeenCalled();
    await expand(0);
    await waitFor(() => expect(api.getRunStep).toHaveBeenCalledWith('run-1', 0));
  });
});

describe('RunDetailPage step tabs (R-77)', () => {
  it('TS-64: plan Output tab renders trigger path and each assertion; Input tab renders system prompt body and Contract schema', async () => {
    renderPage(makeApi());
    const card = await expand(0);

    // Output stored in S3 — rendered from the step endpoint.
    const planOut = await within(card).findByLabelText('plan output');
    expect(within(planOut).getByText('/tasks/{taskId}/publish')).toBeInTheDocument();
    for (const a of plan1.assertions) expect(within(planOut).getByText(a.assertion)).toBeInTheDocument();
    expect(within(planOut).getByText(plan1.rationale)).toBeInTheDocument();
    expect(within(planOut).getByText('unknown taskId')).toBeInTheDocument();

    await userEvent.click(tab(card, 'Input'));
    const input = within(card).getByLabelText('step input');
    expect(within(input).getByLabelText('system prompt body')).toHaveTextContent('You are a careful test planner.');
    expect(within(input).getByRole('link', { name: 'plan-prompt@v3' })).toBeInTheDocument();
    const schema = within(input).getByLabelText('section Contract schema');
    expect(schema).toHaveTextContent('{"Task":{"taskId":"string"}}');
    expect(within(input).getByText(/Prior step outputs were truncated/)).toBeInTheDocument();
  });

  it('TS-65: critique output shows the verdict badge and a 2-row issues table', async () => {
    renderPage(makeApi());
    const card = await expand(1);
    expect(await within(card).findByTestId('critique-verdict')).toHaveTextContent('revise');
    const table = within(card).getByRole('table', { name: 'critique issues' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 issues
    expect(within(rows[1]).getByText('No audit log check')).toBeInTheDocument();
    expect(within(rows[2]).getByText('trigger.examplePayload')).toBeInTheDocument();
  });

  it('TS-66: Changes tab on the second plan step shows the one added assertion', async () => {
    const api = makeApi();
    renderPage(api);
    const card = await expand(2);
    await userEvent.click(await within(card).findByRole('tab', { name: 'Changes' }));
    const changes = await within(card).findByLabelText('plan changes');
    expect(changes).toHaveTextContent('STEP #00 · Draft plan');
    const items = changes.querySelectorAll('[data-kind]');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('data-kind', 'added');
    expect(items[0]).toHaveTextContent('assertions');
    expect(items[0]).toHaveTextContent('audit log has a TaskPublished entry');
    expect(api.getRunStep).toHaveBeenCalledWith('run-1', 0);
  });

  it('hides the Changes tab for the first plan step and for non-plan steps', async () => {
    renderPage(makeApi());
    const card0 = await expand(0);
    await within(card0).findByLabelText('plan output');
    expect(within(card0).queryByRole('tab', { name: 'Changes' })).not.toBeInTheDocument();
    const card1 = await expand(1);
    await within(card1).findByTestId('critique-verdict');
    expect(within(card1).queryByRole('tab', { name: 'Changes' })).not.toBeInTheDocument();
  });

  it('TS-67: a step without inputRef shows "Input not recorded"', async () => {
    renderPage(makeApi());
    const card = await expand(3);
    await userEvent.click(tab(card, 'Input'));
    expect(await within(card).findByText(/Input not recorded/)).toBeInTheDocument();
  });

  it('keeps errors above the tabs and shows freeform output as text', async () => {
    renderPage(makeApi());
    const card = await expand(3);
    const alert = within(card).getByRole('alert');
    const tablist = within(card).getByRole('tablist');
    expect(alert).toHaveTextContent('model refused');
    expect(alert.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(card).findByLabelText('step output')).toHaveTextContent('not json at all');
  });

  it('falls back to raw text with a notice when a plan output is unparseable', async () => {
    const api = makeApi({
      getRunStep: vi.fn().mockResolvedValue({ step: steps[0], input: snapshot, output: '{"oops":' }),
    });
    renderPage(api);
    const card = await expand(0);
    expect(await within(card).findByText(/could not be parsed as a plan/)).toBeInTheDocument();
    expect(within(card).getByLabelText('step output')).toHaveTextContent('{"oops":');
  });

  it('Raw tab shows the S3-resolved output string; Metrics tab shows priorOutputsTruncated', async () => {
    renderPage(makeApi());
    const card = await expand(0);
    await within(card).findByLabelText('plan output');
    await userEvent.click(tab(card, 'Raw'));
    expect(within(card).getByLabelText('raw output')).toHaveTextContent('"/tasks/{taskId}/publish"');
    expect(within(card).queryByText(/retrieve via artifacts bucket/)).not.toBeInTheDocument();

    const card2 = await expand(2);
    await within(card2).findByLabelText('plan output');
    await userEvent.click(tab(card2, 'Metrics'));
    const metrics = within(card2).getByLabelText('step metrics');
    expect(metrics).toHaveTextContent('Prior outputs truncated');
    expect(metrics).toHaveTextContent('no');
  });
});
