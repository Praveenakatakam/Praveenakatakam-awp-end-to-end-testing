/**
 * Adversarial review UI components (T-AR-06..T-AR-09).
 *
 * AdversarialView — top-level tab with test/code sub-tabs.
 * RunSelector     — dropdown of runs; triggers findings load.
 * FindingsTable   — sortable, filterable table of findings.
 * FindingDetail   — drawer showing full finding fields.
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
}

export function AdversarialView({ api }: { api: Api }) {
  const [reviewKind, setReviewKind] = useState<'test' | 'code' | 'requirements'>('test');
  const [runsState, setRunsState] = useState<LoadState>('idle');
  const [runs, setRuns] = useState<AdversarialRunSummary[]>([]);
  const [runsError, setRunsError] = useState('');
  const [selectedRunDir, setSelectedRunDir] = useState<string | null>(null);
  const [findingsState, setFindingsState] = useState<FindingsState>({ state: 'idle', findings: [], verificationStatus: 'not_run' });
  const [drawerFinding, setDrawerFinding] = useState<AdversarialFinding | null>(null);

  // requestId guard: prevents stale responses from overwriting newer state (R-20, R-24)
  const runsRequestId = useRef(0);
  const findingsRequestId = useRef(0);

  useEffect(() => {
    const id = ++runsRequestId.current;
    setRunsState('loading');
    setRuns([]);
    setSelectedRunDir(null);
    setFindingsState({ state: 'idle', findings: [], verificationStatus: 'not_run' });
    api.listAdversarialRuns(reviewKind).then((result) => {
      if (runsRequestId.current !== id) return;
      setRuns(result);
      setRunsState('loaded');
    }).catch((err) => {
      if (runsRequestId.current !== id) return;
      setRunsError((err as Error).message);
      setRunsState('error');
    });
  }, [api, reviewKind]);

  function selectRun(runDir: string) {
    setSelectedRunDir(runDir);
    const id = ++findingsRequestId.current;
    setFindingsState({ state: 'loading', findings: [], verificationStatus: 'not_run' });
    api.getAdversarialFindings(reviewKind, runDir).then((result) => {
      if (findingsRequestId.current !== id) return;
      setFindingsState({ state: 'loaded', findings: result.findings as AdversarialFinding[], verificationStatus: result.verificationStatus });
    }).catch((err) => {
      if (findingsRequestId.current !== id) return;
      setFindingsState({ state: 'error', findings: [], verificationStatus: 'not_run', error: (err as Error).message });
    });
  }

  return (
    <section aria-label="Adversarial review">
      <nav aria-label="review kind">
        <button aria-pressed={reviewKind === 'test'} disabled={reviewKind === 'test'} onClick={() => setReviewKind('test')}>
          Test review
        </button>
        <button aria-pressed={reviewKind === 'code'} disabled={reviewKind === 'code'} onClick={() => setReviewKind('code')}>
          Code review
        </button>
        <button aria-pressed={reviewKind === 'requirements'} disabled={reviewKind === 'requirements'} onClick={() => setReviewKind('requirements')}>
          Requirements review
        </button>
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
        <FindingsTable
          findings={findingsState.findings}
          verificationStatus={findingsState.verificationStatus}
          onOpenFinding={setDrawerFinding}
        />
      )}

      <Drawer finding={drawerFinding} onClose={() => setDrawerFinding(null)} />
    </section>
  );
}
