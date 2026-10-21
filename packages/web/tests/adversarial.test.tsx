/**
 * T-AR-06a..T-AR-10a — adversarial SPA components (adversarial.tsx + App.tsx tab).
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindingDetail, FindingsTable, RunSelector, AdversarialView } from '../src/adversarial.js';
import type { AdversarialFinding, AdversarialRunSummary } from '../src/lib.js';

const f = (overrides: Partial<AdversarialFinding> = {}): AdversarialFinding => ({
  id: 'F-01', severity: 'Critical', target: 'f.ts:1', defect: 'bad thing', failureScenario: 'it breaks', ...overrides,
});

const run: AdversarialRunSummary = {
  reviewKind: 'test', run_dir: '20261021-1430_test_main', startedAt: '2026-10-21T14:30:00Z',
  scope: 'main', verdict: 'PASS', countCritical: 0, countMajor: 0, countMinor: 1, verificationStatus: 'not_run',
};

// ---- FindingDetail (T-AR-07a) ------------------------------------------------

describe('FindingDetail (T-AR-07a)', () => {
  it('renders all required fields', () => {
    render(<FindingDetail finding={f()} />);
    expect(screen.getByText('F-01 — Critical')).toBeInTheDocument();
    expect(screen.getByText('f.ts:1')).toBeInTheDocument();
    expect(screen.getByText('bad thing')).toBeInTheDocument();
    expect(screen.getByText('it breaks')).toBeInTheDocument();
  });

  it('renders evidence and inProductRef when present', () => {
    render(<FindingDetail finding={f({ evidence: 'ev:1', inProductRef: 'BAWP-123' })} />);
    expect(screen.getByText('ev:1')).toBeInTheDocument();
    expect(screen.getByText('BAWP-123')).toBeInTheDocument();
  });

  it('renders verification fields when present', () => {
    render(<FindingDetail finding={f({ verification: { verdict: 'CONFIRMED', reason: 'looks solid', evidence: 'test.ts' } })} />);
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText('looks solid')).toBeInTheDocument();
  });

  it('omits optional fields when absent', () => {
    render(<FindingDetail finding={f()} />);
    expect(screen.queryByText('In-product ref')).not.toBeInTheDocument();
    expect(screen.queryByText('Verification verdict')).not.toBeInTheDocument();
  });

  it('renders inProductRef label only when value present', () => {
    render(<FindingDetail finding={f({ inProductRef: 'REF-1' })} />);
    expect(screen.getByText('In-product ref')).toBeInTheDocument();
  });
});

// ---- FindingsTable (T-AR-08a) ------------------------------------------------

describe('FindingsTable (T-AR-08a)', () => {
  const findings: AdversarialFinding[] = [
    f({ id: 'F-01', severity: 'Critical' }),
    f({ id: 'F-02', severity: 'Major' }),
    f({ id: 'F-03', severity: 'Minor' }),
  ];

  it('renders all findings as rows', () => {
    render(<FindingsTable findings={findings} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    expect(screen.getByText('F-01')).toBeInTheDocument();
    expect(screen.getByText('F-02')).toBeInTheDocument();
    expect(screen.getByText('F-03')).toBeInTheDocument();
  });

  it('filters to Critical only when Critical chip is pressed', async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={findings} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Critical' }));
    expect(screen.getByText('F-01')).toBeInTheDocument();
    expect(screen.queryByText('F-02')).not.toBeInTheDocument();
  });

  it('shows "no findings" message when all filtered out', async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={[f({ id: 'F-01', severity: 'Major' })]} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Critical' }));
    expect(screen.getByText(/no findings match/i)).toBeInTheDocument();
  });

  it('calls onOpenFinding when Detail button is clicked', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FindingsTable findings={[f()]} verificationStatus="not_run" onOpenFinding={onOpen} />);
    await user.click(screen.getAllByRole('button', { name: 'Detail' })[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'F-01' }));
  });

  it('severity filter chips show aria-pressed state', async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={findings} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    const chip = screen.getByRole('button', { name: 'Critical' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await user.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('unverified verdict filter matches findings with no verification when status=ok', async () => {
    const user = userEvent.setup();
    const fs: AdversarialFinding[] = [
      f({ id: 'F-01', severity: 'Critical', verification: { verdict: 'CONFIRMED', reason: 'r' } }),
      f({ id: 'F-02', severity: 'Major' }),
    ];
    render(<FindingsTable findings={fs} verificationStatus="ok" onOpenFinding={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'unverified' }));
    expect(screen.queryByText('F-01')).not.toBeInTheDocument();
    expect(screen.getByText('F-02')).toBeInTheDocument();
  });

  it('renders severity chip labels and verdict chip labels', () => {
    render(<FindingsTable findings={[]} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    ['Critical', 'Major', 'Minor', 'CONFIRMED', 'REFUTED', 'UNCLEAR', 'unverified'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('clicking sort header toggles sort direction (smoke test)', async () => {
    const user = userEvent.setup();
    render(<FindingsTable findings={findings} verificationStatus="not_run" onOpenFinding={vi.fn()} />);
    // Click severity sort twice — should not throw and table should still be visible
    await user.click(screen.getByRole('button', { name: 'Severity' }));
    await user.click(screen.getByRole('button', { name: 'Severity' }));
    expect(screen.getByText('F-01')).toBeInTheDocument();
  });
});

// ---- RunSelector (T-AR-09a) --------------------------------------------------

describe('RunSelector (T-AR-09a)', () => {
  it('renders a placeholder option and the run option', () => {
    render(<RunSelector runs={[run]} selectedRunDir={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Select run' })).toBeInTheDocument();
    expect(screen.getByText(/— select a run —/)).toBeInTheDocument();
    expect(screen.getByText(/main/)).toBeInTheDocument();
  });

  it('calls onSelect with run_dir when changed', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<RunSelector runs={[run]} selectedRunDir={null} onSelect={onSelect} />);
    await user.selectOptions(screen.getByRole('combobox'), run.run_dir);
    expect(onSelect).toHaveBeenCalledWith(run.run_dir);
  });
});

// ---- AdversarialView (T-AR-09a) ----------------------------------------------

const makeApi = (overrides: Partial<ReturnType<typeof createMockApi>> = {}) => ({ ...createMockApi(), ...overrides });

function createMockApi() {
  return {
    listAdversarialRuns: vi.fn().mockResolvedValue([run]),
    getAdversarialFindings: vi.fn().mockResolvedValue({ findings: [f()], verificationStatus: 'not_run' as const }),
  } as any;
}

describe('AdversarialView (T-AR-09a)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('(a) shows loading then run selector after runs load', async () => {
    const api = makeApi();
    render(<AdversarialView api={api} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(api.listAdversarialRuns).toHaveBeenCalledWith('test');
  });

  it('(b) switching to code tab reloads runs with kind=code', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<AdversarialView api={api} />);
    await waitFor(() => screen.getByRole('combobox'));
    await user.click(screen.getByRole('button', { name: 'Code review' }));
    await waitFor(() => expect(api.listAdversarialRuns).toHaveBeenCalledWith('code'));
  });

  it('(c) selecting a run loads findings', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<AdversarialView api={api} />);
    await waitFor(() => screen.getByRole('combobox'));
    await user.selectOptions(screen.getByRole('combobox'), run.run_dir);
    await waitFor(() => expect(screen.getByText('F-01')).toBeInTheDocument());
    expect(api.getAdversarialFindings).toHaveBeenCalledWith('test', run.run_dir);
  });

  it('(d) shows error alert when listAdversarialRuns fails', async () => {
    const api = makeApi({ listAdversarialRuns: vi.fn().mockRejectedValue(new Error('network fail')) });
    render(<AdversarialView api={api} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network fail'));
  });

  it('(e) shows "No runs found" when list is empty', async () => {
    const api = makeApi({ listAdversarialRuns: vi.fn().mockResolvedValue([]) });
    render(<AdversarialView api={api} />);
    await waitFor(() => expect(screen.getByText(/no test review runs found/i)).toBeInTheDocument());
  });

  it('(f) drawer opens on Detail click and closes on X', async () => {
    const api = makeApi();
    const user = userEvent.setup();
    render(<AdversarialView api={api} />);
    await waitFor(() => screen.getByRole('combobox'));
    await user.selectOptions(screen.getByRole('combobox'), run.run_dir);
    await waitFor(() => screen.getByText('F-01'));
    await user.click(screen.getAllByRole('button', { name: 'Detail' })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('(g) shows error when getAdversarialFindings fails', async () => {
    const api = makeApi({ getAdversarialFindings: vi.fn().mockRejectedValue(new Error('s3 fail')) });
    const user = userEvent.setup();
    render(<AdversarialView api={api} />);
    await waitFor(() => screen.getByRole('combobox'));
    await user.selectOptions(screen.getByRole('combobox'), run.run_dir);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('(h) sub-tab buttons have aria-pressed reflecting active kind', async () => {
    const api = makeApi();
    render(<AdversarialView api={api} />);
    await waitFor(() => screen.getByRole('combobox'));
    expect(screen.getByRole('button', { name: 'Test review' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Code review' }).getAttribute('aria-pressed')).toBe('false');
  });
});
