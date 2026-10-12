/**
 * [web] Experiments view tests (T-12a).
 * Covers: NewPromptVersionForm, NewExperimentForm, ExperimentsView (reader gate),
 * and ExperimentComparison (polling start/stop + failed status).
 */
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../src/App.js';

// ------------------------------------------------------------------ //
// Module-scope mocks
// ------------------------------------------------------------------ //
const authState: { token: string | undefined } = { token: undefined };
vi.mock('../src/auth.js', () => ({
  currentToken: () => Promise.resolve(authState.token),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const fakeApi = {
  listContracts: vi.fn(),
  getContract: vi.fn(),
  getRaw: vi.fn(),
  getEntity: vi.fn(),
  listCrawls: vi.fn(),
  refresh: vi.fn(),
  listRequirements: vi.fn(),
  listPromptVersions: vi.fn(),
  getPromptVersion: vi.fn(),
  listExperiments: vi.fn(),
  createPromptVersion: vi.fn(),
  createExperiment: vi.fn(),
  getExperiment: vi.fn(),
  getExperimentArtifact: vi.fn(),
};
vi.mock('../src/api.js', () => ({
  createApi: () => fakeApi,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`API ${status}`);
      this.status = status;
    }
  },
}));

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //
function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer', 'reader'], username: 'writer@demo' });
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

const promptVersions = [
  { promptVersion: 'v1', modelId: 'claude-sonnet-4-6', createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z', createdBy: 'tester' },
  { promptVersion: 'v2', modelId: 'claude-haiku-3', createdAt: '2026-01-02T00:00:00.000Z', startedAt: '2026-01-02T00:00:00.000Z', createdBy: 'tester' },
];

const experimentList = [
  {
    experimentId: 'exp-1',
    kind: 'EXPERIMENT' as const,
    promptVersion: 'v1',
    status: 'pending' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'tester',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  authState.token = undefined;
  fakeApi.listContracts.mockResolvedValue([]);
  fakeApi.listRequirements.mockResolvedValue([]);
  fakeApi.listPromptVersions.mockResolvedValue({ promptVersions });
  fakeApi.listExperiments.mockResolvedValue({ experiments: experimentList });
  fakeApi.getExperiment.mockResolvedValue(experimentList[0]);
  fakeApi.getExperimentArtifact.mockResolvedValue({
    experimentId: 'exp-1',
    promptVersion: 'v1',
    status: 'succeeded',
    planCount: 2,
    skipCount: 0,
    artifact: { plans: [{ summary: 'Plan A' }, { summary: 'Plan B' }] },
  });
});

/** Render App as an authenticated user and navigate to the Experiments view. */
async function openExperimentsView(token: string) {
  authState.token = token;
  render(<App />);
  await screen.findByRole('button', { name: /^experiments$/i });
  await userEvent.click(screen.getByRole('button', { name: /^experiments$/i }));
  return screen.findByLabelText('experiments');
}

// ------------------------------------------------------------------ //
// NewPromptVersionForm
// ------------------------------------------------------------------ //
describe('NewPromptVersionForm (T-12a)', () => {
  it('resets fields and calls createPromptVersion after successful submission', async () => {
    // GIVEN
    const MODEL = 'us.anthropic.claude-sonnet-4-6';
    fakeApi.createPromptVersion.mockResolvedValueOnce({
      promptVersion: 'v3',
      modelId: MODEL,
      text: 'New prompt text',
      createdAt: '2026-01-03T00:00:00.000Z',
      startedAt: '2026-01-03T00:00:00.000Z',
      createdBy: 'tester',
    });

    const view = await openExperimentsView(writerToken);
    const versionInput = within(view).getByLabelText(/version id/i);
    const modelSelect = within(view).getByLabelText(/model id/i);
    const textArea = within(view).getByLabelText(/prompt text/i);
    const notesInput = within(view).getByLabelText(/notes/i);

    // WHEN
    await userEvent.type(versionInput, 'v3');
    await userEvent.selectOptions(modelSelect, MODEL);
    await userEvent.type(textArea, 'New prompt text');
    await userEvent.type(notesInput, 'Initial version');
    await userEvent.click(within(view).getByRole('button', { name: /^create$/i }));

    // THEN: api was called with the correct payload
    await waitFor(() => {
      expect(fakeApi.createPromptVersion).toHaveBeenCalledWith({
        promptVersion: 'v3',
        modelId: MODEL,
        text: 'New prompt text',
        notes: 'Initial version',
      });
    });
    // Fields reset after success
    await waitFor(() => {
      expect(versionInput).toHaveValue('');
      expect(modelSelect).toHaveValue('');
      expect(textArea).toHaveValue('');
      expect(notesInput).toHaveValue('');
    });
  });

  it('shows "Version already exists" error on 409', async () => {
    // GIVEN
    const err = Object.assign(new Error('API 409'), { status: 409 });
    fakeApi.createPromptVersion.mockRejectedValueOnce(err);

    const view = await openExperimentsView(writerToken);
    await userEvent.type(within(view).getByLabelText(/version id/i), 'v1');
    await userEvent.selectOptions(within(view).getByLabelText(/model id/i), 'us.anthropic.claude-sonnet-4-6');
    await userEvent.type(within(view).getByLabelText(/prompt text/i), 'Some text');

    // WHEN
    await userEvent.click(within(view).getByRole('button', { name: /^create$/i }));

    // THEN
    expect(await screen.findByRole('alert')).toHaveTextContent('Version already exists');
    // Fields are NOT reset on error
    expect(within(view).getByLabelText(/version id/i)).toHaveValue('v1');
  });
});

// ------------------------------------------------------------------ //
// NewExperimentForm
// ------------------------------------------------------------------ //
describe('NewExperimentForm (T-12a)', () => {
  it('renders <select> populated from listPromptVersions and calls onCreated with experimentId', async () => {
    // GIVEN
    fakeApi.createExperiment.mockResolvedValueOnce({
      experimentId: 'exp-new',
      statusUrl: '/experiments/exp-new',
    });
    fakeApi.getExperiment.mockResolvedValue({
      ...experimentList[0],
      experimentId: 'exp-new',
    });

    const view = await openExperimentsView(writerToken);
    // The Experiments view has two selects: model ID (NewPromptVersionForm) and prompt version (NewExperimentForm).
    // getByLabelText scopes to the prompt version select by its label.
    const select = within(view).getByLabelText(/prompt version/i);

    // THEN: each prompt version appears as an option in the select
    await waitFor(() => {
      expect(within(select as HTMLElement).getByRole('option', { name: /v1/i })).toBeInTheDocument();
      expect(within(select as HTMLElement).getByRole('option', { name: /v2/i })).toBeInTheDocument();
    });

    // WHEN: select v1 and submit
    await userEvent.selectOptions(select, 'v1');
    await userEvent.click(within(view).getByRole('button', { name: /run experiment/i }));

    // THEN: createExperiment called with the chosen version
    await waitFor(() => {
      expect(fakeApi.createExperiment).toHaveBeenCalledWith({ promptVersion: 'v1' });
    });
    // listExperiments refreshed after creation (initial mount + post-create)
    await waitFor(() => {
      expect(fakeApi.listExperiments).toHaveBeenCalledTimes(2);
    });
  });
});

// ------------------------------------------------------------------ //
// ExperimentsView — reader gate
// ------------------------------------------------------------------ //
describe('ExperimentsView reader gate (T-12a)', () => {
  it('does not render NewPromptVersionForm or NewExperimentForm for a reader-only token', async () => {
    // GIVEN / WHEN
    const view = await openExperimentsView(readerToken);

    // THEN: form headings are absent
    expect(within(view).queryByRole('heading', { name: /new prompt version/i })).not.toBeInTheDocument();
    expect(within(view).queryByRole('heading', { name: /new experiment/i })).not.toBeInTheDocument();
    // No version select
    expect(within(view).queryByRole('combobox')).not.toBeInTheDocument();
    // Experiment list is still visible
    expect(within(view).getByRole('heading', { name: /^experiments$/i })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ //
// ExperimentComparison — polling
// ------------------------------------------------------------------ //
describe('ExperimentComparison polling (T-12a)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts polling while pending and calls clearInterval when status transitions to succeeded', async () => {
    // GIVEN — fake only setInterval/clearInterval so waitFor (setTimeout) still works
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    // Initial poll (on mount) returns pending; first interval tick returns completed
    fakeApi.getExperiment
      .mockResolvedValueOnce({ ...experimentList[0], status: 'pending' })
      .mockResolvedValueOnce({ ...experimentList[0], status: 'succeeded' });

    const view = await openExperimentsView(writerToken);

    // Click the experiment row to mount ExperimentComparison
    await userEvent.click(within(view).getByRole('button', { name: /exp-1/i }));

    // Wait for the initial poll to resolve and the detail section to appear
    await screen.findByLabelText('experiment detail');
    // Running indicator present while pending
    expect(screen.getByRole('status')).toHaveTextContent(/running/i);

    // WHEN: advance 5 seconds to fire the polling interval
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    // Let the async interval callback (getExperiment + getExperimentArtifact) resolve
    await act(async () => {});

    // THEN: clearInterval was called to stop polling
    await waitFor(() => {
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
    // Artifact fetched after completion
    await waitFor(() => {
      expect(fakeApi.getExperimentArtifact).toHaveBeenCalledWith('exp-1');
    });
  });

  it('shows an error message and does not fetch the artifact when status is failed', async () => {
    // GIVEN
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    fakeApi.getExperiment.mockResolvedValue({
      ...experimentList[0],
      status: 'failed',
      error: 'Bedrock timeout',
    });

    const view = await openExperimentsView(writerToken);

    // WHEN: click the experiment
    await userEvent.click(within(view).getByRole('button', { name: /exp-1/i }));
    await screen.findByLabelText('experiment detail');

    // THEN: error is shown with the message from experiment.error
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Bedrock timeout');
    });
    // No artifact fetch on failed status
    expect(fakeApi.getExperimentArtifact).not.toHaveBeenCalled();
  });
});
