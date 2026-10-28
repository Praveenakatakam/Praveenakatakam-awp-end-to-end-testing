import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CrawlLog } from '../src/CrawlLog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const successSource = {
  label: 'publisher',
  branch: 'main',
  pathPrefix: 'contracts/',
  outcome: 'success',
  discovered: 4,
  valid: 3,
  invalid: 1,
  newVersion: 2,
  unchanged: 2,
};

const failedSource = {
  label: 'consumer',
  branch: 'develop',
  pathPrefix: null,
  outcome: 'failed',
  reason: 'GitHub rate limited',
};

const sourceWithRequirements = {
  ...successSource,
  label: 'publisher-reqs',
  requirements: {
    discovered: 10,
    conforming: 8,
    nonConforming: 2,
    changed: 1,
    removed: 0,
    failed: false,
  },
};

const sourceWithFailedRequirements = {
  ...successSource,
  label: 'publisher-req-fail',
  requirements: {
    failed: true,
    reason: 'parse error',
  },
};

const collision = {
  source: 'publisher',
  id: 'org',
  paths: ['services/publisher/org.yaml', 'services/publisher-v2/org.yaml'],
};

function baseSummary(overrides?: object) {
  return {
    runId: 'run-abc-123',
    startedAt: '2026-10-13T10:00:00.000Z',
    endedAt: '2026-10-13T10:00:05.500Z',
    sources: [successSource],
    collisions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrawlLog (T-02a · R-70)', () => {
  describe('header line', () => {
    it('renders the runId in the header', () => {
      // GIVEN
      const summary = baseSummary();
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).toHaveTextContent('run-abc-123');
    });

    it('renders elapsed time calculated from startedAt and endedAt', () => {
      // GIVEN – 5.5 seconds apart
      const summary = baseSummary();
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).toHaveTextContent('5.5s');
    });

    it('omits the duration segment when startedAt is missing', () => {
      // GIVEN
      const summary = baseSummary({ startedAt: undefined });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const header = screen.getByLabelText('crawl log');
      expect(header).not.toHaveTextContent(/\ds/);
      expect(header).toHaveTextContent('Crawl done');
    });

    it('omits the duration segment when endedAt is missing', () => {
      // GIVEN
      const summary = baseSummary({ endedAt: undefined });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const header = screen.getByLabelText('crawl log');
      expect(header).not.toHaveTextContent(/\ds/);
    });
  });

  describe('source outcome — success', () => {
    it('renders the source label and branch info', () => {
      // GIVEN
      const summary = baseSummary({ sources: [successSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('publisher');
      expect(log).toHaveTextContent('main:contracts/');
    });

    it('renders the success icon for a succeeded source', () => {
      // GIVEN
      const summary = baseSummary({ sources: [successSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN – the summary line starts with ✓ (not ✗)
      const details = screen.getByRole('group');
      const summaryEl = details.querySelector('summary')!;
      expect(summaryEl.textContent).toMatch(/^✓/);
    });

    it('renders discovered / valid / invalid counts for a succeeded source', () => {
      // GIVEN
      const summary = baseSummary({ sources: [successSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('4 discovered');
      expect(log).toHaveTextContent('3 valid');
      expect(log).toHaveTextContent('1 invalid');
    });

    it('renders newVersion and unchanged counts inside the expanded details', () => {
      // GIVEN
      const summary = baseSummary({ sources: [successSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('new versions: 2');
      expect(log).toHaveTextContent('unchanged: 2');
    });
  });

  describe('source outcome — failed', () => {
    it('renders the failure icon for a failed source', () => {
      // GIVEN
      const summary = baseSummary({ sources: [failedSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const details = screen.getByRole('group');
      const summaryEl = details.querySelector('summary')!;
      expect(summaryEl.textContent).toMatch(/^✗/);
    });

    it('renders the failure reason for a failed source', () => {
      // GIVEN
      const summary = baseSummary({ sources: [failedSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).toHaveTextContent('GitHub rate limited');
    });

    it('does not render success stats for a failed source', () => {
      // GIVEN
      const summary = baseSummary({ sources: [failedSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).not.toHaveTextContent('discovered');
    });
  });

  describe('requirement counts', () => {
    it('renders requirement counts when present and not failed', () => {
      // GIVEN
      const summary = baseSummary({ sources: [sourceWithRequirements] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('requirements: 10 discovered');
      expect(log).toHaveTextContent('8 conforming');
      expect(log).toHaveTextContent('2 non-conforming');
      expect(log).toHaveTextContent('1 changed');
      expect(log).toHaveTextContent('0 removed');
    });

    it('renders the requirements-failed warning when requirements.failed is true', () => {
      // GIVEN
      const summary = baseSummary({ sources: [sourceWithFailedRequirements] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).toHaveTextContent('requirements failed: parse error');
    });

    it('does not render a requirements line when source has no requirements', () => {
      // GIVEN – successSource has no requirements key
      const summary = baseSummary({ sources: [successSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).not.toHaveTextContent('requirements:');
    });
  });

  describe('collision details', () => {
    it('renders the collision count and each collision when collisions are present', () => {
      // GIVEN
      const summary = baseSummary({ collisions: [collision] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('1 id collision');
      expect(log).toHaveTextContent('publisher / org');
      expect(log).toHaveTextContent('services/publisher/org.yaml');
      expect(log).toHaveTextContent('services/publisher-v2/org.yaml');
    });

    it('does not render a collisions section when the array is empty', () => {
      // GIVEN
      const summary = baseSummary({ collisions: [] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).not.toHaveTextContent('collision');
    });

    it('does not render a collisions section when collisions is absent', () => {
      // GIVEN
      const { collisions: _omitted, ...summaryWithoutCollisions } = baseSummary();
      // WHEN
      render(<CrawlLog summary={summaryWithoutCollisions} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).not.toHaveTextContent('collision');
    });
  });

  describe('multiple sources', () => {
    it('renders each source as its own details group', () => {
      // GIVEN
      const summary = baseSummary({ sources: [successSource, failedSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      const groups = screen.getAllByRole('group');
      expect(groups).toHaveLength(2);
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('publisher');
      expect(log).toHaveTextContent('consumer');
    });
  });

  describe('empty / null-safe edge cases', () => {
    it('renders without crashing when sources is an empty array', () => {
      // GIVEN
      const summary = baseSummary({ sources: [] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN – header still renders
      expect(screen.getByLabelText('crawl log')).toHaveTextContent('run-abc-123');
    });

    it('renders without crashing when sources is undefined', () => {
      // GIVEN
      const summary = baseSummary({ sources: undefined });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN
      expect(screen.getByLabelText('crawl log')).toBeInTheDocument();
    });

    it('renders the default path separator (/) when pathPrefix is null', () => {
      // GIVEN – failedSource has pathPrefix: null
      const summary = baseSummary({ sources: [failedSource] });
      // WHEN
      render(<CrawlLog summary={summary} />);
      // THEN – shows branch:/ (the null falls back to '/')
      const log = screen.getByLabelText('crawl log');
      expect(log).toHaveTextContent('develop:/');
    });
  });
});
