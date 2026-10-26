/**
 * shell-navigation.test.tsx — [web] tier
 *
 * Tests for AppRoutes shell navigation (T-11a · R-22, R-24, R-25).
 *
 * Mounts AppRoutes under MemoryRouter (not AppShell) so tests are
 * isolated from auth, HashRouter, and CrawlProvider setup.
 * CrawlContext and ContractDataContext are mocked at module level
 * so their providers never make real API calls.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppRoutes from '../src/AppRoutes.js';
import { Outlet } from 'react-router-dom';

// ── Context mocks ──────────────────────────────────────────────────────────
// CrawlContext: Sidebar calls useCrawl(); mock it so no CrawlProvider is needed.
const mockRunRefresh = vi.fn();
vi.mock('../src/contexts/CrawlContext.js', () => ({
  useCrawl: () => ({
    crawlRunning: false,
    crawlElapsed: 0,
    crawlSummary: null,
    crawlError: '',
    runRefresh: mockRunRefresh,
  }),
  CrawlProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ContractDataContext: ContractDataProvider is used as a route element that
// renders <Outlet>. Mock it to do the same without fetching.
vi.mock('../src/contexts/ContractDataContext.js', () => ({
  ContractDataProvider: () => <Outlet />,
  useContractData: () => ({
    entries: [],
    groups: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer', 'reader'], username: 'writer@demo' });
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

const fakeApi = {
  listContracts: vi.fn().mockResolvedValue([]),
  getContract: vi.fn(),
  getRaw: vi.fn(),
  getEntity: vi.fn(),
  listCrawls: vi.fn(),
  refresh: vi.fn(),
  listRequirements: vi.fn().mockResolvedValue([]),
  listExperiments: vi.fn().mockResolvedValue({ experiments: [] }),
  listPromptVersions: vi.fn().mockResolvedValue({ promptVersions: [] }),
  getExperiment: vi.fn(),
  getExperimentArtifact: vi.fn(),
  createPromptVersion: vi.fn(),
  createExperiment: vi.fn(),
  getPromptVersion: vi.fn(),
};

function renderAt(initialPath: string, token = readerToken) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes api={fakeApi as any} token={token} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi.listContracts.mockResolvedValue([]);
  fakeApi.listRequirements.mockResolvedValue([]);
  fakeApi.listExperiments.mockResolvedValue({ experiments: [] });
  fakeApi.listPromptVersions.mockResolvedValue({ promptVersions: [] });
  mockRunRefresh.mockReset();
});

// ── (a) Both area groups and all nav items render ──────────────────────────
describe('shell navigation — nav structure (R-25a)', () => {
  it('renders the Catalog nav group', async () => {
    renderAt('/source/contracts-by-entity');
    expect(
      await screen.findByRole('navigation', { name: /catalog/i })
    ).toBeInTheDocument();
  });

  it('renders the Experiments nav group', async () => {
    renderAt('/source/contracts-by-entity');
    expect(
      await screen.findByRole('navigation', { name: /experiments/i })
    ).toBeInTheDocument();
  });

  it('renders all Catalog nav links', async () => {
    renderAt('/source/contracts-by-entity');
    // Wait for render to settle
    await screen.findByRole('navigation', { name: /catalog/i });
    const sourceNav = screen.getByRole('navigation', { name: /catalog/i });
    expect(within(sourceNav).getByRole('link', { name: /contracts by entity/i })).toBeInTheDocument();
    expect(within(sourceNav).getByRole('link', { name: /contracts by source/i })).toBeInTheDocument();
    expect(within(sourceNav).getByRole('link', { name: /^requirements$/i })).toBeInTheDocument();
  });

  it('renders all Experiments nav links', async () => {
    renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /experiments/i });
    const expNav = screen.getByRole('navigation', { name: /experiments/i });
    expect(within(expNav).getByRole('link', { name: /^prompts$/i })).toBeInTheDocument();
    expect(within(expNav).getByRole('link', { name: /^pipelines$/i })).toBeInTheDocument();
    expect(within(expNav).getByRole('link', { name: /^experiments$/i })).toBeInTheDocument();
    expect(within(expNav).getByRole('link', { name: /^compare$/i })).toBeInTheDocument();
  });
});

// ── (b) aria-current="page" on active link only ───────────────────────────
describe('shell navigation — aria-current=page (R-25b)', () => {
  it('marks only "Contracts by entity" as active at /source/contracts-by-entity', async () => {
    renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });

    const activeLink = screen.getByRole('link', { name: /contracts by entity/i });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    // No other links should carry aria-current=page
    const allLinks = screen.getAllByRole('link');
    const otherActive = allLinks.filter(
      (el) => el !== activeLink && el.getAttribute('aria-current') === 'page'
    );
    expect(otherActive).toHaveLength(0);
  });

  it('marks only "Prompts" as active at /prompts', async () => {
    renderAt('/prompts');
    await screen.findByRole('navigation', { name: /experiments/i });

    const activeLink = screen.getByRole('link', { name: /^prompts$/i });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    const allLinks = screen.getAllByRole('link');
    const otherActive = allLinks.filter(
      (el) => el !== activeLink && el.getAttribute('aria-current') === 'page'
    );
    expect(otherActive).toHaveLength(0);
  });

  it('marks only "Requirements" as active at /source/requirements', async () => {
    renderAt('/source/requirements');
    await screen.findByRole('navigation', { name: /catalog/i });

    const activeLink = screen.getByRole('link', { name: /^requirements$/i });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    const allLinks = screen.getAllByRole('link');
    const otherActive = allLinks.filter(
      (el) => el !== activeLink && el.getAttribute('aria-current') === 'page'
    );
    expect(otherActive).toHaveLength(0);
  });
});

// ── (c) Refresh button is a <button>, not a link ───────────────────────────
describe('shell navigation — Refresh button (R-25c)', () => {
  it('shows Refresh as a button (not a link) for a writer token', async () => {
    renderAt('/source/contracts-by-entity', writerToken);
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i });
    expect(refreshBtn.tagName.toLowerCase()).toBe('button');
  });

  it('clicking Refresh calls the mocked runRefresh function', async () => {
    renderAt('/source/contracts-by-entity', writerToken);
    const refreshBtn = await screen.findByRole('button', { name: /refresh/i });
    await userEvent.click(refreshBtn);
    expect(mockRunRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not show Refresh button for a reader-only token', async () => {
    renderAt('/source/contracts-by-entity', readerToken);
    await screen.findByRole('navigation', { name: /catalog/i });
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });
});

// ── (d) Unknown-route redirect to default ─────────────────────────────────
describe('shell navigation — unknown-route redirect (R-25d)', () => {
  it('mounts at an unknown path without crashing and shows the sidebar', async () => {
    renderAt('/totally/unknown');
    // After redirect, sidebar should be visible (no crash)
    expect(
      await screen.findByRole('navigation', { name: /catalog/i })
    ).toBeInTheDocument();
  });

  it('redirects root path to contracts-by-entity view (sidebar visible)', async () => {
    renderAt('/');
    expect(
      await screen.findByRole('navigation', { name: /catalog/i })
    ).toBeInTheDocument();
  });
});

// ── (e) CSS class structure (T-12a · R-04, R-20, R-21) ───────────────────────
describe('[web] Shell — CSS class structure', () => {
  it('renders a .sidebar element', async () => {
    // GIVEN
    const { container } = renderAt('/source/contracts-by-entity');
    // WHEN the shell mounts
    await screen.findByRole('navigation', { name: /catalog/i });
    // THEN a .sidebar element exists (CSS layout target)
    expect(container.querySelector('.sidebar')).toBeInTheDocument();
  });

  it('renders .sidebar-area with data-area="source"', async () => {
    // GIVEN
    const { container } = renderAt('/source/contracts-by-entity');
    // WHEN the shell mounts
    await screen.findByRole('navigation', { name: /catalog/i });
    // THEN the source area exists with the correct data-area attribute
    expect(container.querySelector('.sidebar-area[data-area="catalog"]')).toBeInTheDocument();
  });

  it('renders .sidebar-area with data-area="experiments"', async () => {
    // GIVEN
    const { container } = renderAt('/source/contracts-by-entity');
    // WHEN the shell mounts
    await screen.findByRole('navigation', { name: /catalog/i });
    // THEN the experiments area exists with the correct data-area attribute
    expect(container.querySelector('.sidebar-area[data-area="experiments"]')).toBeInTheDocument();
  });

  it('renders navigation links inside each sidebar-area', async () => {
    // GIVEN
    const { container } = renderAt('/source/contracts-by-entity');
    // WHEN the shell mounts
    await screen.findByRole('navigation', { name: /catalog/i });
    // THEN each sidebar-area contains at least one Radix NavigationMenu link
    const sourceArea = container.querySelector('.sidebar-area[data-area="catalog"]');
    const experimentsArea = container.querySelector('.sidebar-area[data-area="experiments"]');
    expect(sourceArea).not.toBeNull();
    expect(experimentsArea).not.toBeNull();
    // Radix NavigationMenu.Link with asChild renders data-radix-collection-item on the child element
    expect(sourceArea!.querySelectorAll('[data-radix-collection-item]').length).toBeGreaterThan(0);
    expect(experimentsArea!.querySelectorAll('[data-radix-collection-item]').length).toBeGreaterThan(0);
  });
});

// ── Deep-link routing (Section 7 requirements) ────────────────────────────
describe('shell navigation — deep-linking', () => {
  it('mounting at /prompts renders the Prompts view', async () => {
    renderAt('/prompts');
    // PromptPage renders content with prompts aria-label
    expect(await screen.findByLabelText(/prompts/i)).toBeInTheDocument();
  });

  it('mounting at /source/requirements renders the Requirements view', async () => {
    renderAt('/source/requirements');
    // RequirementsPage renders <div aria-label="requirements">
    expect(await screen.findByLabelText('requirements')).toBeInTheDocument();
  });

  it('mounting at /source/contracts-by-source renders the sidebar navigation', async () => {
    renderAt('/source/contracts-by-source');
    expect(
      await screen.findByRole('navigation', { name: /catalog/i })
    ).toBeInTheDocument();
  });
});

// ── (e–f) Mobile collapse — R-25e, R-25f ─────────────────────────────────
describe('[web] Shell — mobile collapse', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Simulate a 375px mobile viewport (happy-dom ignores this for CSS but
    // the tests verify DOM state and interaction behaviour, not computed styles)
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
    window.dispatchEvent(new Event('resize'));
  });

  // R-25e — hamburger present, sidebar not open by default
  it('hamburger button is present with aria-label="Open navigation" and aria-expanded="false" by default', async () => {
    // GIVEN the shell is mounted at mobile viewport
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });

    // WHEN we inspect the hamburger button
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;

    // THEN it is present with correct ARIA attributes
    expect(hamburger).toBeInTheDocument();
    expect(hamburger).toHaveAttribute('aria-label', 'Open navigation');
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('sidebar does not have the sidebar-open class by default', async () => {
    // GIVEN the shell mounts
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });

    // THEN sidebar is closed (no sidebar-open class)
    expect(container.querySelector('.sidebar')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-open')).not.toBeInTheDocument();
  });

  it('sidebar div has tabIndex=-1 for keyboard accessibility', async () => {
    // GIVEN the shell mounts
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });

    // THEN the sidebar div is focusable programmatically
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    expect(sidebar).toHaveAttribute('tabIndex', '-1');
  });

  it('overlay backdrop is not in the DOM when sidebar is closed', async () => {
    // GIVEN the shell mounts with sidebar closed
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });

    // THEN the backdrop is absent
    expect(container.querySelector('.sidebar-overlay-backdrop')).not.toBeInTheDocument();
  });

  // R-25f — clicking hamburger opens the sidebar overlay
  it('clicking hamburger sets aria-expanded="true" and sidebar gets sidebar-open class', async () => {
    // GIVEN the shell is mounted with sidebar closed
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    // WHEN the user clicks the hamburger
    await userEvent.click(hamburger);

    // THEN aria-expanded is true and sidebar has sidebar-open class
    expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.sidebar-open')).toBeInTheDocument();
  });

  it('overlay backdrop is in the DOM when sidebar is open', async () => {
    // GIVEN the shell mounts and the sidebar is opened
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;

    // WHEN the user opens the sidebar
    await userEvent.click(hamburger);

    // THEN the backdrop is present
    expect(container.querySelector('.sidebar-overlay-backdrop')).toBeInTheDocument();
  });

  it('clicking the overlay backdrop closes the sidebar', async () => {
    // GIVEN the sidebar is open
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    await userEvent.click(hamburger);
    expect(container.querySelector('.sidebar-open')).toBeInTheDocument();

    // WHEN the user clicks the backdrop
    const backdrop = container.querySelector('.sidebar-overlay-backdrop') as HTMLElement;
    await userEvent.click(backdrop);

    // THEN the sidebar closes (sidebar-open class removed, backdrop gone)
    expect(container.querySelector('.sidebar-open')).not.toBeInTheDocument();
    expect(container.querySelector('.sidebar-overlay-backdrop')).not.toBeInTheDocument();
  });

  it('clicking a sidebar nav link closes the overlay', async () => {
    // GIVEN the sidebar is open
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    await userEvent.click(hamburger);
    expect(container.querySelector('.sidebar-open')).toBeInTheDocument();

    // WHEN the user selects a sub-section nav link
    const requirementsLink = screen.getByRole('link', { name: /^requirements$/i });
    await userEvent.click(requirementsLink);

    // THEN the overlay closes (sidebar-open class removed)
    expect(container.querySelector('.sidebar-open')).not.toBeInTheDocument();
  });

  it('pressing Escape while sidebar is open closes the overlay', async () => {
    // GIVEN the sidebar is open and focus is on the sidebar div
    const { container } = renderAt('/source/contracts-by-entity');
    await screen.findByRole('navigation', { name: /catalog/i });
    const hamburger = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    await userEvent.click(hamburger);
    expect(container.querySelector('.sidebar-open')).toBeInTheDocument();

    // WHEN the user presses Escape on the sidebar
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    sidebar.focus();
    await userEvent.keyboard('{Escape}');

    // THEN the overlay closes
    expect(container.querySelector('.sidebar-open')).not.toBeInTheDocument();
  });
});
