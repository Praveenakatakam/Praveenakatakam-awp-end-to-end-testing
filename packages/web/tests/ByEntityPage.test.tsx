/**
 * [web] ByEntityPage — entity table + contract detail panel (T-08a).
 *
 * Strategy: mock useContractData() so each test controls context state
 * directly without going through ContractDataProvider's fetch cycle.
 * api is passed as a prop to ByEntityPage (and forwarded to Detail /
 * DiffView calls), so we pass a fakeApi object.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { EntityGroup } from '../src/lib.js';
import type { Api } from '../src/api.js';

// ---------------------------------------------------------------------------
// Hoist the useContractData mock so vi.mock factory can reference it.
// ---------------------------------------------------------------------------

const { mockUseContractData } = vi.hoisted(() => ({
  mockUseContractData: vi.fn(),
}));

vi.mock('../src/contexts/ContractDataContext.js', () => ({
  useContractData: mockUseContractData,
}));

// Import after mock setup
import ByEntityPage from '../src/pages/ByEntityPage.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const orgGroup: EntityGroup = {
  entity: 'org',
  variants: [
    { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h1', validation: 'valid' },
  ],
  divergent: false,
};

const userGroupConvergent: EntityGroup = {
  entity: 'user',
  variants: [
    { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
    { source: 'consumer',  id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'valid' },
  ],
  divergent: false,
};

const userGroupDivergent: EntityGroup = {
  ...userGroupConvergent,
  divergent: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeApi: Partial<Api> & {
  getContract: ReturnType<typeof vi.fn>;
  getEntity:   ReturnType<typeof vi.fn>;
  getRaw:      ReturnType<typeof vi.fn>;
} = {
  getContract: vi.fn(),
  getEntity:   vi.fn(),
  getRaw:      vi.fn(),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ByEntityPage api={fakeApi as unknown as Api} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no data, not loading, no error
  mockUseContractData.mockReturnValue({
    entries: [],
    groups: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ByEntityPage (T-08a)', () => {
  // --- Loading state ---

  it('renders a loading indicator while data is loading', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [], loading: true, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders nothing from the entity list while loading (no premature data)', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: true, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN — the page returns early; entity names are not rendered
    expect(screen.queryByText('org')).not.toBeInTheDocument();
  });

  // --- Error state ---

  it('renders an error alert with the error message', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [], loading: false, error: 'network failure', reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('network failure');
  });

  it('does not render entity rows when in the error state', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: 'oops', reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.queryByText('org')).not.toBeInTheDocument();
  });

  // --- Entity groups rendering ---

  it('renders each entity group name', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup, userGroupConvergent], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.getByText('org')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('renders a variant row for each entry in a group', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupConvergent], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN — both publisher and consumer variant rows appear
    expect(screen.getByRole('button', { name: /publisher/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /consumer/i })).toBeInTheDocument();
  });

  it('renders the current version in the variant row label', () => {
    // GIVEN: consumer is v2
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupConvergent], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.getByRole('button', { name: /consumer/i })).toHaveTextContent('v2');
  });

  // --- Divergent badge + Show diff button ---

  it('shows no divergent badge for a non-divergent group', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.queryByTestId('divergent')).not.toBeInTheDocument();
  });

  it('shows a divergent badge for a divergent group', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupDivergent], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN
    expect(screen.getByTestId('divergent')).toBeInTheDocument();
    expect(screen.getByTestId('divergent')).toHaveTextContent('divergent');
  });

  it('shows a "Show diff" button only for the divergent group', () => {
    // GIVEN: org (non-divergent) + user (divergent)
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup, userGroupDivergent], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN — exactly one Show diff button for the user entity
    const diffBtn = screen.getByRole('button', { name: /show user diff/i });
    expect(diffBtn).toBeInTheDocument();
    // AND — no Show diff for org
    expect(screen.queryByRole('button', { name: /show org diff/i })).not.toBeInTheDocument();
  });

  // --- DiffView panel ---

  it('clicking "Show diff" calls api.getEntity and renders the DiffView', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupDivergent], loading: false, error: null, reload: vi.fn() });
    fakeApi.getEntity.mockResolvedValue({
      entity: 'user',
      divergent: true,
      diff: {
        onlyInA: [{ path: 'user.password' }],
        onlyInB: [{ path: 'user.middleName' }],
        changed: [{ path: 'user.email', field: 'required' }],
      },
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /show user diff/i }));
    // THEN — api called with the entity name
    expect(fakeApi.getEntity).toHaveBeenCalledWith('user');
    // AND — DiffView panel appears
    const diff = await screen.findByLabelText('diff');
    expect(diff).toBeInTheDocument();
  });

  it('DiffView shows onlyInA, onlyInB, and changed fields', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupDivergent], loading: false, error: null, reload: vi.fn() });
    fakeApi.getEntity.mockResolvedValue({
      entity: 'user',
      divergent: true,
      diff: {
        onlyInA: [{ path: 'user.password' }],
        onlyInB: [{ path: 'user.middleName' }],
        changed: [{ path: 'user.email', field: 'required' }],
      },
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /show user diff/i }));
    const diff = await screen.findByLabelText('diff');
    // THEN
    expect(diff).toHaveTextContent('user.password');
    expect(diff).toHaveTextContent('user.middleName');
    expect(diff).toHaveTextContent('user.email.required');
  });

  it('DiffView heading reflects the divergent status badge', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [userGroupDivergent], loading: false, error: null, reload: vi.fn() });
    fakeApi.getEntity.mockResolvedValue({
      entity: 'user',
      divergent: true,
      diff: { onlyInA: [], onlyInB: [], changed: [] },
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /show user diff/i }));
    // THEN — heading contains entity name and "divergent" label
    const diff = await screen.findByLabelText('diff');
    expect(diff).toHaveTextContent('user diff');
    expect(diff).toHaveTextContent('divergent');
  });

  // --- Contract detail panel ---

  it('clicking a variant row opens the Detail panel with a heading for that contract', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'org', entity: 'org', name: 'Org Contract', declaredVersion: '1.0.0', validation: 'valid', currentVersion: 1 },
      versions: [],
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /publisher/i }));
    // THEN — Detail heading uses "source / id" format
    expect(await screen.findByRole('heading', { name: /publisher \/ org/i })).toBeInTheDocument();
  });

  it('Detail panel calls api.getContract with the selected source and id', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'org', entity: 'org', validation: 'valid', currentVersion: 1 },
      versions: [],
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /publisher/i }));
    // THEN
    await waitFor(() => expect(fakeApi.getContract).toHaveBeenCalledWith('publisher', 'org'));
  });

  it('Detail panel renders the contract metadata', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    fakeApi.getContract.mockResolvedValue({
      entry: {
        id: 'org', entity: 'org', name: 'Org Contract',
        declaredVersion: '2.0.0', validation: 'valid', currentVersion: 2,
      },
      versions: [],
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /publisher/i }));
    // THEN — metadata grid renders
    const meta = await screen.findByLabelText('metadata');
    expect(meta).toHaveTextContent('Org Contract');
    expect(meta).toHaveTextContent('2.0.0');
    expect(meta).toHaveTextContent('valid');
  });

  it('Detail panel shows version history when versions are present', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'org', entity: 'org', validation: 'valid', currentVersion: 2 },
      versions: [
        { versionNumber: 1, hash: 'aaa00001' },
        { versionNumber: 2, hash: 'bbb00002', versionNotBumped: true },
      ],
    });
    renderPage();
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /publisher/i }));
    // THEN — "version not bumped" badge rendered for the version that skipped a bump
    expect(await screen.findByText('version not bumped')).toBeInTheDocument();
    // AND — both version entries are rendered (v1 appears in variant row too; check getAllByText)
    expect(screen.getAllByText('v1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('v2').length).toBeGreaterThanOrEqual(1);
  });

  it('no detail panel is shown before any row is clicked', () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    // WHEN
    renderPage();
    // THEN — aside panel not present
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  // --- Variant row aria-pressed state ---

  it('marks the selected variant row as aria-pressed=true', async () => {
    // GIVEN
    mockUseContractData.mockReturnValue({ entries: [], groups: [orgGroup], loading: false, error: null, reload: vi.fn() });
    fakeApi.getContract.mockResolvedValue({ entry: { id: 'org', entity: 'org', validation: 'valid' }, versions: [] });
    renderPage();
    const btn = screen.getByRole('button', { name: /publisher/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    // WHEN
    await userEvent.click(btn);
    // THEN
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
