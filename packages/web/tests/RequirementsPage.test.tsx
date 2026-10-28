import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RequirementsPage from '../src/pages/RequirementsPage.js';

// Fixture: two sources, three sections, covering all badge variants.
const requirements = [
  {
    source: 'publisher',
    id: 'R-01',
    text: 'The system SHALL define a contract.',
    section: 'Contract',
    earsType: 'ubiquitous',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: false,
  },
  {
    source: 'publisher',
    id: 'R-10',
    text: 'WHEN a client calls, THE API SHALL respond.',
    section: 'API',
    earsType: 'event',
    modality: 'SHALL',
    earsConforming: true,
    changedInLastCrawl: true, // "changed" badge
  },
  {
    source: 'consumer',
    id: 'R-20',
    text: 'Before returning, the service validates.',
    section: 'Ingest',
    earsType: 'ubiquitous',
    modality: null, // no modality badge
    earsConforming: false, // "non-conforming" badge
    changedInLastCrawl: false,
  },
];

function makeApi(overrides: Partial<{ listRequirements: () => Promise<typeof requirements> }> = {}) {
  return {
    listRequirements: vi.fn().mockResolvedValue(requirements),
    ...overrides,
  } as any;
}

describe('RequirementsPage', () => {
  describe('grouping and identity (R-113)', () => {
    it('renders a heading per source', async () => {
      render(<RequirementsPage api={makeApi()} />);
      expect(await screen.findByRole('heading', { name: 'publisher' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'consumer' })).toBeInTheDocument();
    });

    it('renders a heading per section within each source group', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByRole('heading', { name: 'publisher' });
      // publisher has two sections
      expect(screen.getByRole('heading', { name: 'Contract' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'API' })).toBeInTheDocument();
      // consumer has one section
      expect(screen.getByRole('heading', { name: 'Ingest' })).toBeInTheDocument();
    });

    it('renders each requirement ID', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      expect(screen.getByText('R-10')).toBeInTheDocument();
      expect(screen.getByText('R-20')).toBeInTheDocument();
    });

    it('renders each requirement text', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText(/The system SHALL define a contract/);
      expect(screen.getByText(/WHEN a client calls/)).toBeInTheDocument();
      expect(screen.getByText(/Before returning/)).toBeInTheDocument();
    });
  });

  describe('badges per row (R-113)', () => {
    it('renders the EARS type badge on each row', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      const ubiquitousBadges = screen.getAllByText('ubiquitous');
      expect(ubiquitousBadges.length).toBeGreaterThanOrEqual(2); // R-01 + R-20
      expect(screen.getByText('event')).toBeInTheDocument(); // R-10
    });

    it('renders the modality badge when present', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      const shallBadges = screen.getAllByText('SHALL');
      expect(shallBadges.length).toBeGreaterThanOrEqual(2); // R-01 + R-10 have modality
    });

    it('does not render a modality badge when modality is null', async () => {
      // GIVEN only R-20 has no modality — render a single-item fixture to isolate
      const api = makeApi({
        listRequirements: vi.fn().mockResolvedValue([requirements[2]]),
      });
      render(<RequirementsPage api={api} />);
      await screen.findByText('R-20');
      // No SHALL badge should appear
      expect(screen.queryByText('SHALL')).not.toBeInTheDocument();
    });

    it('renders "non-conforming" badge when earsConforming is false', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-20');
      expect(screen.getByTestId('non-conforming')).toBeInTheDocument();
      expect(screen.getByTestId('non-conforming')).toHaveTextContent('non-conforming');
    });

    it('does not render "non-conforming" badge when earsConforming is true', async () => {
      const api = makeApi({
        listRequirements: vi.fn().mockResolvedValue([requirements[0]]),
      });
      render(<RequirementsPage api={api} />);
      await screen.findByText('R-01');
      expect(screen.queryByTestId('non-conforming')).not.toBeInTheDocument();
    });

    it('renders "changed" badge when changedInLastCrawl is true', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-10');
      expect(screen.getByTestId('changed')).toBeInTheDocument();
      expect(screen.getByTestId('changed')).toHaveTextContent('changed');
    });

    it('does not render "changed" badge when changedInLastCrawl is false', async () => {
      const api = makeApi({
        listRequirements: vi.fn().mockResolvedValue([requirements[0]]),
      });
      render(<RequirementsPage api={api} />);
      await screen.findByText('R-01');
      expect(screen.queryByTestId('changed')).not.toBeInTheDocument();
    });
  });

  describe('detail panel (R-113)', () => {
    it('does not show the detail panel before a row is selected', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      expect(screen.queryByLabelText('requirement-detail')).not.toBeInTheDocument();
    });

    it('opens the detail panel when a requirement row is clicked', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      await userEvent.click(screen.getByRole('button', { name: /R-01/ }));
      expect(screen.getByLabelText('requirement-detail')).toBeInTheDocument();
    });

    it('shows the source / id heading in the detail panel', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-10');
      await userEvent.click(screen.getByRole('button', { name: /R-10/ }));
      const detail = screen.getByLabelText('requirement-detail');
      expect(within(detail).getByRole('heading', { name: /publisher \/ R-10/i })).toBeInTheDocument();
    });

    it('shows the requirement text in the detail panel pre block', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-10');
      await userEvent.click(screen.getByRole('button', { name: /R-10/ }));
      const detail = screen.getByLabelText('requirement-detail');
      const pre = detail.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre!.textContent).toContain('WHEN a client calls');
    });

    it('shows a Popout button in the detail panel', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      await userEvent.click(screen.getByRole('button', { name: /R-01/ }));
      const detail = screen.getByLabelText('requirement-detail');
      expect(within(detail).getByRole('button', { name: /popout/i })).toBeInTheDocument();
    });

    it('pretty-prints JSON requirement text in the detail panel', async () => {
      // GIVEN a requirement whose text is a JSON string
      const jsonText = JSON.stringify({ statement: 'The system SHALL process', timeout: 200 });
      const api = makeApi({
        listRequirements: vi.fn().mockResolvedValue([{
          source: 'publisher', id: 'R-99',
          text: jsonText,
          section: 'API', earsType: 'ubiquitous', modality: 'SHALL',
          earsConforming: true, changedInLastCrawl: false,
        }]),
      });
      render(<RequirementsPage api={api} />);
      await screen.findByText('R-99');
      await userEvent.click(screen.getByRole('button', { name: /R-99/ }));
      const detail = screen.getByLabelText('requirement-detail');
      const pre = detail.querySelector('pre');
      expect(pre).not.toBeNull();
      // Pretty-printed JSON has keys on separate indented lines
      expect(pre!.textContent).toContain('"statement"');
      expect(pre!.textContent).toContain('\n');
    });

    it('replaces the detail panel when a different row is clicked', async () => {
      render(<RequirementsPage api={makeApi()} />);
      await screen.findByText('R-01');
      await userEvent.click(screen.getByRole('button', { name: /R-01/ }));
      expect(screen.getByLabelText('requirement-detail')).toHaveTextContent('R-01');

      await userEvent.click(screen.getByRole('button', { name: /R-10/ }));
      const detail = screen.getByLabelText('requirement-detail');
      expect(within(detail).getByRole('heading', { name: /publisher \/ R-10/i })).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders without error when no requirements are returned', async () => {
      const api = makeApi({
        listRequirements: vi.fn().mockResolvedValue([]),
      });
      render(<RequirementsPage api={api} />);
      // The requirements container should be present and have no list items
      const container = await screen.findByLabelText('requirements');
      expect(container.querySelectorAll('li')).toHaveLength(0);
    });
  });
});
