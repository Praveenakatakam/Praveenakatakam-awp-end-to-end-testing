/**
 * [web] ExperimentsPage component tests (T-04a, updated T-11).
 *
 * T-11 replaced the `promptTab` state with URL-based navigation (useLocation /
 * useNavigate). All renders are now wrapped in <MemoryRouter>. Tab-switching
 * tests assert on URL-driven sub-view rendering instead of state transitions.
 *
 * Covers:
 *   - Tab buttons render and default tab is "Experiment runs" (URL default)
 *   - Clicking "Prompt versions" button navigates → prompt versions sub-view
 *   - Clicking "Experiment runs" button navigates back → experiment runs sub-view
 *   - Rendering at /experiments/prompt-versions shows prompt versions list
 *   - Rendering at /experiments/run shows experiment runs list
 *   - Experiment rows render with status badges
 *   - Selecting a single experiment row shows the detail panel
 *   - Selecting two experiment rows shows the side-by-side comparison layout
 *   - Deselecting a row hides the detail panel
 *   - Empty states (no experiments, no prompt versions)
 *   - Writer forms (NewPromptVersionForm + NewExperimentForm) gated by isWriter(token)
 *   - Prompt version rows render on the prompts sub-view
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExperimentsPage from '../src/pages/ExperimentsPage.js';

// ------------------------------------------------------------------ //
// Fake API — ExperimentsPage receives api as a prop, no module mock needed
// ------------------------------------------------------------------ //
const fakeApi = {
  listExperiments: vi.fn(),
  listPromptVersions: vi.fn(),
  getExperiment: vi.fn(),
  getExperimentArtifact: vi.fn(),
  createPromptVersion: vi.fn(),
  createExperiment: vi.fn(),
};

// ------------------------------------------------------------------ //
// JWT helpers — matches experiments.test.tsx pattern
// ------------------------------------------------------------------ //
function jwt(payload: object): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer', 'reader'], username: 'writer@demo' });
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

// ------------------------------------------------------------------ //
// Fixtures
// ------------------------------------------------------------------ //
const promptVersions = [
  {
    promptVersion: 'v1',
    modelId: 'us.anthropic.claude-sonnet-4-6',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'tester',
  },
  {
    promptVersion: 'v2',
    modelId: 'us.anthropic.claude-haiku-3',
    createdAt: '2026-01-02T00:00:00.000Z',
    createdBy: 'tester',
  },
];

const experimentA = {
  experimentId: 'exp-a',
  kind: 'EXPERIMENT' as const,
  promptVersion: 'v1',
  status: 'succeeded' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'tester',
};

const experimentB = {
  experimentId: 'exp-b',
  kind: 'EXPERIMENT' as const,
  promptVersion: 'v2',
  status: 'failed' as const,
  createdAt: '2026-01-02T00:00:00.000Z',
  createdBy: 'tester',
  error: 'Bedrock timeout',
};

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi.listExperiments.mockResolvedValue({ experiments: [experimentA, experimentB] });
  fakeApi.listPromptVersions.mockResolvedValue({ promptVersions });
  // Default: smart dispatch by experimentId so comparison tests work out of the box
  fakeApi.getExperiment.mockImplementation((id: string) =>
    Promise.resolve(id === 'exp-b' ? experimentB : experimentA),
  );
  fakeApi.getExperimentArtifact.mockResolvedValue({
    experimentId: 'exp-a',
    promptVersion: 'v1',
    status: 'succeeded',
    planCount: 1,
    skipCount: 0,
    artifact: { manifest: { plans: [{ title: 'Test Plan A' }], skipped: [] } },
  });
});

// ------------------------------------------------------------------ //
// Helper: render ExperimentsPage inside MemoryRouter at a given path
// ------------------------------------------------------------------ //
function renderAt(path: string, token = readerToken) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExperimentsPage api={fakeApi as any} token={token} />
    </MemoryRouter>,
  );
}

// ------------------------------------------------------------------ //
// Tab rendering and URL-based sub-view switching
// ------------------------------------------------------------------ //
describe('ExperimentsPage — tab navigation (T-04a / T-11)', () => {
  it('renders both "Experiment runs" and "Prompt versions" tab buttons', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/run');

    // THEN
    expect(screen.getByRole('button', { name: /experiment runs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prompt versions/i })).toBeInTheDocument();
  });

  it('defaults to the experiments list view at /experiments/run with "Experiment runs" tab active', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/run');

    // THEN: active tab button is disabled (aria-pressed + disabled per component impl)
    expect(screen.getByRole('button', { name: /experiment runs/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /prompt versions/i })).not.toBeDisabled();

    // AND: experiment rows appear once data loads
    expect(await screen.findByRole('button', { name: /exp-a/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exp-b/i })).toBeInTheDocument();
  });

  it('renders prompt versions sub-view when path is /experiments/prompt-versions', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/prompt-versions');

    // THEN: "Prompt versions" tab is active (disabled)
    expect(screen.getByRole('button', { name: /prompt versions/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /experiment runs/i })).not.toBeDisabled();

    // AND: version rows are visible
    expect(await screen.findByRole('button', { name: /v1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /v2/i })).toBeInTheDocument();
  });

  it('clicking "Prompt versions" tab navigates to the prompt versions sub-view', async () => {
    // GIVEN: start on the experiments/run sub-view
    renderAt('/experiments/run');
    await screen.findByRole('button', { name: /experiment runs/i });

    // WHEN: click the "Prompt versions" tab button
    await userEvent.click(screen.getByRole('button', { name: /prompt versions/i }));

    // THEN: version rows become visible
    expect(await screen.findByRole('button', { name: /v1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /v2/i })).toBeInTheDocument();

    // AND: "Prompt versions" tab is now active (disabled)
    expect(screen.getByRole('button', { name: /prompt versions/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /experiment runs/i })).not.toBeDisabled();
  });

  it('clicking "Experiment runs" tab switches back from the prompt versions sub-view', async () => {
    // GIVEN: start on the prompt-versions sub-view
    renderAt('/experiments/prompt-versions');
    await screen.findByRole('button', { name: /v1/i });

    // WHEN: click "Experiment runs"
    await userEvent.click(screen.getByRole('button', { name: /experiment runs/i }));

    // THEN: experiment rows are visible
    expect(await screen.findByRole('button', { name: /exp-a/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /experiment runs/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /prompt versions/i })).not.toBeDisabled();
  });
});

// ------------------------------------------------------------------ //
// Experiment rows and status badges
// ------------------------------------------------------------------ //
describe('ExperimentsPage — experiment rows (T-04a)', () => {
  it('renders experiment rows with status text for each experiment', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/run');

    // THEN: exp-a row contains its status
    const rowA = await screen.findByRole('button', { name: /exp-a/i });
    expect(rowA).toHaveTextContent('succeeded');

    // AND: exp-b row contains its status
    const rowB = screen.getByRole('button', { name: /exp-b/i });
    expect(rowB).toHaveTextContent('failed');
  });

  it('renders the "No experiments yet." empty state when the list is empty', async () => {
    // GIVEN
    fakeApi.listExperiments.mockResolvedValue({ experiments: [] });

    // WHEN
    renderAt('/experiments/run');

    // THEN
    expect(await screen.findByText(/no experiments yet/i)).toBeInTheDocument();
  });

  it('shows a hint message when one experiment is selected', async () => {
    // GIVEN
    renderAt('/experiments/run');
    const rowA = await screen.findByRole('button', { name: /exp-a/i });

    // WHEN
    await userEvent.click(rowA);

    // THEN: instructional hint appears
    expect(await screen.findByText(/click another to compare/i)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ //
// Row selection — detail panel
// ------------------------------------------------------------------ //
describe('ExperimentsPage — row selection (T-04a)', () => {
  it('selecting a single experiment row shows the detail panel', async () => {
    // GIVEN
    renderAt('/experiments/run');
    const rowA = await screen.findByRole('button', { name: /exp-a/i });

    // WHEN
    await userEvent.click(rowA);

    // THEN: one detail panel appears
    expect(await screen.findByLabelText('experiment detail')).toBeInTheDocument();
  });

  it('selecting two experiment rows shows the side-by-side comparison layout', async () => {
    // GIVEN
    renderAt('/experiments/run');
    const rowA = await screen.findByRole('button', { name: /exp-a/i });
    const rowB = screen.getByRole('button', { name: /exp-b/i });

    // WHEN: select both rows
    await userEvent.click(rowA);
    await screen.findByLabelText('experiment detail');
    await userEvent.click(rowB);

    // THEN: two detail panels are rendered (one per experiment)
    await waitFor(() => {
      expect(screen.getAllByLabelText('experiment detail')).toHaveLength(2);
    });
  });

  it('deselecting a row by clicking it again hides the detail panel', async () => {
    // GIVEN: select exp-a
    renderAt('/experiments/run');
    const rowA = await screen.findByRole('button', { name: /exp-a/i });
    await userEvent.click(rowA);
    await screen.findByLabelText('experiment detail');

    // WHEN: click the same row again
    await userEvent.click(rowA);

    // THEN: detail panel is dismissed
    await waitFor(() => {
      expect(screen.queryByLabelText('experiment detail')).not.toBeInTheDocument();
    });
  });
});

// ------------------------------------------------------------------ //
// Writer forms (R-07 · isWriter gate)
// ------------------------------------------------------------------ //
describe('ExperimentsPage — writer gate (T-04a)', () => {
  it('renders NewPromptVersionForm and NewExperimentForm cards for a writer token', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/run', writerToken);

    // THEN: both form card titles are visible
    expect(await screen.findByText('New Prompt Version')).toBeInTheDocument();
    expect(screen.getByText('Run Experiment')).toBeInTheDocument();
  });

  it('does not render writer form cards for a reader-only token', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/run', readerToken);
    // Ensure the page has settled so we're not catching a loading state
    await screen.findByRole('button', { name: /experiment runs/i });

    // THEN: no writer form card titles in the DOM
    expect(screen.queryByText('New Prompt Version')).not.toBeInTheDocument();
    expect(screen.queryByText('Run Experiment')).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ //
// Prompt versions list
// ------------------------------------------------------------------ //
describe('ExperimentsPage — prompt versions list (T-04a)', () => {
  it('renders prompt version rows at /experiments/prompt-versions', async () => {
    // GIVEN / WHEN
    renderAt('/experiments/prompt-versions');

    // THEN: each version appears as a row button
    const v1Row = await screen.findByRole('button', { name: /v1/i });
    expect(v1Row).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /v2/i })).toBeInTheDocument();
  });

  it('renders prompt version rows when switching to the prompts tab via click', async () => {
    // GIVEN
    renderAt('/experiments/run');
    await screen.findByRole('button', { name: /experiment runs/i });

    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /prompt versions/i }));

    // THEN: each version appears as a row button
    const v1Row = await screen.findByRole('button', { name: /v1/i });
    expect(v1Row).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /v2/i })).toBeInTheDocument();
  });

  it('renders the "No prompt versions yet." empty state when list is empty', async () => {
    // GIVEN
    fakeApi.listPromptVersions.mockResolvedValue({ promptVersions: [] });
    renderAt('/experiments/prompt-versions');

    // THEN
    expect(await screen.findByText(/no prompt versions yet/i)).toBeInTheDocument();
  });
});
