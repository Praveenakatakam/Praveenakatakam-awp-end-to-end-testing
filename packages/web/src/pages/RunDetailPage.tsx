/**
 * RunDetailPage — visual step flow for a pipeline run.
 *
 * Route: /pipelines/:pipelineId/runs/:runId
 *
 * Features:
 *   - Polls GET /runs/{runId} every 2 s while run is non-terminal (R-54, TS-38)
 *   - Run header: runId, status badge, startedAt, sampling config summary
 *   - Ordered step cards with status badges and expandable detail panels
 *   - Warnings section when run.warnings is non-empty
 *   - Error section when run is failed
 *   - Loading skeleton on initial fetch
 *
 * Requirements: R-54
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Api } from '../api.js';
import type {
  PipelineRun,
  StepRecord,
  PipelineRunStatus,
  StepStatus,
  SamplingConfig,
} from '@registry/core';
import { usePipelineRun } from '../hooks/usePipelines.js';

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

// ---------------------------------------------------------------------------
// StepCard — one expandable card per step record
// ---------------------------------------------------------------------------

function StepCard({ step }: { step: StepRecord }) {
  const [expanded, setExpanded] = useState(false);

  const inline = getInlineOutput(step);
  const hasOutput = inline !== null || isS3Output(step);
  const isTerminal =
    step.status === 'completed' || step.status === 'cached' ||
    step.status === 'failed'    || step.status === 'warning';

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      {/* Header row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Zero-padded step index */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)',
            minWidth: 52,
          }}
        >
          STEP #{String(step.stepIndex).padStart(2, '0')}
        </span>

        {/* Label */}
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
          {step.label}
        </span>

        {/* Model */}
        <span
          style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {step.model}
        </span>

        {/* Status badge */}
        <span className={stepStatusBadgeClass(step.status)}>{step.status}</span>

        {/* Expand/collapse — only for terminal steps */}
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
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Output stored in S3</p>
          )}
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && (
        <div
          style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
        >
          {/* Full output */}
          {hasOutput && (
            <>
              <p className="section-heading">Output</p>
              {inline !== null ? (
                <pre
                  className="code-block"
                  aria-label="step output"
                  style={{ height: 'auto', maxHeight: '40vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {inline}
                </pre>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Output stored in S3 — retrieve via artifacts bucket.
                </p>
              )}
            </>
          )}

          {/* Metrics grid */}
          {(step.durationMs         !== undefined ||
            step.bedrockLatencyMs   !== undefined ||
            step.inputTokens        !== undefined ||
            step.outputTokens       !== undefined ||
            step.costEstimateUsd    !== undefined ||
            step.inputCharacters    !== undefined ||
            step.outputCharacters   !== undefined ||
            step.contextTokenEstimate !== undefined) && (
            <>
              <p className="section-heading" style={{ marginTop: 14 }}>Metrics</p>
              <dl className="meta-grid">
                {step.durationMs !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Duration</dt>
                    <dd className="meta-val">{step.durationMs.toLocaleString()} ms</dd>
                  </div>
                )}
                {step.bedrockLatencyMs !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Bedrock latency</dt>
                    <dd className="meta-val">{step.bedrockLatencyMs.toLocaleString()} ms</dd>
                  </div>
                )}
                {step.inputTokens !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Input tokens</dt>
                    <dd className="meta-val">{step.inputTokens.toLocaleString()}</dd>
                  </div>
                )}
                {step.outputTokens !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Output tokens</dt>
                    <dd className="meta-val">{step.outputTokens.toLocaleString()}</dd>
                  </div>
                )}
                {step.inputCharacters !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Input chars</dt>
                    <dd className="meta-val">{step.inputCharacters.toLocaleString()}</dd>
                  </div>
                )}
                {step.outputCharacters !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Output chars</dt>
                    <dd className="meta-val">{step.outputCharacters.toLocaleString()}</dd>
                  </div>
                )}
                {step.contextTokenEstimate !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Context tokens (est.)</dt>
                    <dd className="meta-val">{step.contextTokenEstimate.toLocaleString()}</dd>
                  </div>
                )}
                {step.costEstimateUsd !== undefined && (
                  <div style={{ display: 'contents' }}>
                    <dt className="meta-key">Cost estimate</dt>
                    <dd className="meta-val">${step.costEstimateUsd.toFixed(6)}</dd>
                  </div>
                )}
              </dl>
            </>
          )}

          {/* Error block — for failed/warning steps */}
          {(step.status === 'failed' || step.status === 'warning') && step.errorMessage && (
            <>
              <p
                className="section-heading"
                style={{ marginTop: 14, color: 'var(--danger)' }}
              >
                Error
              </p>
              <p className="alert alert-danger" role="alert" style={{ marginBottom: 0 }}>
                {step.errorMessage}
              </p>
              {step.errorStack && (
                <details style={{ marginTop: 6 }}>
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
                    {step.errorStack}
                  </pre>
                </details>
              )}
            </>
          )}
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
// Main page component
// ---------------------------------------------------------------------------

export default function RunDetailPage({ api }: { api: Api }) {
  const { runId = '' } = useParams<{ pipelineId: string; runId: string }>();

  const { data, isLoading, error } = usePipelineRun(api, runId, {
    refetchInterval: 2000,
  });

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

  return (
    <div className="app-main">
      <div style={{ maxWidth: 820 }}>

        {/* Run header */}
        <RunHeader run={run} />

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
          sortedSteps.map((step) => <StepCard key={step.sk} step={step} />)
        )}

      </div>
    </div>
  );
}
