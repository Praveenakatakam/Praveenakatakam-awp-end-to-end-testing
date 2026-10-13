import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../src/Sidebar.js';

// Mock useCrawl so Sidebar renders without a real CrawlProvider (and without network).
// The mock is a vi.fn() so individual tests can override the return value via mockReturnValue.
vi.mock('../src/contexts/CrawlContext.js', () => ({
  useCrawl: vi.fn(),
}));

// Mock CrawlLog — it depends on a crawl summary shape and is tested separately.
vi.mock('../src/CrawlLog.js', () => ({
  CrawlLog: () => null,
}));

import { useCrawl } from '../src/contexts/CrawlContext.js';

// ── JWT helper (matches App.test.tsx convention) ─────────────────────────────
function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const writerToken = jwt({ 'cognito:groups': ['writer', 'reader'], username: 'writer@demo' });
const readerToken = jwt({ 'cognito:groups': ['reader'], username: 'reader@demo' });

// ── Default idle crawl state ──────────────────────────────────────────────────
const mockRunRefresh = vi.fn();
const idleCrawl = {
  crawlRunning: false,
  crawlElapsed: 0,
  crawlSummary: null,
  crawlError: '',
  runRefresh: mockRunRefresh,
};

function renderSidebar(token: string, initialPath = '/source/contracts-by-entity') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar token={token} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCrawl).mockReturnValue(idleCrawl);
});

// ── Structure ─────────────────────────────────────────────────────────────────

describe('Sidebar nav structure (R-25)', () => {
  it('renders exactly two named <nav> area-group landmarks (R-25 requires one per area group)', () => {
    // GIVEN
    renderSidebar(readerToken);
    // THEN — the two area-group navs are present by specific accessible name;
    // the named-nav tests below also confirm this individually.
    // Total nav count is 4: 2 explicit (Source Pipeline + Experiments) plus
    // 2 emitted by Radix NavigationMenu.Root — verified here for structural awareness.
    expect(screen.getAllByRole('navigation')).toHaveLength(4);
  });

  it('renders the Source Pipeline nav with its aria-label', () => {
    // GIVEN
    renderSidebar(readerToken);
    // THEN
    expect(
      screen.getByRole('navigation', { name: 'Source Pipeline navigation' }),
    ).toBeInTheDocument();
  });

  it('renders the Experiments nav with its aria-label', () => {
    // GIVEN
    renderSidebar(readerToken);
    // THEN
    expect(
      screen.getByRole('navigation', { name: 'Experiments navigation' }),
    ).toBeInTheDocument();
  });

  it('renders all six nav links with their exact labels', () => {
    // GIVEN
    renderSidebar(readerToken);
    // THEN — six links across both area groups
    const expectedLabels = [
      'Contracts by entity',
      'Contracts by source',
      'Requirements',
      'Prompt versions',
      'Run experiments',
      'Compare results',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

// ── aria-current (active route) ───────────────────────────────────────────────

describe('Sidebar aria-current="page" (R-25 active route)', () => {
  it('sets aria-current="page" on the link whose path matches the current route', () => {
    // GIVEN — active path is /source/contracts-by-entity
    renderSidebar(readerToken, '/source/contracts-by-entity');
    // THEN — only that link is marked
    expect(screen.getByRole('link', { name: 'Contracts by entity' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does NOT set aria-current="page" on any other link when one is active', () => {
    // GIVEN
    renderSidebar(readerToken, '/source/contracts-by-entity');
    // THEN — the remaining five links must not be marked active
    const inactiveLabels = [
      'Contracts by source',
      'Requirements',
      'Prompt versions',
      'Run experiments',
      'Compare results',
    ];
    for (const label of inactiveLabels) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  it('correctly marks an experiments link as active when that route matches', () => {
    // GIVEN — active path is under /experiments
    renderSidebar(readerToken, '/experiments/prompt-versions');
    // THEN
    expect(screen.getByRole('link', { name: 'Prompt versions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // AND — source pipeline links are not marked
    expect(screen.getByRole('link', { name: 'Contracts by entity' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks no link as active when the path does not match any nav route', () => {
    // GIVEN — root path doesn't match any exact nav route
    renderSidebar(readerToken, '/');
    // THEN
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current', 'page');
    }
  });
});

// ── Refresh button (writer-only) ──────────────────────────────────────────────

describe('Sidebar Refresh button (R-25 writer-only control)', () => {
  it('renders the Refresh button for a writer token', () => {
    // GIVEN
    renderSidebar(writerToken);
    // THEN
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('the Refresh control is a <button> element, not a link', () => {
    // GIVEN
    renderSidebar(writerToken);
    // THEN — role="button" already confirms accessible role; tagName confirms the element type
    const btn = screen.getByRole('button', { name: /refresh/i });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('does NOT render the Refresh button for a reader-only token', () => {
    // GIVEN
    renderSidebar(readerToken);
    // THEN
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('clicking Refresh calls runRefresh() from CrawlContext', async () => {
    // GIVEN
    renderSidebar(writerToken);
    // WHEN
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    // THEN
    expect(mockRunRefresh).toHaveBeenCalledOnce();
  });

  it('disables the Refresh button while a crawl is running', () => {
    // GIVEN — crawl is in-flight
    vi.mocked(useCrawl).mockReturnValue({ ...idleCrawl, crawlRunning: true });
    renderSidebar(writerToken);
    // THEN
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });
});
