/**
 * RunsComparePage — two pipeline runs side by side (R-70, T-23).
 *
 * Route: /runs/compare?a=<runId>&b=<runId>
 *   - Run pickers populated from GET /runs (first page)
 *   - Step cards aligned by step index: label, model, prompt key + version,
 *     status, metrics, raw output
 *   - Line diff (LCS, lib.ts) of the two emitted test artifacts when both exist
 */
import { Link, useSearchParams } from 'react-router-dom';
import type { Api } from '../api.js';
import type { PipelineRun, StepRecord } from '@registry/core';
import { usePipelineRun, useRunArtifact, useRunsList } from '../hooks/usePipelines.js';
import LineDiffView from '../components/LineDiffView.js';
import PageHeader from '../components/PageHeader.js';

type RunData = { run: PipelineRun; steps: StepRecord[] };

function inlineOutput(step: StepRecord): string | null {
  return step.outputRef && 'inline' in step.outputRef ? step.outputRef.inline : null;
}

function StepCell({ step }: { step: StepRecord | undefined }) {
  if (!step) return <div className="compare-cell text-muted text-sm">— no step —</div>;
  const output = inlineOutput(step);
  const metrics: [string, string | undefined][] = [
    ['Duration', step.durationMs !== undefined ? `${step.durationMs.toLocaleString()} ms` : undefined],
    ['Input tokens', step.inputTokens?.toLocaleString()],
    ['Output tokens', step.outputTokens?.toLocaleString()],
    ['Cost', step.costEstimateUsd !== undefined ? `$${step.costEstimateUsd.toFixed(6)}` : undefined],
  ];
  return (
    <div className="compare-cell card" data-testid="compare-step">
      <div className="cluster" style={{ gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>{step.label}</span>
        <span className="badge badge-muted">{step.status}</span>
      </div>
      <dl className="meta-grid">
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Model</dt>
          <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{step.model}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Prompt</dt>
          <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {step.promptKey} v{step.promptVersion}
          </dd>
        </div>
        {metrics.filter(([, v]) => v !== undefined).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="meta-key">{k}</dt>
            <dd className="meta-val">{v}</dd>
          </div>
        ))}
      </dl>
      {output !== null ? (
        <details style={{ marginTop: 6 }}>
          <summary className="text-sm" style={{ cursor: 'pointer' }}>Raw output</summary>
          <pre className="code-block" style={{ height: 'auto', maxHeight: '40vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {output}
          </pre>
        </details>
      ) : step.outputRef ? (
        <p className="text-muted text-sm" style={{ marginTop: 6 }}>Output stored in S3</p>
      ) : null}
    </div>
  );
}

function RunHeaderCell({ data, side }: { data: RunData | undefined; side: 'A' | 'B' }) {
  if (!data) return <div className="compare-cell text-muted text-sm">Run {side}: not selected</div>;
  const { run } = data;
  return (
    <div className="compare-cell card" aria-label={`run ${side}`}>
      <div className="cluster" style={{ gap: 8 }}>
        <span className="badge badge-accent">{side}</span>
        <Link to={`/pipelines/${run.pipelineId}/runs/${run.runId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {run.runId}
        </Link>
        <span className="badge badge-muted">{run.status.replace(/_/g, ' ')}</span>
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 4 }}>
        config v{run.pipelineConfigVersion} · {run.mode} · {new Date(run.startedAt).toLocaleString()}
      </p>
    </div>
  );
}

export default function RunsComparePage({ api }: { api: Api }) {
  const [params, setParams] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';

  const { data: runsList } = useRunsList(api);
  const runA = usePipelineRun(api, a);
  const runB = usePipelineRun(api, b);
  const dataA = runA.data as RunData | undefined;
  const dataB = runB.data as RunData | undefined;
  const artA = useRunArtifact(api, a, Boolean(dataA?.run.artifact));
  const artB = useRunArtifact(api, b, Boolean(dataB?.run.artifact));

  const runs = runsList?.items ?? [];
  // Keep the selected ids pickable even when they are not on the first page.
  const options = [...new Set([...(a ? [a] : []), ...(b ? [b] : []), ...runs.map((r) => r.runId)])];
  const label = (id: string) => {
    const r = runs.find((x) => x.runId === id);
    return r ? `${id.slice(0, 8)}… · ${r.status} · ${new Date(r.startedAt).toLocaleString()}` : id;
  };

  function pick(key: 'a' | 'b', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }

  const stepsA = [...(dataA?.steps ?? [])].sort((x, y) => x.stepIndex - y.stepIndex);
  const stepsB = [...(dataB?.steps ?? [])].sort((x, y) => x.stepIndex - y.stepIndex);
  const indices = [...new Set([...stepsA, ...stepsB].map((s) => s.stepIndex))].sort((x, y) => x - y);

  return (
    <div className="app-body" aria-label="compare runs">
      <div className="app-main">
        <PageHeader
          title="Compare Runs"
          subtitle="Side-by-side comparison of two pipeline runs, step by step"
        />

        <div className="compare-grid" style={{ marginBottom: 16 }}>
          {(['a', 'b'] as const).map((key) => (
            <div className="form-group" key={key}>
              <label className="form-label" htmlFor={`compare-${key}`}>Run {key.toUpperCase()}</label>
              <select id={`compare-${key}`} className="form-select" value={key === 'a' ? a : b}
                onChange={(e) => pick(key, e.target.value)}>
                <option value="">— select run —</option>
                {options.map((id) => <option key={id} value={id}>{label(id)}</option>)}
              </select>
            </div>
          ))}
        </div>

        {(runA.error || runB.error) && (
          <p className="alert alert-danger" role="alert">Failed to load {runA.error ? 'run A' : 'run B'}.</p>
        )}

        {(a || b) && (
          <>
            <div className="compare-grid">
              <RunHeaderCell data={dataA} side="A" />
              <RunHeaderCell data={dataB} side="B" />
            </div>

            <h2 className="section-title">Steps</h2>
            {indices.length === 0 && <p className="text-muted text-sm">No steps recorded.</p>}
            {indices.map((idx) => (
              <div className="compare-grid" key={idx} aria-label={`step ${idx}`} style={{ marginBottom: 8 }}>
                <StepCell step={stepsA.find((s) => s.stepIndex === idx)} />
                <StepCell step={stepsB.find((s) => s.stepIndex === idx)} />
              </div>
            ))}

            <h2 className="section-title">Emitted test diff</h2>
            {artA.data && artB.data ? (
              <LineDiffView a={artA.data.content} b={artB.data.content} />
            ) : artA.isLoading || artB.isLoading ? (
              <p className="loading">Loading artifacts…</p>
            ) : (
              <p className="text-muted text-sm">
                {dataA && dataB
                  ? `No diff — ${[!dataA.run.artifact && 'run A', !dataB.run.artifact && 'run B'].filter(Boolean).join(' and ') || 'an artifact'} has no emitted test.`
                  : 'Select two runs to diff their emitted tests.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
