import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContractDataProvider, useContractData } from '../src/contexts/ContractDataContext.js';
import type { Entry } from '../src/lib.js';
import type { Api } from '../src/api.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type PartialApi = Pick<Api, 'listContracts' | 'getEntity'>;

const fakeApi: { listContracts: ReturnType<typeof vi.fn>; getEntity: ReturnType<typeof vi.fn> } = {
  listContracts: vi.fn(),
  getEntity: vi.fn(),
};

const singleVariantEntries: Entry[] = [
  { source: 'publisher', id: 'org', entity: 'org', currentVersion: 1, currentHash: 'h1', validation: 'valid' },
];

/** Two entries that share the same entity — forms one multi-variant group. */
const multiVariantEntries: Entry[] = [
  { source: 'publisher', id: 'user', entity: 'user', currentVersion: 1, currentHash: 'hA', validation: 'valid' },
  { source: 'consumer', id: 'user', entity: 'user', currentVersion: 2, currentHash: 'hB', validation: 'valid' },
];

/** Mixed fixture: one single-variant group (org) + one multi-variant group (user). */
const mixedEntries: Entry[] = [...singleVariantEntries, ...multiVariantEntries];

// ---------------------------------------------------------------------------
// Consumer helper — renders context values into the DOM for assertions
// ---------------------------------------------------------------------------

function Consumer() {
  const { entries, groups, loading, error, reload } = useContractData();
  return (
    <div>
      {loading && <span data-testid="loading">loading</span>}
      {error && <span data-testid="error">{error}</span>}
      <span data-testid="entry-count">{entries.length}</span>
      <span data-testid="group-count">{groups.length}</span>
      {groups.map((g) => (
        <span
          key={g.entity}
          data-testid={`group-${g.entity}`}
          data-divergent={String(g.divergent)}
        >
          {g.entity}
        </span>
      ))}
      <button onClick={reload}>reload</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi.listContracts.mockResolvedValue([]);
  fakeApi.getEntity.mockResolvedValue({ entity: 'user', divergent: false });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContractDataContext (T-07a)', () => {
  // --- Guard ---

  it('useContractData() throws a descriptive error when used outside ContractDataProvider', () => {
    // GIVEN: no ContractDataProvider in the tree
    // WHEN / THEN
    expect(() => render(<Consumer />)).toThrow(
      'useContractData must be used within a ContractDataProvider',
    );
  });

  // --- Rendering ---

  it('renders children when children prop is provided', async () => {
    // GIVEN
    fakeApi.listContracts.mockResolvedValue([]);
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <span>child content</span>
      </ContractDataProvider>,
    );
    // THEN
    expect(screen.getByText('child content')).toBeInTheDocument();
  });

  it('renders <Outlet /> child route content when no children are provided', async () => {
    // GIVEN: ContractDataProvider used as a parent route element (no children prop)
    fakeApi.listContracts.mockResolvedValue([]);
    // WHEN
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<ContractDataProvider api={fakeApi as unknown as Api} />}>
            <Route index element={<span>outlet content</span>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    // THEN: the child route's element is rendered via <Outlet />
    expect(await screen.findByText('outlet content')).toBeInTheDocument();
  });

  // --- Fetch lifecycle ---

  it('calls listContracts exactly once on mount', async () => {
    // GIVEN
    fakeApi.listContracts.mockResolvedValue([]);
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('entry-count')).toHaveTextContent('0'));
    // THEN
    expect(fakeApi.listContracts).toHaveBeenCalledOnce();
  });

  it('loading is true while the fetch is in flight and false after it resolves', async () => {
    // GIVEN: a manually-controlled promise
    let resolveList!: (v: Entry[]) => void;
    fakeApi.listContracts.mockReturnValue(
      new Promise<Entry[]>((r) => {
        resolveList = r;
      }),
    );
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    // THEN: spinner shows while in-flight
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    // AND: spinner clears after resolving
    await act(async () => {
      resolveList([]);
    });
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
  });

  it('populates entries and groups after the fetch resolves', async () => {
    // GIVEN: two entries with the same entity → one group
    fakeApi.listContracts.mockResolvedValue(multiVariantEntries);
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    // THEN
    await waitFor(() =>
      expect(screen.getByTestId('entry-count')).toHaveTextContent('2'),
    );
    expect(screen.getByTestId('group-count')).toHaveTextContent('1');
  });

  it('sets error message and clears loading when listContracts rejects', async () => {
    // GIVEN
    fakeApi.listContracts.mockRejectedValue(new Error('network failure'));
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    // THEN: error surfaces
    expect(await screen.findByTestId('error')).toHaveTextContent('network failure');
    // AND: loading cleared
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
  });

  // --- reload() ---

  it('reload() triggers a second listContracts call', async () => {
    // GIVEN
    fakeApi.listContracts.mockResolvedValue([]);
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    await waitFor(() => expect(fakeApi.listContracts).toHaveBeenCalledOnce());
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    // THEN
    await waitFor(() => expect(fakeApi.listContracts).toHaveBeenCalledTimes(2));
  });

  // --- Divergence ---

  it('calls getEntity for a multi-variant group and sets divergent flag from the result', async () => {
    // GIVEN: two entries for the same entity → multi-variant group
    fakeApi.listContracts.mockResolvedValue(multiVariantEntries);
    fakeApi.getEntity.mockResolvedValue({ entity: 'user', divergent: true });
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    // THEN: getEntity called with the entity name
    await waitFor(() => expect(fakeApi.getEntity).toHaveBeenCalledWith('user'));
    // AND: divergent flag propagated onto the group
    await waitFor(() => {
      expect(screen.getByTestId('group-user')).toHaveAttribute('data-divergent', 'true');
    });
  });

  it('does not call getEntity for a single-variant group', async () => {
    // GIVEN: only one entry — no multi-variant group
    fakeApi.listContracts.mockResolvedValue(singleVariantEntries);
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('entry-count')).toHaveTextContent('1'),
    );
    // THEN
    expect(fakeApi.getEntity).not.toHaveBeenCalled();
  });

  it('only calls getEntity for the multi-variant group, not the single-variant one', async () => {
    // GIVEN: mixed — one single-variant (org) + one multi-variant (user)
    fakeApi.listContracts.mockResolvedValue(mixedEntries);
    fakeApi.getEntity.mockResolvedValue({ entity: 'user', divergent: false });
    // WHEN
    render(
      <ContractDataProvider api={fakeApi as unknown as Api}>
        <Consumer />
      </ContractDataProvider>,
    );
    // THEN: getEntity called exactly once — only for the multi-variant entity
    await waitFor(() => expect(fakeApi.getEntity).toHaveBeenCalledOnce());
    expect(fakeApi.getEntity).toHaveBeenCalledWith('user');
    expect(fakeApi.getEntity).not.toHaveBeenCalledWith('org');
  });
});
