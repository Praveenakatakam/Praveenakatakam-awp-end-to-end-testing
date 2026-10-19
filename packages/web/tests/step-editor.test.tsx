/**
 * [web] tier — shared StepEditor in both pipeline views (T-21 · R-67 · TS-51).
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PipelinePage from '../src/pages/PipelinePage.js';
import PipelinesPage from '../src/pages/PipelinesPage.js';
import type { Api } from '../src/api.js';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer'] });
const readerToken = jwt({ 'cognito:groups': ['reader'] });

const pipeline = {
  pk: 'PIPELINE#pipe-1', sk: 'PIPELINE', kind: 'PIPELINE',
  pipelineId: 'pipe-1', name: 'My Pipeline', version: 3, active: true,
  maxSteps: 10, maxAgeMinutes: 60,
  defaultSampling: { strategy: 'first_n', n: 3 }, defaultMode: 'per_requirement',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  steps: [
    { stepId: 's1', label: 'Draft plan', model: 'us.anthropic.claude-sonnet-4-6', promptKey: 'plan-prompt',
      optional: false, waitForHuman: false, includeContext: true },
    { stepId: 's2', label: 'Review', model: 'us.anthropic.claude-haiku-4-5', promptKey: 'critique-prompt',
      optional: true, waitForHuman: false, includeContext: true, outputType: 'critique' },
  ],
};

function makeApi() {
  return {
    getPipeline: vi.fn().mockResolvedValue(pipeline),
    listPipelines: vi.fn().mockResolvedValue({ pipelines: [pipeline] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [{ promptKey: 'plan-prompt' }, { promptKey: 'critique-prompt' }] }),
    getPrompt: vi.fn().mockImplementation(async (key: string) => ({ promptKey: key, body: `BODY OF ${key}` })),
    updatePipeline: vi.fn().mockImplementation(async (_id: string, body: unknown) => ({ ...pipeline, ...(body as object) })),
    runPipeline: vi.fn(),
    createPrompt: vi.fn(),
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

function renderAt(path: string, element: React.ReactNode, routePath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());

describe('PipelinePage full view (T-21 · R-67, R-68)', () => {
  it('TS-51: shows a "View prompt body" control for the selected step that reveals the prompt text', async () => {
    const api = makeApi();
    renderAt('/pipelines/pipe-1', <PipelinePage api={api} token={readerToken} />, '/pipelines/:pipelineId');
    const side = await screen.findByRole('complementary', { name: 'step-detail' });
    await userEvent.click(within(side).getByRole('button', { name: /view prompt body/i }));
    expect(await within(side).findByText('BODY OF plan-prompt')).toBeInTheDocument();
    expect(api.getPrompt).toHaveBeenCalledWith('plan-prompt');
  });

  it('lays out the step list and the selected step editor in a split pane', async () => {
    const api = makeApi();
    renderAt('/pipelines/pipe-1', <PipelinePage api={api} token={writerToken} />, '/pipelines/:pipelineId');
    const list = await screen.findByRole('list', { name: 'steps' });
    expect(screen.getByRole('separator')).toBeInTheDocument();
    const side = screen.getByRole('complementary', { name: 'step-detail' });
    expect(within(side).getByLabelText('Label')).toHaveValue('Draft plan');

    await userEvent.click(within(list).getByRole('button', { name: /review/i }));
    expect(within(side).getByLabelText('Label')).toHaveValue('Review');
    expect(within(side).getByLabelText('Output type')).toHaveValue('critique');
  });

  it('defaults a step without outputType to "plan" and saves the selected outputType', async () => {
    const api = makeApi();
    renderAt('/pipelines/pipe-1', <PipelinePage api={api} token={writerToken} />, '/pipelines/:pipelineId');
    const side = await screen.findByRole('complementary', { name: 'step-detail' });
    const select = within(side).getByLabelText('Output type');
    expect(select).toHaveValue('plan');
    await userEvent.selectOptions(select, 'freeform');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.updatePipeline).toHaveBeenCalled());
    const body = (api.updatePipeline as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.steps[0].outputType).toBe('freeform');
    expect(body.steps[1].outputType).toBe('critique');
  });

  it('defaults "Output instructions" off and saves it when switched on (R-73, D-30)', async () => {
    const api = makeApi();
    renderAt('/pipelines/pipe-1', <PipelinePage api={api} token={writerToken} />, '/pipelines/:pipelineId');
    const side = await screen.findByRole('complementary', { name: 'step-detail' });
    const box = within(side).getByLabelText('Output instructions');
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.updatePipeline).toHaveBeenCalled());
    const body = (api.updatePipeline as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.steps[0].outputInstructions).toBe(true);
    expect(body.steps[1].outputInstructions).toBeUndefined();
  });
});

describe('PipelinesPage side panel (T-21 · R-67)', () => {
  it('uses the shared step editor with "View prompt body" and an outputType selector', async () => {
    const api = makeApi();
    renderAt('/pipelines', <PipelinesPage api={api} token={writerToken} />, '/pipelines');
    await userEvent.click(await screen.findByText('My Pipeline'));
    const side = await screen.findByRole('complementary', { name: 'pipeline-detail' });
    expect(screen.getByRole('separator')).toBeInTheDocument();
    const editors = within(side).getAllByTestId('step-editor');
    expect(editors).toHaveLength(2);
    expect(within(editors[1]).getByLabelText('Output type')).toHaveValue('critique');
    await userEvent.click(within(editors[1]).getByRole('button', { name: /view prompt body/i }));
    expect(await within(editors[1]).findByText('BODY OF critique-prompt')).toBeInTheDocument();
  });
});
