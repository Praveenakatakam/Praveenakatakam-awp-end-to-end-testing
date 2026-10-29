/**
 * Adversarial review UI components (T-AR-06..T-AR-09).
 *
 * AdversarialView — top-level tab with test/code sub-tabs.
 * RunSelector     — dropdown of runs; triggers findings load.
 * FindingsTable   — sortable, filterable table of findings.
 * FindingDetail   — drawer showing full finding fields.
 *
 * Features: auto-polling for new runs, auto-detection of review.json changes,
 * real-time updates when findings are modified, auto-selection of newest run.
 */
import { useEffect, useRef, useState } from 'react';
import type { Api } from './api.js';
import {
  effectiveVerdict,
  filterFindings,
  formatRunLabel,
  sortFindings,
  type AdversarialFinding,
  type AdversarialRunSummary,
  type VerificationStatus,
} from './lib.js';

// ---- Drawer (T-AR-06) -------------------------------------------------------

function Drawer({ finding, onClose }: { finding: AdversarialFinding | null; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    if (!finding) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [finding, onClose]);

  if (!finding) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Finding detail" style={{ position: 'fixed', inset: 0, display: 'flex', justifyContent: 'flex-end', zIndex: 100 }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.3)' }} aria-hidden="true" />
      <div style={{ width: 480, background: '#fff', overflowY: 'auto', padding: 24 }}>
        <button onClick={onClose} aria-label="Close">✕</button>
        <FindingDetail finding={finding} />
      </div>
    </div>
  );
}

// ---- FindingDetail (T-AR-07) ------------------------------------------------

export function FindingDetail({ finding }: { finding: AdversarialFinding }) {
  return (
    <article>
      <h3>{finding.id} — {finding.severity}</h3>
      <dl>
        <dt>Target</dt><dd>{finding.target}</dd>
        <dt>Defect</dt><dd>{finding.defect}</dd>
        <dt>Failure scenario</dt><dd>{finding.failureScenario}</dd>
        {finding.evidence && <><dt>Evidence</dt><dd>{finding.evidence}</dd></>}
        {finding.inProductRef && <><dt>In-product ref</dt><dd>{finding.inProductRef}</dd></>}
        {finding.verification && (
          <>
            <dt>Verification verdict</dt><dd>{finding.verification.verdict}</dd>
            <dt>Verification reason</dt><dd>{finding.verification.reason}</dd>
            {finding.verification.evidence && <><dt>Verification evidence</dt><dd>{finding.verification.evidence}</dd></>}
          </>
        )}
      </dl>
    </article>
  );
}

// ---- FindingRow + FindingsTable (T-AR-08) ------------------------------------

const SEVERITY_CHIP_LABELS = ['Critical', 'Major', 'Minor'];
const VERDICT_CHIP_LABELS = ['CONFIRMED', 'REFUTED', 'UNCLEAR', 'unverified'];

type SortCol = 'severity' | 'id' | 'target';

function FindingRow({
  finding,
  verificationStatus,
  onOpen,
}: {
  finding: AdversarialFinding;
  verificationStatus: VerificationStatus;
  onOpen: () => void;
}) {
  const ev = effectiveVerdict(finding, verificationStatus);
  return (
    <tr>
      <td>{finding.id}</td>
      <td>{finding.severity}</td>
      <td>{finding.target}</td>
      <td>{finding.defect}</td>
      <td>{ev}</td>
      <td><button onClick={onOpen}>Detail</button></td>
    </tr>
  );
}

export function FindingsTable({
  findings,
  verificationStatus,
  onOpenFinding,
}: {
  findings: AdversarialFinding[];
  verificationStatus: VerificationStatus;
  onOpenFinding: (f: AdversarialFinding) => void;
}) {
  const [severityFilters, setSeverityFilters] = useState(new Set<string>());
  const [verdictFilters, setVerdictFilters] = useState(new Set<string>());
  const [sortCol, setSortCol] = useState<SortCol>('severity');
  const [sortAsc, setSortAsc] = useState(false);

  function toggleChip(set: Set<string>, value: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setter(next);
  }

  const filtered = filterFindings(findings, severityFilters, verdictFilters, verificationStatus);
  const sorted = sortFindings(filtered, sortCol, sortAsc);

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(col !== 'severity'); }
  }

  return (
    <div>
      <div aria-label="severity filters">
        {SEVERITY_CHIP_LABELS.map((s) => (
          <button
            key={s}
            aria-pressed={severityFilters.has(s)}
            onClick={() => toggleChip(severityFilters, s, setSeverityFilters)}
          >
            {s}
          </button>
        ))}
      </div>
      <div aria-label="verdict filters">
        {VERDICT_CHIP_LABELS.map((v) => (
          <button
            key={v}
            aria-pressed={verdictFilters.has(v)}
            onClick={() => toggleChip(verdictFilters, v, setVerdictFilters)}
          >
            {v}
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th><button onClick={() => handleSort('id')}>ID</button></th>
            <th><button onClick={() => handleSort('severity')}>Severity</button></th>
            <th><button onClick={() => handleSort('target')}>Target</button></th>
            <th>Defect</th>
            <th>Verdict</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((f) => (
            <FindingRow key={f.id} finding={f} verificationStatus={verificationStatus} onOpen={() => onOpenFinding(f)} />
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <p>No findings match the current filters.</p>}
    </div>
  );
}

// ---- RunSelector (T-AR-09) --------------------------------------------------

export function RunSelector({
  runs,
  selectedRunDir,
  onSelect,
}: {
  runs: AdversarialRunSummary[];
  selectedRunDir: string | null;
  onSelect: (runDir: string) => void;
}) {
  return (
    <select
      aria-label="Select run"
      value={selectedRunDir ?? ''}
      onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
    >
      <option value="">— select a run —</option>
      {runs.map((r) => (
        <option key={r.run_dir} value={r.run_dir}>
          {formatRunLabel(r)} ({r.verdict})
        </option>
      ))}
    </select>
  );
}

// ---- AdversarialView (T-AR-09) ----------------------------------------------

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface FindingsState {
  state: LoadState;
  findings: AdversarialFinding[];
  verificationStatus: VerificationStatus;
  error?: string;
  lastFetchedAt?: number; // timestamp to detect changes
}

// Polling configuration
const POLL_RUNS_INTERVAL_MS = 5000; // poll for new runs every 5 seconds
const POLL_FINDINGS_INTERVAL_MS = 3000; // poll for findings updates every 3 seconds

export function AdversarialView({ api }: { api: Api }) {
  const [reviewKind, setReviewKind] = useState<'test' | 'code' | 'requirements'>('test');
  const [runsState, setRunsState] = useState<LoadState>('idle');
  const [runs, setRuns] = useState<AdversarialRunSummary[]>([]);
  const [runsError, setRunsError] = useState('');
  const [selectedRunDir, setSelectedRunDir] = useState<string | null>(null);
  const [findingsState, setFindingsState] = useState<FindingsState>({ state: 'idle', findings: [], verificationStatus: 'not_run' });
  const [drawerFinding, setDrawerFinding] = useState<AdversarialFinding | null>(null);
  const [autoPollingEnabled, setAutoPollingEnabled] = useState(true);
  const [lastRunsChecksum, setLastRunsChecksum] = useState<string | null>(null); // detect run list changes

  // requestId guard: prevents stale responses from overwriting newer state (R-20, R-24)
  const runsRequestId = useRef(0);
  const findingsRequestId = useRef(0);

  // polling timers
  const runsPollTimer = useRef<NodeJS.Timeout | null>(null);
  const findingsPollTimer = useRef<NodeJS.Timeout | null>(null);

  // Load runs and set up auto-polling
  useEffect(() => {
    const loadRuns = async () => {
      const id = ++runsRequestId.current;
      try {
        const result = await api.listAdversarialRuns(reviewKind);
        if (runsRequestId.current !== id) return;

        // Detect if run list changed by comparing checksums
        const checksum = JSON.stringify(result.map(r => `${r.run_dir}:${r.verdict}`)).slice(0, 50);
        const hasNewRuns = checksum !== lastRunsChecksum;
        setLastRunsChecksum(checksum);

        setRuns(result);
        setRunsError('');
        setRunsState('loaded');

        // Auto-select newest run on first load or when new runs appear
        if (selectedRunDir === null && result.length > 0) {
          selectRun(result[0]!.run_dir);
        } else if (hasNewRuns && selectedRunDir === null && result.length > 0) {
          selectRun(result[0]!.run_dir);
        }
      } catch (err) {
        if (runsRequestId.current !== id) return;
        setRunsError((err as Error).message);
        setRunsState('error');
      }
    };

    if (runsState === 'idle' || runsState === 'loaded') {
      // Initial load
      setRunsState(runsState === 'idle' ? 'loading' : 'loaded');
      loadRuns();

      // Set up auto-polling if enabled
      if (autoPollingEnabled) {
        if (runsPollTimer.current) clearInterval(runsPollTimer.current);
        runsPollTimer.current = setInterval(() => {
          loadRuns();
        }, POLL_RUNS_INTERVAL_MS);

        return () => {
          if (runsPollTimer.current) clearInterval(runsPollTimer.current);
        };
      }
    }

    return () => {
      if (runsPollTimer.current) clearInterval(runsPollTimer.current);
    };
  }, [api, reviewKind, autoPollingEnabled]);

  function selectRun(runDir: string) {
    setSelectedRunDir(runDir);
    setDrawerFinding(null); // close drawer when switching runs (R-33)
    const id = ++findingsRequestId.current;
    setFindingsState({ state: 'loading', findings: [], verificationStatus: 'not_run' });
    api.getAdversarialFindings(reviewKind, runDir).then((result) => {
      if (findingsRequestId.current !== id) return;
      setFindingsState({
        state: 'loaded',
        findings: result.findings as AdversarialFinding[],
        verificationStatus: result.verificationStatus,
        lastFetchedAt: Date.now(),
      });
    }).catch((err) => {
      if (findingsRequestId.current !== id) return;
      setFindingsState({ state: 'error', findings: [], verificationStatus: 'not_run', error: (err as Error).message });
    });
  }

  // Auto-poll findings for changes when a run is selected
  useEffect(() => {
    if (!selectedRunDir || !autoPollingEnabled) {
      if (findingsPollTimer.current) clearInterval(findingsPollTimer.current);
      return;
    }

    const pollFindings = () => {
      const id = ++findingsRequestId.current;
      api.getAdversarialFindings(reviewKind, selectedRunDir).then((result) => {
        if (findingsRequestId.current !== id) return;

        // Check if findings have changed
        const newChecksum = JSON.stringify(result.findings.map(f => f.id)).slice(0, 100);
        const oldChecksum = JSON.stringify(findingsState.findings.map(f => f.id)).slice(0, 100);

        if (newChecksum !== oldChecksum || result.verificationStatus !== findingsState.verificationStatus) {
          setFindingsState({
            state: 'loaded',
            findings: result.findings as AdversarialFinding[],
            verificationStatus: result.verificationStatus,
            lastFetchedAt: Date.now(),
          });
        }
      }).catch((err) => {
        // Don't update error state on polling failures, just log
        console.warn('Polling findings failed:', err);
      });
    };

    // Poll immediately after selection and then at regular intervals
    const timer = setInterval(pollFindings, POLL_FINDINGS_INTERVAL_MS);

    return () => {
      if (findingsPollTimer.current) clearInterval(findingsPollTimer.current);
      clearInterval(timer);
    };
  }, [selectedRunDir, reviewKind, autoPollingEnabled, api]);

  return (
    <section aria-label="Adversarial review">
      <nav aria-label="review kind" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <button aria-pressed={reviewKind === 'test'} disabled={reviewKind === 'test'} onClick={() => setReviewKind('test')}>
            Test review
          </button>
          <button aria-pressed={reviewKind === 'code'} disabled={reviewKind === 'code'} onClick={() => setReviewKind('code')}>
            Code review
          </button>
          <button aria-pressed={reviewKind === 'requirements'} disabled={reviewKind === 'requirements'} onClick={() => setReviewKind('requirements')}>
            Requirements review
          </button>
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={autoPollingEnabled}
            onChange={(e) => setAutoPollingEnabled(e.target.checked)}
            aria-label="Auto-polling enabled"
          />
          Auto-polling {autoPollingEnabled ? '🔄' : '⏸️'}
        </label>
      </nav>

      {runsState === 'loading' && <p role="status">Loading runs…</p>}
      {runsState === 'error' && <p role="alert">Failed to load runs: {runsError}</p>}
      {runsState === 'loaded' && runs.length === 0 && <p>No {reviewKind} review runs found.</p>}
      {runsState === 'loaded' && runs.length > 0 && (
        <RunSelector runs={runs} selectedRunDir={selectedRunDir} onSelect={selectRun} />
      )}

      {findingsState.state === 'loading' && <p role="status">Loading findings…</p>}
      {findingsState.state === 'error' && <p role="alert">Failed to load findings: {findingsState.error}</p>}
      {findingsState.state === 'loaded' && (
        <>
          {findingsState.lastFetchedAt && (
            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
              Last updated: {new Date(findingsState.lastFetchedAt).toLocaleTimeString()} {autoPollingEnabled && '🔄'}
            </p>
          )}
          <FindingsTable
            findings={findingsState.findings}
            verificationStatus={findingsState.verificationStatus}
            onOpenFinding={setDrawerFinding}
          />
        </>
      )}

      <Drawer finding={drawerFinding} onClose={() => setDrawerFinding(null)} />
    </section>
  );
}
