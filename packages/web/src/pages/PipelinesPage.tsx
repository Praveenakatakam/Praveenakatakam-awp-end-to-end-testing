/**
 * PipelinesPage — list of pipelines with inline editor panel.
 *
 * Active / Archived tabs filter by pipeline.active. Writers see "New Pipeline"
 * on the Active tab and "Recover" on the Archived tab. Selecting a pipeline
 * opens an inline editor panel in a shared resizable SplitPane (R-68) using the
 * shared StepEditor (R-67).
 *
 * Requirements: R-38, R-39, R-40, R-44
 */
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { isWriter } from '../lib.js';
import type { PipelineConfig, PipelineStep, SkippedRequirement } from '@registry/core';
import {
  usePipelines,
  useCreatePipeline,
  useUpdatePipeline,
  useDeletePipeline,
  useRestorePipeline,
  useRunPipeline,
} from '../hooks/usePipelines.js';
import SplitPane from '../components/SplitPane.js';
import StepEditor, { makeStep } from '../components/StepEditor.js';
import SkippedRequirements, { type RunNavState } from '../components/SkippedRequirements.js';

// ---------------------------------------------------------------------------
// PipelineEditorPanel — inline panel for an existing pipeline
// ---------------------------------------------------------------------------

function PipelineEditorPanel({
  api,
  pipeline,
  writer,
  onClose,
  onRun,
}: {
  api: Api;
  pipeline: PipelineConfig;
  writer: boolean;
  onClose: () => void;
  onRun: (pipelineId: string) => void;
}) {
  const updateMutation = useUpdatePipeline(api);

  const [name, setName] = useState(pipeline.name);
  const [steps, setSteps] = useState<PipelineStep[]>(pipeline.steps);
  const [saveError, setSaveError] = useState('');

  // Re-sync local state when a different pipeline is selected
  useEffect(() => {
    setName(pipeline.name);
    setSteps(pipeline.steps);
    setSaveError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.pipelineId]);

  function handleStepChange(index: number, updated: PipelineStep) {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function handleSave() {
    setSaveError('');
    try {
      await updateMutation.mutateAsync({
        id: pipeline.pipelineId,
        body: { name, steps },
      });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setSaveError(msg);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Panel header */}
      <div className="cluster" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <p
          className="detail-heading"
          style={{
            marginBottom: 0,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {pipeline.name}
        </p>
        {writer && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            style={{ flexShrink: 0 }}
            onClick={() => onRun(pipeline.pipelineId)}
          >
            ▶ Run
          </button>
        )}
        <Link
          to={`/pipelines/${pipeline.pipelineId}`}
          className="btn btn-ghost btn-sm"
          style={{ flexShrink: 0 }}
        >
          Full editor
        </Link>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{ flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {/* Pipeline metadata (no Max steps) */}
      <dl className="meta-grid" style={{ marginBottom: 12 }}>
        {(
          [
            ['Version', String(pipeline.version)],
            ['Mode', pipeline.defaultMode],
            ['Updated', new Date(pipeline.updatedAt).toLocaleDateString()],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="meta-key">{k}</dt>
            <dd className="meta-val">{v}</dd>
          </div>
        ))}
      </dl>

      {/* Editable name (writer only) */}
      {writer && (
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label" htmlFor="ep-name">Name</label>
          <input
            id="ep-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      {/* Steps heading + add button */}
      <div className="cluster" style={{ marginBottom: 8 }}>
        <p className="section-heading" style={{ marginBottom: 0 }}>
          Steps ({steps.length})
        </p>
        {writer && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setSteps((prev) => [...prev, makeStep(prev.length)])}
          >
            + Add step
          </button>
        )}
      </div>

      {/* Scrollable steps list */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 2 }}>
        {steps.length === 0 && (
          <p className="text-muted text-sm">
            No steps.{writer ? ' Click "+ Add step" to begin.' : ''}
          </p>
        )}
        {steps.map((step, index) => (
          <StepEditor
            key={index}
            api={api}
            step={step}
            index={index}
            total={steps.length}
            writer={writer}
            onChange={(updated) => handleStepChange(index, updated)}
            onMoveUp={() => moveStep(index, index - 1)}
            onMoveDown={() => moveStep(index, index + 1)}
            onRemove={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
          />
        ))}
      </div>

      {/* 422 error banner — form stays open (R-40, TS-26) */}
      {saveError && (
        <p className="alert alert-danger" role="alert" style={{ marginTop: 8 }}>
          {saveError}
        </p>
      )}
      {updateMutation.isSuccess && !saveError && (
        <p className="alert alert-info" role="status" style={{ marginTop: 8 }}>
          Saved.
        </p>
      )}

      {/* Save / Cancel controls (writer only) */}
      {writer && (
        <div
          className="cluster"
          style={{ marginTop: 12, gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}
        >
          <button
            className="btn btn-primary"
            type="button"
            disabled={updateMutation.isPending}
            onClick={handleSave}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewPipelinePanel — inline create form
// ---------------------------------------------------------------------------

function NewPipelinePanel({
  api,
  onCreated,
  onClose,
}: {
  api: Api;
  onCreated: () => void;
  onClose: () => void;
}) {
  const createMutation = useCreatePipeline(api);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  return (
    <div>
      <div className="cluster" style={{ marginBottom: 12 }}>
        <p className="detail-heading" style={{ marginBottom: 0 }}>New Pipeline</p>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await createMutation.mutateAsync({
              name,
              steps: [],
              active: true,
              maxSteps: 10,
              maxAgeMinutes: 60,
              defaultSampling: { strategy: 'first_n', n: 3 },
              defaultMode: 'per_requirement',
            });
            onCreated();
          } catch (err) {
            const msg =
              err instanceof ApiError && err.serverMessage
                ? err.serverMessage
                : (err as Error).message;
            setError(msg);
          }
        }}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="np-name">Name</label>
          <input
            id="np-name"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My pipeline"
            required
          />
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="cluster" style={{ gap: 8 }}>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelinesPage — main export (R-38, R-44)
// ---------------------------------------------------------------------------

export default function PipelinesPage({ api, token }: { api: Api; token: string }) {
  const { data, isLoading, error: fetchError } = usePipelines(api);
  const deleteMutation = useDeletePipeline(api);
  const restoreMutation = useRestorePipeline(api);
  const runMutation = useRunPipeline(api);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [runError, setRunError] = useState('');
  const [runSkipped, setRunSkipped] = useState<SkippedRequirement[]>([]);

  const writer = isWriter(token);
  const pipelines = data?.pipelines ?? [];
  const activePipelines = pipelines.filter((p) => p.active);
  const archivedPipelines = pipelines.filter((p) => !p.active);
  const visiblePipelines = activeTab === 'active' ? activePipelines : archivedPipelines;

  // Derive the selected pipeline record from the live list (auto-updates after mutations)
  const selected = selectedId
    ? (pipelines.find((p) => p.pipelineId === selectedId) ?? null)
    : null;

  const panelOpen = showNewForm || selected !== null;

  function openNew() {
    setSelectedId(null);
    setShowNewForm(true);
  }

  function selectPipeline(p: PipelineConfig) {
    setSelectedId(p.pipelineId);
    setShowNewForm(false);
    setDeleteConfirmId(null);
  }

  function closePanel() {
    setSelectedId(null);
    setShowNewForm(false);
  }

  async function handleRun(pipelineId: string) {
    setRunError('');
    setRunSkipped([]);
    try {
      const res = await runMutation.mutateAsync(pipelineId);
      const runId = res.runIds[0];
      // skipped (R-55, R-71) travels with the navigation; RunDetailPage lists it.
      if (runId) navigate(`/pipelines/${pipelineId}/runs/${runId}`, { state: res satisfies RunNavState });
      else setRunSkipped(res.skipped);
    } catch (err) {
      setRunError(err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message);
      setRunSkipped(err instanceof ApiError ? (err.skipped ?? []) : []);
    }
  }

  return (
    <SplitPane id="pipelines" sideLabel="pipeline-detail">
      <div aria-label="pipelines">
        {/* Tabs + New Pipeline button */}
        <div className="cluster" style={{ marginBottom: 12, gap: 0, alignItems: 'flex-end' }}>
          <div className="tabs" style={{ flex: 1 }}>
            <button
              className={`tab ${activeTab === 'active' ? 'tab-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('active')}
            >
              Active
              {activePipelines.length > 0 && (
                <span className="badge badge-muted">{activePipelines.length}</span>
              )}
            </button>
            <button
              className={`tab ${activeTab === 'archived' ? 'tab-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('archived')}
            >
              Archived
              {archivedPipelines.length > 0 && (
                <span className="badge badge-muted">{archivedPipelines.length}</span>
              )}
            </button>
          </div>
          {writer && activeTab === 'active' && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={openNew}
              data-testid="new-pipeline-btn"
              style={{ marginLeft: 12 }}
            >
              New Pipeline
            </button>
          )}
        </div>

        {/* Run trigger rejected (e.g. 422 — nothing grounds, R-56) */}
        {runError && (
          <p className="alert alert-danger" role="alert">Run failed to start: {runError}</p>
        )}
        <SkippedRequirements skipped={runSkipped} />

        {isLoading && <p className="loading">Loading…</p>}
        {fetchError && (
          <p className="alert alert-danger" role="alert">Failed to load pipelines.</p>
        )}

        {!isLoading && !fetchError && visiblePipelines.length === 0 && (
          <p className="text-muted text-sm">
            {activeTab === 'active'
              ? `No active pipelines.${writer ? ' Click "New Pipeline" to create one.' : ''}`
              : 'No archived pipelines.'}
          </p>
        )}

        {/* Pipeline list */}
        {visiblePipelines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visiblePipelines.map((p) => {
              const isSelected = selectedId === p.pipelineId;
              return (
                <div
                  key={p.pipelineId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    border: `1px solid ${isSelected ? 'var(--accent, #4f46e5)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected
                      ? 'var(--surface-accent, var(--surface))'
                      : 'var(--surface)',
                    cursor: 'pointer',
                  }}
                  onClick={() => selectPipeline(p)}
                >
                  <span
                    className="row-label"
                    style={{
                      flex: 1,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                  </span>

                  <span className="badge badge-muted">
                    {p.steps.length} step{p.steps.length !== 1 ? 's' : ''}
                  </span>

                  <span className="text-muted text-sm">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>

                  {/* Active tab: Delete controls */}
                  {writer && activeTab === 'active' && deleteConfirmId !== p.pipelineId && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      style={{ color: 'var(--danger, #e53e3e)', flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(p.pipelineId);
                      }}
                    >
                      Archive
                    </button>
                  )}
                  {writer && activeTab === 'active' && deleteConfirmId === p.pipelineId && (
                    <div
                      className="cluster"
                      style={{ gap: 4, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-sm" style={{ color: 'var(--danger, #e53e3e)' }}>
                        Archive?
                      </span>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={async () => {
                          await deleteMutation.mutateAsync(p.pipelineId);
                          setDeleteConfirmId(null);
                          if (selectedId === p.pipelineId) closePanel();
                        }}
                      >
                        Yes
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        No
                      </button>
                    </div>
                  )}

                  {/* Archived tab: Recover button */}
                  {writer && activeTab === 'archived' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      style={{ flexShrink: 0 }}
                      disabled={restoreMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        restoreMutation.mutate(p.pipelineId);
                      }}
                    >
                      Recover
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline editor / create panel (side pane — absent when closed) */}
      {panelOpen && (
        showNewForm ? (
          <NewPipelinePanel api={api} onCreated={closePanel} onClose={closePanel} />
        ) : selected ? (
          <PipelineEditorPanel
            api={api}
            pipeline={selected}
            writer={writer}
            onClose={closePanel}
            onRun={handleRun}
          />
        ) : null
      )}
    </SplitPane>
  );
}
