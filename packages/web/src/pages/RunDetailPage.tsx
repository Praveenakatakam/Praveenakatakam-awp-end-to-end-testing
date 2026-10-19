/**
 * RunDetailPage — visual step flow for a pipeline run.
 *
 * Route: /pipelines/:pipelineId/runs/:runId (also /runs/:runId)
 *
 * Features:
 *   - Polls GET /runs/{runId} every 2 s while run is non-terminal (R-54, TS-38)
 *   - Run header: runId, status badge, startedAt, sampling config summary
 *   - Ordered step cards with status badges and expandable detail panels
 *   - Warnings section when run.warnings is non-empty
 *   - Error section when run is failed
 *   - Loading skeleton on initial fetch
 *   - Skipped requirements from the run trigger (router state, R-71)
 *   - Emitted test artifact with Copy / Download when run.artifact is set (R-65, R-71)
 *
 *   - Step header: label, model, output type, prompt key@version, status,
 *     cached indicator (R-76)
 *   - Expanded step: errors, then Output / Input / Changes / Raw / Metrics tabs
 *     backed by GET /runs/{runId}/steps/{stepIndex} (R-75, R-77)
 *
 * Requirements: R-54, R-71, R-76, R-77
 */
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { Api } from '../api.js';
import type {
  PipelineRun,
  StepRecord,
  PipelineRunStatus,
  StepStatus,
  SamplingConfig,
  StepOutputType,
} from '@registry/core';
import { usePipeline, usePipelineRun, useRunArtifact, useRunStep } from '../hooks/usePipelines.js';
import { parsePlan } from '../lib.js';
import { outputTypeOf } from '../components/StepEditor.js';
import StepOutputView, { RawText } from '../components/step-output/StepOutputView.js';
import StepInputView from '../components/step-output/StepInputView.js';
import PlanDiff from '../components/step-output/PlanDiff.js';
import SkippedRequirements, { type RunNavState } from '../components/SkippedRequirements.js';

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function runStatusBadgeClass(status: PipelineRunStatus): string {
  switch (status) {
    case 'completed':               return 'badge badge-success';
    case 'completed_with_warnings': return 'badge badge-warning';
    case 'running':                 return 'badge badge-accent badge-pulse';
    case 'failed':                  return 'badge badge-danger';
    case 'timed_out':               return 'badge badge-muted';
  }
}

function stepStatusBadgeClass(status: StepStatus): string {
  switch (status) {
    case 'completed': return 'badge badge-success';
    case 'cached':    return 'badge badge-accent';
    case 'running':   return 'badge badge-accent badge-pulse';
    case 'warning':   return 'badge badge-warning';
    case 'failed':    return 'badge badge-danger';
  }
}

// ---------------------------------------------------------------------------
// Sampling config summary (compact single-line description)
// ---------------------------------------------------------------------------

function formatSampling(sampling: SamplingConfig): string {
  switch (sampling.strategy) {
    case 'first_n':    return `first_n · n=${sampling.n}`;
    case 'percentage': return `percentage · ${sampling.percentage}%`;
    case 'ids':        return `ids · ${sampling.ids.length} requirement${sampling.ids.length !== 1 ? 's' : ''}`;
    case 'all':        return 'all requirements';
  }
}

// ---------------------------------------------------------------------------
// Output ref helpers
// ---------------------------------------------------------------------------

function getInlineOutput(step: StepRecord): string | null {
  if (!step.outputRef) return null;
  if ('inline' in step.outputRef) return step.outputRef.inline;
  return null;
}

function isS3Output(step: StepRecord): boolean {
  if (!step.outputRef) return false;
  return 's3Key' in step.outputRef;
}

const stepNo = (step: StepRecord) => `STEP #${String(step.stepIndex).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Step metrics (R-51, R-77 Metrics tab)
// ---------------------------------------------------------------------------

function StepMetrics({ step }: { step: StepRecord }) {
  const rows: [string, string][] = [];
  if (step.durationMs !== undefined) rows.push(['Duration', `${step.durationMs.toLocaleString()} ms`]);
  if (step.bedrockLatencyMs !== undefined) rows.push(['Bedrock latency', `${step.bedrockLatencyMs.toLocaleString()} ms`]);
  if (step.inputTokens !== undefined) rows.push(['Input tokens', step.inputTokens.toLocaleString()]);
  if (step.outputTokens !== undefined) rows.push(['Output tokens', step.outputTokens.toLocaleString()]);
  if (step.inputCharacters !== undefined) rows.push(['Input chars', step.inputCharacters.toLocaleString()]);
  if (step.outputCharacters !== undefined) rows.push(['Output chars', step.outputCharacters.toLocaleString()]);
  if (step.contextTokenEstimate !== undefined) rows.push(['Context tokens (est.)', step.contextTokenEstimate.toLocaleString()]);
  if (step.costEstimateUsd !== undefined) rows.push(['Cost estimate', `$${step.costEstimateUsd.toFixed(6)}`]);
  if (step.priorOutputsTruncated !== undefined) rows.push(['Prior outputs truncated', step.priorOutputsTruncated ? 'yes' : 'no']);
  if (step.cacheKey) rows.push(['Cache key', step.cacheKey]);

  if (rows.length === 0) return <p className="text-muted text-sm">No metrics recorded.</p>;
  return (
    <dl className="meta-grid" aria-label="step metrics">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt className="meta-key">{k}</dt>
          <dd className="meta-val">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepError({ step }: { step: StepRecord }) {
  if (!(step.status === 'failed' || step.status === 'warning') || !step.errorMessage) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <p className="section-heading" style={{ marginTop: 0, color: 'var(--danger)' }}>Error</p>
      <p className="alert alert-danger" role="alert" style={{ marginBottom: 0 }}>{step.errorMessage}</p>
      {step.errorStack && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 0' }}>
            Stack trace
          </summary>
          <pre className="code-block code-block-auto" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {step.errorStack}
          </pre>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Changes tab — diff against the previous completed plan step (R-77)
// ---------------------------------------------------------------------------

function ChangesPanel({ api, runId, prior, output }: {
  api: Api;
  runId: string;
  prior: StepRecord;
  output: string | null;
}) {
  const { data, isLoading, error } = useRunStep(api, runId, prior.stepIndex, true);
  if (isLoading) return <p className="loading">Loading earlier plan…</p>;
  const priorOutput = data?.output ?? getInlineOutput(prior);
  if (error && priorOutput === null) {
    return <p className="alert alert-danger" role="alert">Failed to load the earlier plan step.</p>;
  }
  const before = parsePlan(priorOutput);
  const after = parsePlan(output);
  if (!before || !after) {
    return (
      <p className="alert alert-warning" role="note">
        Cannot diff — {!after ? 'this step’s' : 'the earlier step’s'} output is not a parseable plan.
      </p>
    );
  }
  return <PlanDiff before={before} after={after} againstLabel={`${stepNo(prior)} · ${prior.label}`} />;
}

// ---------------------------------------------------------------------------
// StepCard — one expandable card per step record (R-76, R-77)
// ---------------------------------------------------------------------------

type StepTab = 'output' | 'input' | 'changes' | 'raw' | 'metrics';

interface StepCardProps {
  api: Api;
  runId: string;
  step: StepRecord;
  /** From the pipeline config by `stepId`; `undefined` when the step is not in the loaded config. */
  configOutputType?: StepOutputType;
  /** Latest earlier completed/cached plan step in this run — enables the Changes tab. */
  priorPlanStep?: StepRecord;
}

function StepCard({ api, runId, step, configOutputType, priorPlanStep }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<StepTab>('output');
  const detail = useRunStep(api, runId, step.stepIndex, expanded);

  const inline = getInlineOutput(step);
  const hasOutput = inline !== null || isS3Output(step);
  const isTerminal =
    step.status === 'completed' || step.status === 'cached' ||
    step.status === 'failed'    || step.status === 'warning';

  // The input snapshot records the type actually used; the pipeline config may
  // have been edited since the run, so prefer the snapshot once loaded.
  const outputType: StepOutputType | undefined = detail.data?.input?.outputType ?? configOutputType;
  const effectiveType: StepOutputType = outputType ?? 'plan';
  const output = detail.data ? detail.data.output : inline;
  const showChanges = effectiveType === 'plan' && priorPlanStep !== undefined;
  const activeTab: StepTab = tab === 'changes' && !showChanges ? 'output' : tab;

  const tabs: { id: StepTab; label: string }[] = [
    { id: 'output', label: 'Output' },
    { id: 'input', label: 'Input' },
    ...(showChanges ? [{ id: 'changes' as const, label: 'Changes' }] : []),
    { id: 'raw', label: 'Raw' },
    { id: 'metrics', label: 'Metrics' },
  ];

  return (
    <div className="card" style={{ marginBottom: 8 }} data-testid={`step-card-${step.stepIndex}`}>
      {/* Header row — always visible (R-76) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)',
            minWidth: 52,
          }}
        >
          {stepNo(step)}
        </span>

        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
          {step.label}
        </span>

        <div className="step-header-meta">
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {step.model}
          </span>
          {outputType && (
            <span className="badge badge-muted" title="Output type" data-testid="step-output-type">{outputType}</span>
          )}
          <Link
            className="step-prompt-link"
            to={`/prompts/${encodeURIComponent(step.promptKey)}`}
            title="Prompt version used by this step"
          >
            {step.promptKey}@v{step.promptVersion}
          </Link>
          <span className={stepStatusBadgeClass(step.status)}>{step.status}</span>
          {step.status === 'cached' && (
            <span className="text-muted text-sm" title="Output reused from the step cache — no model call">
              from cache
            </span>
          )}
        </div>

        {isTerminal && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse step detail' : 'Expand step detail'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {/* Output preview — compact, always visible for completed/cached */}
      {(step.status === 'completed' || step.status === 'cached') && hasOutput && !expanded && (
        <div style={{ marginTop: 8 }}>
          {inline !== null ? (
            <p
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
                overflow: 'hidden',
                maxHeight: '4.5em',
              }}
            >
              {inline.slice(0, 500)}{inline.length > 500 ? '…' : ''}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Output stored in S3 — expand to view.</p>
          )}
        </div>
      )}

      {/* Expanded detail panel (R-77) */}
      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <StepError step={step} />

          <div className="tabs" role="tablist" aria-label="step detail">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`tab ${activeTab === t.id ? 'tab-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="step-tab-panel" role="tabpanel">
            {activeTab === 'metrics' ? (
              <StepMetrics step={step} />
            ) : detail.isLoading ? (
              <p className="loading">Loading step detail…</p>
            ) : detail.error && !(activeTab !== 'input' && inline !== null) ? (
              <p className="alert alert-danger" role="alert">
                Failed to load step detail{detail.error instanceof Error ? ` (${detail.error.message})` : ''}.
              </p>
            ) : activeTab === 'output' ? (
              <StepOutputView outputType={effectiveType} output={output} />
            ) : activeTab === 'input' ? (
              <StepInputView input={detail.data?.input ?? null} />
            ) : activeTab === 'changes' && priorPlanStep ? (
              <ChangesPanel api={api} runId={runId} prior={priorPlanStep} output={output} />
            ) : output === null ? (
              <p className="text-muted text-sm">This step produced no output.</p>
            ) : (
              <RawText text={output} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  const shimmer = {
    background: 'var(--surface-raised)',
    borderRadius: 4,
  } as const;

  return (
    <div className="app-main">
      <div style={{ maxWidth: 820 }}>
        {/* Header card skeleton */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ ...shimmer, height: 16, flex: 1 }} />
            <div style={{ ...shimmer, height: 18, width: 72, borderRadius: 999 }} />
          </div>
          <div style={{ ...shimmer, height: 11, width: '55%', marginBottom: 6 }} />
          <div style={{ ...shimmer, height: 11, width: '40%' }} />
        </div>
        {/* Step skeletons */}
        {([0, 1, 2] as const).map((i) => (
          <div key={i} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ ...shimmer, height: 11, width: 52 }} />
              <div style={{ ...shimmer, height: 13, flex: 1 }} />
              <div style={{ ...shimmer, height: 18, width: 72, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunHeader — run-level metadata and status
// ---------------------------------------------------------------------------

function RunHeader({ run }: { run: PipelineRun }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {/* Title row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <p className="detail-heading" style={{ marginBottom: 0, flex: 1 }}>
          Pipeline Run
        </p>
        <span className={runStatusBadgeClass(run.status)}>
          {run.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Meta grid */}
      <dl className="meta-grid">
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Run ID</dt>
          <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {run.runId}
          </dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Started</dt>
          <dd className="meta-val">{new Date(run.startedAt).toLocaleString()}</dd>
        </div>
        {run.completedAt && (
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Completed</dt>
            <dd className="meta-val">{new Date(run.completedAt).toLocaleString()}</dd>
          </div>
        )}
        {run.failedAt && (
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Failed at</dt>
            <dd className="meta-val">{new Date(run.failedAt).toLocaleString()}</dd>
          </div>
        )}
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Pipeline ID</dt>
          <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {run.pipelineId}
          </dd>
        </div>
        {run.experimentId && (
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Experiment</dt>
            <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <Link to={`/experiments?selected=pipeline:${encodeURIComponent(run.experimentId)}`}>{run.experimentId}</Link>
            </dd>
          </div>
        )}
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Config version</dt>
          <dd className="meta-val">v{run.pipelineConfigVersion}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Sampling</dt>
          <dd className="meta-val">{formatSampling(run.sampling)}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Mode</dt>
          <dd className="meta-val">{run.mode}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Requirements</dt>
          <dd className="meta-val">{run.requirementIds.length} selected</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Steps executed</dt>
          <dd className="meta-val">{run.executedSteps}</dd>
        </div>
      </dl>

      {/* In-progress notice */}
      {run.status === 'running' && (
        <p
          className="alert alert-info"
          role="status"
          aria-live="polite"
          style={{ marginTop: 12, marginBottom: 0 }}
        >
          Run in progress — polling every 2 s
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactView — the emitted test file (R-65, R-71)
// ---------------------------------------------------------------------------

function ArtifactView({ api, run }: { api: Api; run: PipelineRun }) {
  const { data, isLoading, error } = useRunArtifact(api, run.runId, Boolean(run.artifact));
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  if (!run.artifact) return null;

  const path = data?.path ?? run.artifact.path;
  const fileName = path.split('/').pop() || 'test.generated.ts';

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.content);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  }

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="card" style={{ marginBottom: 16 }} aria-label="emitted test">
      <div className="cluster" style={{ marginBottom: 8, gap: 8 }}>
        <p className="card-title" style={{ marginBottom: 0, flex: 1 }}>Emitted test</p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={copy} disabled={!data}>
          {copied === 'copied' ? 'Copied' : 'Copy'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={download} disabled={!data}>
          Download
        </button>
      </div>
      <p className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)', marginBottom: 6 }}>{path}</p>
      {copied === 'failed' && <p className="form-error" role="alert">Copy failed — select the text manually.</p>}
      {isLoading && <p className="loading">Loading…</p>}
      {error && <p className="alert alert-danger" role="alert">Failed to load the emitted test.</p>}
      {data && (
        <pre className="code-block" aria-label="artifact content"
          style={{ height: 'auto', maxHeight: '60vh', whiteSpace: 'pre' }}>
          {data.content}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function RunDetailPage({ api }: { api: Api }) {
  const { runId = '' } = useParams<{ pipelineId: string; runId: string }>();
  const navState = useLocation().state as Partial<RunNavState> | null;

  const { data, isLoading, error } = usePipelineRun(api, runId, {
    refetchInterval: 2000,
  });
  // Pipeline config — source of each step's outputType for the header (R-76).
  // Failure is non-fatal: headers just omit the type until a snapshot loads.
  const pipelineQuery = usePipeline(api, data?.run.pipelineId ?? '');

  // Initial loading state — data not yet available
  if (isLoading && !data) {
    return <LoadingSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="app-main">
        <p className="alert alert-danger" role="alert">
          {error instanceof Error ? error.message : 'Failed to load run.'}
        </p>
      </div>
    );
  }

  const { run, steps } = data;

  // Sort steps by stepIndex for reliable display order (DDB returns them in SK
  // lexicographic order which matches zero-padded index, but sort defensively).
  const sortedSteps = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);

  const configTypes = new Map<string, StepOutputType>(
    (pipelineQuery.data?.steps ?? []).map((s) => [s.stepId, outputTypeOf(s)]),
  );
  /** Latest earlier plan step that produced output — the Changes tab baseline (R-77). */
  const priorPlanStepOf = (index: number): StepRecord | undefined =>
    sortedSteps
      .slice(0, index)
      .reverse()
      .find((s) =>
        configTypes.get(s.stepId) === 'plan' && (s.status === 'completed' || s.status === 'cached'));

  return (
    <div className="app-main">
      <div style={{ maxWidth: 820 }}>

        {/* Run header */}
        <RunHeader run={run} />

        {/* Trigger response details (only present right after triggering) */}
        <SkippedRequirements skipped={navState?.skipped} />
        {navState?.runIds && navState.runIds.length > 1 && (
          <p className="alert alert-info" role="status">
            {navState.runIds.length} runs started (one per requirement) — see{' '}
            {run.experimentId
              ? <Link to={`/experiments?selected=pipeline:${encodeURIComponent(run.experimentId)}`}>the experiment</Link>
              : <Link to="/runs">Runs</Link>}.
          </p>
        )}

        <ArtifactView api={api} run={run} />

        {/* Warnings section — shown when optional steps failed */}
        {run.warnings.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="card-title" style={{ color: 'var(--warning)' }}>
              Warnings ({run.warnings.length})
            </p>
            <ul
              style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {run.warnings.map((w, i) => (
                <li
                  key={i}
                  className="alert alert-info"
                  role="note"
                  style={{ fontSize: 12, marginBottom: 0 }}
                >
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top-level error section */}
        {run.status === 'failed' && run.errorMessage && (
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="card-title" style={{ color: 'var(--danger)' }}>
              Run failed
            </p>
            <p className="alert alert-danger" role="alert" style={{ marginBottom: 0 }}>
              {run.errorMessage}
            </p>
            {run.errorStack && (
              <details style={{ marginTop: 8 }}>
                <summary
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px 0',
                  }}
                >
                  Stack trace
                </summary>
                <pre
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    marginTop: 6,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 8,
                  }}
                >
                  {run.errorStack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Step timeline */}
        <p className="section-heading" style={{ marginBottom: 8 }}>
          Steps{sortedSteps.length > 0 ? ` (${sortedSteps.length})` : ''}
        </p>

        {sortedSteps.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No steps recorded yet.
          </p>
        ) : (
          sortedSteps.map((step, i) => (
            <StepCard
              key={step.sk}
              api={api}
              runId={run.runId}
              step={step}
              configOutputType={configTypes.get(step.stepId)}
              priorPlanStep={priorPlanStepOf(i)}
            />
          ))
        )}

      </div>
    </div>
  );
}
