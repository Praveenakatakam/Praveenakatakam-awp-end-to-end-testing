/**
 * [web] tier — v0.6.0 unified Prompts page + legacy prompt picker + planSchema
 * (T-33 · R-84, R-86, R-89 · TS-78).
 */
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PipelineStep } from '@registry/core';
import { createApi, type Api } from '../src/api.js';
import PromptsPage from '../src/pages/PromptsPage.js';
import StepEditor, { makeStep } from '../src/components/StepEditor.js';

function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer'] });
const readerToken = jwt({ 'cognito:groups': ['reader'] });

const prompt = (promptKey: string) => ({
  promptKey, currentVersion: 1, active: true, body: `body of ${promptKey}`,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});
const legacyVersion = (promptVersion: string, modelId: string) => ({
  promptVersion, modelId, createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:00Z', createdBy: 'w',
});

function makeApi(overrides: Record<string, unknown> = {}) {
  let prompts = [prompt('p1'), prompt('legacy-v1')];
  return {
    listPrompts: vi.fn().mockImplementation(async () => ({ prompts })),
    getPrompt: vi.fn().mockImplementation(async (key: string) => prompt(key)),
    listPromptVersions: vi.fn().mockResolvedValue({
      promptVersions: [legacyVersion('v1', 'model-one'), legacyVersion('v2', 'model-two')],
    }),
    importLegacyPrompts: vi.fn().mockImplementation(async (body?: { promptVersions: string[] }) => {
      const added = (body?.promptVersions ?? []).map((pv) => `legacy-${pv}`);
      prompts = [...prompts, ...added.map(prompt)];
      return { imported: added, skipped: [] };
    }),
    createPrompt: vi.fn(),
    deletePrompt: vi.fn(),
    ...overrides,
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/prompts']}>
        <Routes>
          <Route path="/prompts" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('API client — selective legacy import (R-86)', () => {
  it('sends { promptVersions } when given, no body otherwise', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ imported: ['legacy-v2'], skipped: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const api = createApi(async () => 't');
    await api.importLegacyPrompts({ promptVersions: ['v2'] });
    await api.importLegacyPrompts();
    const [, withBody] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(withBody.body as string)).toEqual({ promptVersions: ['v2'] });
    const [, without] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(without.body).toBeUndefined();
  });
});

describe('Unified Prompts page (T-33 · R-89 · TS-78)', () => {
  it('TS-78: pipeline prompt p1 + legacy v1 (imported) + v2 → three rows; only v2 has Import', async () => {
    wrap(<PromptsPage api={makeApi()} token={writerToken} />);
    await waitFor(() => expect(screen.getAllByTestId('prompt-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('prompt-row');

    const p1 = rows.find((r) => within(r).queryByText('p1'))!;
    expect(within(p1).queryByText('legacy')).not.toBeInTheDocument();

    const v1 = rows.find((r) => within(r).queryByText('legacy-v1'))!;
    expect(within(v1).getByText('legacy')).toBeInTheDocument();
    expect(v1).toHaveTextContent('model-one');
    expect(within(v1).queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();

    const v2 = screen.getByLabelText('legacy prompt version v2');
    expect(within(v2).getByText('legacy')).toBeInTheDocument();
    expect(v2).toHaveTextContent('model-two');
    expect(within(v2).getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  it('per-row Import imports only that version and the row becomes a prompt', async () => {
    const api = makeApi();
    wrap(<PromptsPage api={api} token={writerToken} />);
    const v2 = await screen.findByLabelText('legacy prompt version v2');
    await userEvent.click(within(v2).getByRole('button', { name: 'Import' }));
    expect(api.importLegacyPrompts).toHaveBeenCalledWith({ promptVersions: ['v2'] });
    await waitFor(() => expect(screen.queryByLabelText('legacy prompt version v2')).not.toBeInTheDocument());
    expect(await screen.findByText('legacy-v2')).toBeInTheDocument();
    expect(screen.getAllByTestId('prompt-row')).toHaveLength(3);
  });

  it('readers see legacy rows without Import', async () => {
    wrap(<PromptsPage api={makeApi()} token={readerToken} />);
    const v2 = await screen.findByLabelText('legacy prompt version v2');
    expect(within(v2).queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });
});

function Harness({ api, initial, onStep }: { api: Api; initial: PipelineStep; onStep: (s: PipelineStep) => void }) {
  const [step, setStep] = useState(initial);
  return (
    <StepEditor api={api} step={step} index={0} total={1} writer
      onChange={(s) => { setStep(s); onStep(s); }} />
  );
}

/** The prompt <select> once prompts + legacy versions have loaded (an <input> renders before). */
async function findLegacyPicker(): Promise<HTMLSelectElement> {
  return waitFor(() => {
    const el = screen.getByLabelText('Prompt key');
    expect(el.tagName).toBe('SELECT');
    expect(el.querySelector('optgroup')).not.toBeNull();
    return el as HTMLSelectElement;
  });
}

describe('StepEditor legacy prompt group + planSchema (T-33 · R-84, R-89)', () => {
  it('offers un-imported legacy versions in an optgroup; selecting one imports then selects legacy-<pv>', async () => {
    const api = makeApi();
    const onStep = vi.fn();
    wrap(<Harness api={api} initial={makeStep(0)} onStep={onStep} />);
    const picker = await findLegacyPicker();
    const group = picker.querySelector('optgroup[label="Legacy (import on select)"]') as HTMLElement;
    // v1 is already imported (legacy-v1 is a regular option); only v2 is offered.
    expect(within(group).getAllByRole('option').map((o) => o.textContent)).toEqual(['v2 → legacy-v2']);
    expect(within(picker).getByRole('option', { name: 'legacy-v1' })).toBeInTheDocument();

    await userEvent.selectOptions(picker, '__legacy__:v2');
    expect(api.importLegacyPrompts).toHaveBeenCalledWith({ promptVersions: ['v2'] });
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ promptKey: 'legacy-v2' })));
    await waitFor(() => expect(picker).toHaveValue('legacy-v2'));
    expect(picker.querySelector('optgroup')).toBeNull();
  });

  it('shows an error and keeps the prompt when the import fails', async () => {
    const api = makeApi({ importLegacyPrompts: vi.fn().mockRejectedValue(new Error('boom')) });
    const onStep = vi.fn();
    wrap(<Harness api={api} initial={makeStep(0)} onStep={onStep} />);
    const picker = await findLegacyPicker();
    await userEvent.selectOptions(picker, '__legacy__:v2');
    expect(await screen.findByRole('alert')).toHaveTextContent(/import of legacy v2 failed: boom/i);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('planSchema select shows only for plan steps; v1 sets it, v2 and non-plan clear it', async () => {
    const onStep = vi.fn();
    wrap(<Harness api={makeApi()} initial={makeStep(0)} onStep={onStep} />);
    const schema = await screen.findByLabelText('Plan schema');
    expect(schema).toHaveValue('v2');
    expect(within(schema).getAllByRole('option').map((o) => o.textContent)).toEqual(['v2 (default)', 'v1 (legacy)']);

    await userEvent.selectOptions(schema, 'v1');
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ planSchema: 'v1' }));

    await userEvent.selectOptions(screen.getByLabelText('Output type'), 'critique');
    expect(onStep.mock.lastCall![0]).not.toHaveProperty('planSchema');
    expect(screen.queryByLabelText('Plan schema')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Output type'), 'plan');
    await userEvent.selectOptions(screen.getByLabelText('Plan schema'), 'v1');
    await userEvent.selectOptions(screen.getByLabelText('Plan schema'), 'v2');
    expect(onStep.mock.lastCall![0]).not.toHaveProperty('planSchema');
  });
});
