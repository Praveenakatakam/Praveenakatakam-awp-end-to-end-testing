/**
 * ComparePage — any two experiments of either kind, per requirement (R-90, T-34).
 *
 * Route: /compare?a=<kind>:<id>&b=<kind>:<id>
 *   - Experiment pickers populated from GET /experiment-index
 *   - Per-requirement table (requirement, status A, status B) from two
 *     GET /experiment-results/{kind}/{id} calls; each row expands to both plans
 *     side by side (PlanView), the plan field diff (PlanDiff) and the test-file
 *     line diff (LineDiffView)
 *   - Requirements only in one experiment (or skipped in one) listed separately
 *   - Pipeline results link to run detail; when both sides are pipeline runs
 *     the expanded row links to the run-level compare (/runs/compare)
 */
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Api } from '../api.js';
import PageHeader from '../components/PageHeader.js';
import type { ExperimentResult, ExperimentResults, SkippedRequirement } from '@registry/core';
import { asPlan } from '../lib.js';
import { useExperimentIndex, useExperimentResults } from '../hooks/usePipelines.js';
import PlanView from '../components/step-output/PlanView.js';
import PlanDiff from '../components/step-output/PlanDiff.js';
import LineDiffView from '../components/LineDiffView.js';
import { KindBadge, experimentRef, parseExperimentRef, statusBadgeClass } from '../components/experiment-ref.js';

type Side = 'A' | 'B';

interface OnlyEntry {
  requirementId: string;
  result: ExperimentResult;
  /** Present when the other experiment skipped this requirement. */
  skippedInOther?: SkippedRequirement;
}

/** Shared / only-in-A / only-in-B split of two experiments' results (R-90). */
export function alignResults(a: ExperimentResults, b: ExperimentResults) {
  const byReq = (rs: ExperimentResult[]) => {
    const m = new Map<string, ExperimentResult>();
    for (const r of rs) if (!m.has(r.requirementId)) m.set(r.requirementId, r);
    return m;
  };
  const mapA = byReq(a.results);
  const mapB = byReq(b.results);
  const skippedA = new Map(a.skipped.map((s) => [s.requirement, s]));
  const skippedB = new Map(b.skipped.map((s) => [s.requirement, s]));

  const shared = [...mapA.keys()].filter((k) => mapB.has(k)).sort()
    .map((requirementId) => ({ requirementId, a: mapA.get(requirementId)!, b: mapB.get(requirementId)! }));
  const only = (mine: Map<string, ExperimentResult>, other: Map<string, ExperimentResult>, otherSkipped: Map<string, SkippedRequirement>): OnlyEntry[] =>
    [...mine.keys()].filter((k) => !other.has(k)).sort()
      .map((requirementId) => ({ requirementId, result: mine.get(requirementId)!, skippedInOther: otherSkipped.get(requirementId) }));
  return { shared, onlyA: only(mapA, mapB, skippedB), onlyB: only(mapB, mapA, skippedA) };
}

function RunLink({ result }: { result: ExperimentResult }) {
  if (!result.runId) return null;
  return (
    <Link to={`/runs/${encodeURIComponent(result.runId)}`} className="mono" style={{ fontSize: 12 }}>
      run {result.runId.slice(0, 8)}…
    </Link>
  );
}

function PlanCell({ side, result, data }: { side: Side; result: ExperimentResult; data: ExperimentResults }) {
  const plan = asPlan(result.plan);
  return (
    <div className="compare-cell card" aria-label={`plan ${side}`}>
      <div className="cluster" style={{ gap: 8, marginBottom: 6 }}>
        <span className="badge badge-accent">{side}</span>
        <KindBadge kind={data.experiment.kind} />
        <span style={{ flex: 1 }}>{data.experiment.label}</span>
        <span className={statusBadgeClass(result.status)}>{result.status.replace(/_/g, ' ')}</span>
      </div>
      <p style={{ marginBottom: 6 }}><RunLink result={result} /></p>
      {plan ? <PlanView plan={plan} /> : <p className="text-muted text-sm">No plan produced.</p>}
    </div>
  );
}

function ExpandedRow({ a, b, dataA, dataB }: { a: ExperimentResult; b: ExperimentResult; dataA: ExperimentResults; dataB: ExperimentResults }) {
  const planA = asPlan(a.plan);
  const planB = asPlan(b.plan);
  return (
    <div style={{ padding: '8px 0' }}>
      <div className="compare-grid">
        <PlanCell side="A" result={a} data={dataA} />
        <PlanCell side="B" result={b} data={dataB} />
      </div>
      {a.runId && b.runId && (
        <p style={{ marginTop: 8 }}>
          <Link to={`/runs/compare?a=${encodeURIComponent(a.runId)}&b=${encodeURIComponent(b.runId)}`}>
            Compare these runs step by step
          </Link>
        </p>
      )}
      <h2 className="section-title">Plan changes</h2>
      {planA && planB ? (
        <PlanDiff before={planA} after={planB} againstLabel={`A · ${dataA.experiment.label}`} />
      ) : (
        <p className="text-muted text-sm">No plan diff — {!planA && !planB ? 'neither side' : !planA ? 'A' : 'B'} has a plan.</p>
      )}
      <h2 className="section-title">Test file diff</h2>
      {a.testFile && b.testFile ? (
        <LineDiffView a={a.testFile.content} b={b.testFile.content} label="test file diff" />
      ) : (
        <p className="text-muted text-sm">No diff — {[!a.testFile && 'A', !b.testFile && 'B'].filter(Boolean).join(' and ')} has no test file.</p>
      )}
    </div>
  );
}

function OnlyList({ side, entries, other }: { side: Side; entries: OnlyEntry[]; other: Side }) {
  return (
    <div className="card compare-cell" aria-label={`only in ${side}`}>
      <p className="card-title">Only in {side} ({entries.length})</p>
      {entries.length === 0 ? (
        <p className="text-muted text-sm">None.</p>
      ) : (
        <ul className="skipped-list">
          {entries.map((e) => (
            <li key={e.requirementId} data-testid={`only-${side}`}>
              <code>{e.requirementId}</code>{' '}
              <span className={statusBadgeClass(e.result.status)}>{e.result.status.replace(/_/g, ' ')}</span>{' '}
              <RunLink result={e.result} />
              <span className="text-muted text-sm">
                {' '}— {e.skippedInOther ? `skipped in ${other}: ${e.skippedInOther.reason}` : `not in ${other}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ComparePage({ api }: { api: Api }) {
  const [params, setParams] = useSearchParams();
  const refA = parseExperimentRef(params.get('a'));
  const refB = parseExperimentRef(params.get('b'));
  const { data: index = [] } = useExperimentIndex(api);
  const resA = useExperimentResults(api, refA?.kind, refA?.id);
  const resB = useExperimentResults(api, refB?.kind, refB?.id);
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedRefs = [refA, refB].filter((r): r is NonNullable<typeof r> => r !== null).map(experimentRef);
  const options = [...new Set([...selectedRefs, ...index.map(experimentRef)])];
  const label = (ref: string) => {
    const e = index.find((x) => experimentRef(x) === ref);
    return e ? `[${e.kind}] ${e.label} · ${e.status} · ${new Date(e.createdAt).toLocaleString()}` : ref;
  };

  function pick(key: 'a' | 'b', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setExpanded(null);
  }

  const dataA = resA.data;
  const dataB = resB.data;
  const aligned = dataA && dataB ? alignResults(dataA, dataB) : null;

  return (
    <div className="app-body" aria-label="compare experiments">
      <div className="app-main">
        <PageHeader
          title="Compare Experiments"
          subtitle="Side-by-side comparison of two experiment runs, per requirement"
        />

        <div className="compare-grid" style={{ marginBottom: 16 }}>
          {(['a', 'b'] as const).map((key) => (
            <div className="form-group" key={key}>
              <label className="form-label" htmlFor={`compare-exp-${key}`}>Experiment {key.toUpperCase()}</label>
              <select id={`compare-exp-${key}`} className="form-select"
                value={(key === 'a' ? refA : refB) ? experimentRef((key === 'a' ? refA : refB)!) : ''}
                onChange={(e) => pick(key, e.target.value)}>
                <option value="">— select experiment —</option>
                {options.map((ref) => <option key={ref} value={ref}>{label(ref)}</option>)}
              </select>
            </div>
          ))}
        </div>

        {(resA.error || resB.error) && (
          <p className="alert alert-danger" role="alert">Failed to load {resA.error ? 'experiment A' : 'experiment B'}.</p>
        )}
        {(resA.isLoading || resB.isLoading) && <p className="loading">Loading…</p>}
        {!refA || !refB ? (
          <p className="text-muted text-sm">Select two experiments to compare them per requirement.</p>
        ) : aligned && dataA && dataB ? (
          <>
            <h2 className="section-title">Shared requirements ({aligned.shared.length})</h2>
            {aligned.shared.length === 0 ? (
              <p className="text-muted text-sm">No requirement appears in both experiments.</p>
            ) : (
              <table className="data-table" aria-label="shared requirements" style={{ tableLayout: 'fixed' }}>
                {/* fixed layout: the expanded row's wide content (plans, diffs) scrolls inside its
                    own boxes instead of stretching the table past the viewport */}
                <colgroup><col style={{ width: '46%' }} /><col style={{ width: '27%' }} /><col style={{ width: '27%' }} /></colgroup>
                <thead>
                  <tr><th>Requirement</th><th>Status A</th><th>Status B</th></tr>
                </thead>
                <tbody>
                  {aligned.shared.map(({ requirementId, a, b }) => {
                    const open = expanded === requirementId;
                    return (
                      <Fragment key={requirementId}>
                        <tr data-testid="shared-row">
                          <td>
                            <button className="btn btn-ghost btn-sm mono" type="button" aria-expanded={open}
                              style={{ whiteSpace: 'normal', textAlign: 'left', overflowWrap: 'anywhere' }}
                              onClick={() => setExpanded(open ? null : requirementId)}>
                              {open ? '▾' : '▸'} {requirementId}
                            </button>
                          </td>
                          <td><span className={statusBadgeClass(a.status)}>{a.status.replace(/_/g, ' ')}</span> <RunLink result={a} /></td>
                          <td><span className={statusBadgeClass(b.status)}>{b.status.replace(/_/g, ' ')}</span> <RunLink result={b} /></td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={3}>
                              <ExpandedRow a={a} b={b} dataA={dataA} dataB={dataB} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div className="compare-grid" style={{ marginTop: 16 }}>
              <OnlyList side="A" entries={aligned.onlyA} other="B" />
              <OnlyList side="B" entries={aligned.onlyB} other="A" />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
