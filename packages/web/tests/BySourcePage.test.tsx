import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ContractDataContext } from '../src/contexts/ContractDataContext.js';
import BySourcePage from '../src/pages/BySourcePage.js';
import type { Entry } from '../src/lib.js';
import type { Api } from '../src/api.js';

// ---------------------------------------------------------------------------
// Fake API — only the methods BySourcePage's Detail panel needs
// ---------------------------------------------------------------------------

const fakeApi = {
  getContract: vi.fn(),
  getRaw: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const entries: Entry[] = [
  { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h1', validation: 'valid' },
  { source: 'consumer', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h2', validation: 'valid' },
  { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
  { source: 'consumer', id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'invalid' },
];

// ---------------------------------------------------------------------------
// Test wrapper — injects a ContractDataContext value directly so tests control
// entries/loading/error without triggering the full provider fetch cycle.
// ---------------------------------------------------------------------------

interface ContextOverrides {
  entries?: Entry[];
  loading?: boolean;
  error?: string | null;
}

function renderPage(overrides: ContextOverrides = {}) {
  const ctxValue = {
    entries: overrides.entries ?? entries,
    groups: [],
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    reload: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <ContractDataContext.Provider value={ctxValue}>
        <BySourcePage api={fakeApi as unknown as Api} />
      </ContractDataContext.Provider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BySourcePage (T-09a · R-65)', () => {
  // --- Source group headings ---

  it('renders a heading for each distinct source found in context entries', () => {
    // GIVEN
    renderPage();
    // THEN
    const sourceView = screen.getByLabelText('by-source');
    expect(within(sourceView).getByRole('heading', { name: 'publisher' })).toBeInTheDocument();
    expect(within(sourceView).getByRole('heading', { name: 'consumer' })).toBeInTheDocument();
  });

  it('renders exactly as many source headings as there are distinct sources', () => {
    // GIVEN: two sources
    renderPage();
    // THEN: exactly two h3 headings in the source view
    const sourceView = screen.getByLabelText('by-source');
    const headings = within(sourceView).getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(2);
  });

  // --- Contract rows within each group ---

  it('renders contract rows under their matching source group', () => {
    // GIVEN
    renderPage();
    // THEN: publisher's contracts are present
    const sourceView = screen.getByLabelText('by-source');
    expect(within(sourceView).getByRole('button', { name: /user v1 \(valid\)/i })).toBeInTheDocument();
    // AND: consumer's diverged version is present
    expect(within(sourceView).getByRole('button', { name: /user v2 \(invalid\)/i })).toBeInTheDocument();
  });

  it('org appears once under publisher and once under consumer', () => {
    // GIVEN
    renderPage();
    // THEN: two buttons matching org v1 (valid) — one per source group
    const sourceView = screen.getByLabelText('by-source');
    expect(within(sourceView).getAllByRole('button', { name: /org v1 \(valid\)/i })).toHaveLength(2);
  });

  // --- Detail panel ---

  it('does not show a detail panel before any row is clicked', () => {
    // GIVEN
    renderPage();
    // THEN
    expect(screen.queryByRole('heading', { name: /publisher \/ org/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /consumer \/ org/i })).not.toBeInTheDocument();
  });

  it('clicking a row opens the detail panel for that source + contract', async () => {
    // GIVEN: use "user v1 (valid)" which is unique to the publisher group
    // (groupBySource sorts groups alphabetically, so "consumer" precedes "publisher" in the DOM;
    // org appears in both groups so getAllByRole(...)[0] would hit consumer — pick a unique entry)
    fakeApi.getContract.mockResolvedValue({
      entry: {
        id: 'user', entity: 'user', name: 'User Contract',
        validation: 'valid', currentVersion: 1,
      },
      versions: [],
    });
    renderPage();
    const sourceView = screen.getByLabelText('by-source');
    // WHEN: click publisher's user v1 row (unique to publisher)
    await userEvent.click(within(sourceView).getByRole('button', { name: /user v1 \(valid\)/i }));
    // THEN: detail heading appears with the correct source/id
    expect(await screen.findByRole('heading', { name: /publisher \/ user/i })).toBeInTheDocument();
    expect(fakeApi.getContract).toHaveBeenCalledWith('publisher', 'user');
  });

  it('clicking the consumer group row opens detail for that source', async () => {
    // GIVEN
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'user', entity: 'user', validation: 'invalid', currentVersion: 2 },
      versions: [],
    });
    renderPage();
    const sourceView = screen.getByLabelText('by-source');
    // WHEN: click consumer/user (v2)
    await userEvent.click(within(sourceView).getByRole('button', { name: /user v2 \(invalid\)/i }));
    // THEN
    expect(await screen.findByRole('heading', { name: /consumer \/ user/i })).toBeInTheDocument();
    expect(fakeApi.getContract).toHaveBeenCalledWith('consumer', 'user');
  });

  it('the clicked row button is marked aria-pressed="true"', async () => {
    // GIVEN
    fakeApi.getContract.mockResolvedValue({
      entry: { id: 'org', entity: 'org', validation: 'valid', currentVersion: 1 },
      versions: [],
    });
    renderPage();
    const sourceView = screen.getByLabelText('by-source');
    const btn = within(sourceView).getAllByRole('button', { name: /org v1 \(valid\)/i })[0];
    // GIVEN: initially not pressed
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    // WHEN
    await userEvent.click(btn);
    // THEN
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  // --- Edge cases ---

  it('renders an empty container when entries is empty', () => {
    // GIVEN: no contract data yet (typical during initial load)
    renderPage({ entries: [] });
    // THEN: the by-source container renders but has no rows or headings
    const sourceView = screen.getByLabelText('by-source');
    expect(within(sourceView).queryAllByRole('button')).toHaveLength(0);
    expect(within(sourceView).queryAllByRole('heading')).toHaveLength(0);
  });

  it('renders an empty list when context has loading:true (data not yet fetched)', () => {
    // NOTE: BySourcePage does not render its own loading indicator; it renders whatever
    // entries are available. The ContractDataProvider (or the App layout) is responsible
    // for rendering a loading spinner on top of the route.  This test confirms the
    // component renders without crashing while entries are absent during fetch.
    renderPage({ entries: [], loading: true });
    // THEN: by-source container present, no contract rows
    expect(screen.getByLabelText('by-source')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders without crash when context has an error (parent handles error UI)', () => {
    // NOTE: BySourcePage does not render an error alert itself; error display is handled
    // by the ContractDataProvider wrapper. This test confirms no uncaught exception.
    renderPage({ entries: [], error: 'network failure' });
    expect(screen.getByLabelText('by-source')).toBeInTheDocument();
  });

  it('renders entries from a single source with one group heading', () => {
    // GIVEN: only one source
    renderPage({
      entries: [
        { source: 'publisher', id: 'svc', entity: 'svc', currentVersion: 3, currentHash: 'hX', validation: 'valid' },
      ],
    });
    // THEN
    const sourceView = screen.getByLabelText('by-source');
    expect(within(sourceView).getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(within(sourceView).getByRole('button', { name: /svc v3 \(valid\)/i })).toBeInTheDocument();
  });
});
