/**
 * ExperimentsHubPage — unified experiment list + detail (R-88, R-91, T-32).
 *
 * Route: /experiments[?selected=<kind>:<id>]
 *   - List of `GET /experiment-index` entries (pipeline + legacy) with a kind
 *     badge, label, created date, status and counts.
 *   - Detail panel (SplitPane side): pipeline → runs (requirement, status, link
 *     to run detail) + skipped; legacy → plans + skips, read-only.
 *   - "New experiment" (writers): pipeline, optional sampling/mode override,
 *     dry run (R-81) → selected count + skipped, explicit confirmation when
 *     more than 20 requirements are selected, then trigger and select it.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import PageHeader from '../components/PageHeader.js';
import type {
  ExecutionMode,
  ExperimentIndexEntry,
  ExperimentKind,
  ExperimentResult,
  GeneratePipelineDryRunResponse,
  SamplingConfig,
} from '@registry/core';
import { asPlan, isWriter } from '../lib.js';
import SplitPane from '../components/SplitPane.js';
import SkippedRequirements from '../components/SkippedRequirements.js';
import PlanView from '../components/step-output/PlanView.js';
import { KindBadge, experimentRef, parseExperimentRef, statusBadgeClass } from '../components/experiment-ref.js';
import {
  useDryRunPipeline,
  useExperimentIndex,
  useExperimentResults,
  usePipelines,
  useTriggerExperiment,
} from '../hooks/usePipelines.js';

/** Above this many selected requirements the trigger needs explicit confirmation (R-88). */
export const CONFIRM_THRESHOLD = 20;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const errorMessage = (err: unknown) =>
  err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message;

// ---------------------------------------------------------------------------
// Sampling override fields
// ---------------------------------------------------------------------------

function SamplingFields({ value, onChange }: { value: SamplingConfig; onChange: (s: SamplingConfig) => void }) {
  return (
    <>
      <select id="ne-sampling" className="form-select" aria-label="Sampling strategy" value={value.strategy}
        onChange={(e) => {
          const s = e.target.value;
          if (s === 'first_n') onChange({ strategy: 'first_n', n: 3 });
          else if (s === 'percentage') onChange({ strategy: 'percentage', percentage: 100 });
          else if (s === 'ids') onChange({ strategy: 'ids', ids: [] });
          else onChange({ strategy: 'all' });
        }}>
        <option value="first_n">First N</option>
        <option value="percentage">Percentage</option>
        <option value="all">All</option>
        <option value="ids">Specific IDs</option>
      </select>
      {value.strategy === 'first_n' && (
        <input className="form-input" style={{ marginTop: 4 }} type="number" min={1} aria-label="N"
          value={value.n} onChange={(e) => onChange({ strategy: 'first_n', n: Number(e.target.value) })} />
      )}
      {value.strategy === 'percentage' && (
        <input className="form-input" style={{ marginTop: 4 }} type="number" min={1} max={100} aria-label="Percentage"
          value={value.percentage} onChange={(e) => onChange({ strategy: 'percentage', percentage: Number(e.target.value) })} />
      )}
      {value.strategy === 'ids' && (
        <textarea className="form-textarea" style={{ marginTop: 4 }} rows={3} aria-label="Requirement IDs"
          placeholder="One source-qualified requirement ID per line (source/R-01)"
          value={value.ids.join('\n')}
          onChange={(e) => onChange({ strategy: 'ids', ids: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// New experiment flow (R-88)
// ---------------------------------------------------------------------------

function NewExperimentForm({
  api,
  onCreated,
  onCancel,
}: {
  api: Api;
  onCreated: (res: { experimentId?: string; runIds: string[] }) => void;
  onCancel: () => void;
}) {
  const { data: pipelinesData } = usePipelines(api);
  const pipelines = (pipelinesData?.pipelines ?? []).filter((p) => p.active);
  const dryRun = useDryRunPipeline(api);
  const trigger = useTriggerExperiment(api);

  const [pipelineId, setPipelineId] = useState('');
  const [overrideSampling, setOverrideSampling] = useState(false);
  const [sampling, setSampling] = useState<SamplingConfig>({ strategy: 'all' });
  const [overrideMode, setOverrideMode] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>('per_requirement');
  const [preview, setPreview] = useState<GeneratePipelineDryRunResponse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const pipeline = pipelines.find((p) => p.pipelineId === pipelineId);
  const effectiveMode = overrideMode ? mode : pipeline?.defaultMode;
  const overrides = {
    ...(overrideSampling ? { sampling } : {}),
    ...(overrideMode ? { mode } : {}),
  };

  /** Any input change invalidates the preview — it must be re-run. */
  function changed<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setPreview(null); setConfirming(false); setError(''); };
  }

  async function handleDryRun() {
    setError('');
    setConfirming(false);
    try {
      setPreview(await dryRun.mutateAsync({ pipelineId, overrides }));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    }
  }

  async function handleTrigger() {
    if (!preview) return;
    if (preview.selected.length > CONFIRM_THRESHOLD && !confirming) {
      setConfirming(true);
      return;
    }
    setError('');
    try {
      const res = await trigger.mutateAsync({ pipelineId, overrides });
      onCreated(res);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const count = preview?.selected.length ?? 0;
  const runCount = effectiveMode === 'batch' ? (count > 0 ? 1 : 0) : count;

  return (
    <div className="card" aria-label="new experiment" style={{ marginBottom: 16 }}>
      <p className="card-title">New experiment</p>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label" htmlFor="ne-pipeline">Pipeline</label>
          <select id="ne-pipeline" className="form-select" value={pipelineId}
            onChange={(e) => changed(setPipelineId)(e.target.value)}>
            <option value="">— select pipeline —</option>
            {pipelines.map((p) => (
              <option key={p.pipelineId} value={p.pipelineId}>{p.name} v{p.version}</option>
            ))}
          </select>
          {pipeline && (
            <p className="text-muted text-sm" style={{ marginTop: 4 }}>
              Defaults: {pipeline.defaultSampling.strategy.replace('_', ' ')} · {pipeline.defaultMode.replace('_', ' ')}
            </p>
          )}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={overrideSampling}
                onChange={(e) => changed(setOverrideSampling)(e.target.checked)} />
              Override sampling
            </label>
            {overrideSampling && <SamplingFields value={sampling} onChange={changed(setSampling)} />}
          </div>
          <div className="form-group">
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={overrideMode}
                onChange={(e) => changed(setOverrideMode)(e.target.checked)} />
              Override mode
            </label>
            {overrideMode && (
              <select className="form-select" aria-label="Mode" value={mode}
                onChange={(e) => changed(setMode)(e.target.value as ExecutionMode)}>
                <option value="per_requirement">Per requirement</option>
                <option value="batch">Batch</option>
              </select>
            )}
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        {preview && (
          <div aria-label="dry run result">
            <p className="alert alert-info" role="status">
              <strong data-testid="selected-count">{count}</strong> requirement{count !== 1 ? 's' : ''} selected
              {count > 0 && ` → ${runCount} run${runCount !== 1 ? 's' : ''}`}
              {preview.skipped.length > 0 && ` · ${preview.skipped.length} skipped`}
            </p>
            <SkippedRequirements skipped={preview.skipped} open={false} />
          </div>
        )}

        {confirming && (
          <p className="alert alert-warning" role="alert">
            This starts {runCount} run{runCount !== 1 ? 's' : ''} over {count} requirements (more than {CONFIRM_THRESHOLD}),
            each making Bedrock calls. Confirm to continue.
          </p>
        )}

        <div className="cluster">
          <button className="btn btn-ghost" type="button" disabled={!pipelineId || dryRun.isPending} onClick={handleDryRun}>
            {dryRun.isPending ? 'Checking…' : 'Dry run'}
          </button>
          {preview && count > 0 && (
            confirming ? (
              <>
                <button className="btn btn-danger" type="button" disabled={trigger.isPending} onClick={handleTrigger}>
                  {trigger.isPending ? 'Starting…' : `Confirm: run ${count} requirements`}
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>Back</button>
              </>
            ) : (
              <button className="btn btn-primary" type="button" disabled={trigger.isPending} onClick={handleTrigger}>
                {trigger.isPending ? 'Starting…' : 'Run experiment'}
              </button>
            )
          )}
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function PipelineResults({ results }: { results: ExperimentResult[] }) {
  if (results.length === 0) return <p className="text-muted text-sm">No runs.</p>;
  return (
    <table className="data-table" aria-label="experiment runs" style={{ width: '100%' }}>
      <thead>
        <tr><th>Requirement</th><th>Status</th><th>Run</th></tr>
      </thead>
      <tbody>
        {results.map((r, i) => (
          <tr key={r.runId ?? i}>
            <td className="mono" style={{ fontSize: 12 }}>{r.requirementId}</td>
            <td><span className={statusBadgeClass(r.status)}>{r.status.replace(/_/g, ' ')}</span></td>
            <td>
              {r.runId ? (
                <Link to={`/runs/${encodeURIComponent(r.runId)}`} className="mono" style={{ fontSize: 12 }}>
                  {r.runId.slice(0, 8)}…
                </Link>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LegacyResults({ results }: { results: ExperimentResult[] }) {
  if (results.length === 0) return <p className="text-muted text-sm">No plans.</p>;
  return (
    <ul className="row-list" aria-label="experiment plans">
      {results.map((r, i) => {
        const plan = asPlan(r.plan);
        return (
          <li key={i}>
            <details>
              <summary style={{ cursor: 'pointer', padding: '6px 0' }}>
                <span className="mono" style={{ fontSize: 12 }}>{r.requirementId}</span>{' '}
                {plan?.title && <span>{plan.title}</span>}{' '}
                <span className={statusBadgeClass(r.status)}>{r.status}</span>
              </summary>
              {plan ? <PlanView plan={plan} /> : r.plan != null ? (
                <pre className="code-block" style={{ height: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.plan, null, 2)}</pre>
              ) : <p className="text-muted text-sm">No plan.</p>}
              {r.testFile && (
                <details style={{ marginTop: 6 }}>
                  <summary className="text-sm" style={{ cursor: 'pointer' }}>Test file · {r.testFile.path}</summary>
                  <pre className="code-block" style={{ height: 'auto', maxHeight: '50vh' }}>{r.testFile.content}</pre>
                </details>
              )}
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function ExperimentDetail({ api, kind, id, onClose }: { api: Api; kind: ExperimentKind; id: string; onClose: () => void }) {
  const { data, isLoading, error } = useExperimentResults(api, kind, id);

  return (
    <div aria-label="experiment detail">
      <div className="cluster" style={{ marginBottom: 8 }}>
        <KindBadge kind={kind} />
        <p className="detail-heading" style={{ marginBottom: 0, flex: 1 }}>{data?.experiment.label ?? id}</p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} aria-label="Close detail">✕</button>
      </div>
      {isLoading && <p className="loading">Loading…</p>}
      {error && <p className="alert alert-danger" role="alert">Failed to load experiment: {(error as Error).message}</p>}
      {data && (
        <>
          <dl className="meta-grid">
            {([
              ['Status', <span key="s" className={statusBadgeClass(data.experiment.status)}>{data.experiment.status.replace(/_/g, ' ')}</span>],
              ['Created', new Date(data.experiment.createdAt).toLocaleString()],
              ['Requirements', String(data.experiment.requirementCount)],
              ['Results', String(data.experiment.resultCount)],
              ['Skipped', String(data.experiment.skipCount)],
              ['ID', <span key="id" className="mono" style={{ fontSize: 12 }}>{id}</span>],
            ] as [string, React.ReactNode][]).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="meta-key">{k}</dt>
                <dd className="meta-val">{v}</dd>
              </div>
            ))}
          </dl>
          <p style={{ margin: '8px 0' }}>
            <Link className="btn btn-ghost btn-sm" to={`/compare?a=${encodeURIComponent(experimentRef({ kind, id }))}`}>
              Compare with…
            </Link>
          </p>
          <h2 className="section-title">{kind === 'pipeline' ? 'Runs' : 'Plans'}</h2>
          {kind === 'pipeline' ? <PipelineResults results={data.results} /> : <LegacyResults results={data.results} />}
          <div style={{ marginTop: 12 }}>
            <SkippedRequirements skipped={data.skipped} open={false} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function IndexRow({ entry, selected, onSelect }: { entry: ExperimentIndexEntry; selected: boolean; onSelect: () => void }) {
  return (
    <button className="exp-row" aria-pressed={selected} onClick={onSelect} data-testid="experiment-row">
      <div className="exp-row-info">
        <div className="cluster" style={{ gap: 8, flexWrap: 'wrap' }}>
          <KindBadge kind={entry.kind} />
          <span className="exp-row-ver">{entry.label}</span>
        </div>
        <div className="exp-row-id" style={{ marginTop: 4 }}>
          {entry.requirementCount} req · {entry.resultCount} result{entry.resultCount !== 1 ? 's' : ''} · {entry.skipCount} skipped
          {' · '}
          <span className="exp-row-time">{new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <span className={statusBadgeClass(entry.status)} style={{ flexShrink: 0 }}>{entry.status.replace(/_/g, ' ')}</span>
    </button>
  );
}

export default function ExperimentsHubPage({ api, token }: { api: Api; token: string }) {
  const writer = isWriter(token);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = parseExperimentRef(params.get('selected'));
  const { data: entries = [], isLoading, error } = useExperimentIndex(api);
  const [panel, setPanel] = useState<'none' | 'new'>('none');

  function select(ref: { kind: ExperimentKind; id: string } | null) {
    const next = new URLSearchParams(params);
    if (ref) next.set('selected', experimentRef(ref)); else next.delete('selected');
    setParams(next, { replace: true });
  }

  return (
    <SplitPane id="experiments" sideLabel="experiment-detail">
      <div aria-label="experiments">
        <PageHeader
          title="Experiments"
          subtitle="Each press of Run is one experiment across the sampled requirements — pipeline and legacy experiments together"
          actions={
            writer ? (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => setPanel('new')}>
                New experiment
              </button>
            ) : undefined
          }
        />

        {writer && panel === 'new' && (
          <NewExperimentForm
            api={api}
            onCancel={() => setPanel('none')}
            onCreated={(res) => {
              setPanel('none');
              if (res.experimentId) select({ kind: 'pipeline', id: res.experimentId });
              else if (res.runIds[0]) navigate(`/runs/${encodeURIComponent(res.runIds[0])}`);
            }}
          />
        )}

        {error && <p className="alert alert-danger" role="alert">Failed to load experiments: {(error as Error).message}</p>}
        {isLoading ? (
          <p className="loading">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted text-sm">No experiments yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} aria-label="experiment list">
            {entries.map((e) => (
              <IndexRow key={experimentRef(e)} entry={e}
                selected={selected?.kind === e.kind && selected.id === e.id}
                onSelect={() => select(selected?.kind === e.kind && selected.id === e.id ? null : e)} />
            ))}
          </div>
        )}
      </div>
      {selected ? (
        <ExperimentDetail key={experimentRef(selected)} api={api} kind={selected.kind} id={selected.id} onClose={() => select(null)} />
      ) : null}
    </SplitPane>
  );
}
