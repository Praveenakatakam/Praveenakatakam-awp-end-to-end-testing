/**
 * RunsPage — history of all pipeline runs, newest-first.
 * Route: /runs
 * Clicking a row navigates to /pipelines/:pipelineId/runs/:runId.
 */
import { useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import type { PipelineRun, PipelineRunStatus } from '@registry/core';
import { useRunsList } from '../hooks/usePipelines.js';

function statusBadgeClass(status: PipelineRunStatus): string {
  switch (status) {
    case 'completed':               return 'badge badge-success';
    case 'completed_with_warnings': return 'badge badge-warning';
    case 'running':                 return 'badge badge-accent badge-pulse';
    case 'failed':                  return 'badge badge-danger';
    case 'timed_out':               return 'badge badge-muted';
  }
}

function RunRow({ run, onClick }: { run: PipelineRun; onClick: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        cursor: 'pointer',
        flexWrap: 'wrap',
      }}
      onClick={onClick}
    >
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {run.runId}
      </span>

      <span className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {run.pipelineId.slice(0, 8)}…
      </span>

      <span className="badge badge-muted">{run.mode}</span>
      <span className="badge badge-muted">
        {run.requirementIds.length} req{run.requirementIds.length !== 1 ? 's' : ''}
      </span>
      <span className={statusBadgeClass(run.status)}>{run.status.replace(/_/g, ' ')}</span>

      <span className="text-muted text-sm" style={{ whiteSpace: 'nowrap' }}>
        {new Date(run.startedAt).toLocaleString()}
      </span>
    </div>
  );
}

export default function RunsPage({ api }: { api: Api }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useRunsList(api);

  const runs = data?.items ?? [];

  return (
    <div className="app-body" aria-label="runs">
      <div className="app-main">
        <div className="cluster" style={{ marginBottom: 12 }}>
          <h3 className="section-heading" style={{ marginBottom: 0 }}>Run History</h3>
        </div>

        {isLoading && <p className="loading">Loading…</p>}
        {error && <p className="alert alert-danger" role="alert">Failed to load runs.</p>}

        {!isLoading && !error && runs.length === 0 && (
          <p className="text-muted text-sm">No runs yet. Click ▶ Run on a pipeline to start one.</p>
        )}

        {runs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {runs.map((run) => (
              <RunRow
                key={run.runId}
                run={run}
                onClick={() => navigate(`/pipelines/${run.pipelineId}/runs/${run.runId}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
