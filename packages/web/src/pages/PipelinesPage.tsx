/**
 * PipelinesPage — list of active pipelines with an inline editor panel.
 *
 * List view: pipeline name, step count, active/inactive badge, last-updated date.
 * Writers see "New Pipeline" button (R-44, TS-24, TS-25) and per-row delete controls.
 * Selecting a pipeline opens an inline editor panel:
 *   - Editable name, ordered step list with model selector + prompt body preview.
 *   - Writers can add/remove/reorder steps, view prompt text inline, open a "New Prompt"
 *     sub-form, and swap promptKey (R-39).
 *   - Save calls PUT /pipelines/{id}; HTTP 422 body shown as inline error banner (R-40, TS-26).
 * Non-writers see a read-only view.
 *
 * Requirements: R-38, R-39, R-40, R-44
 * Design: SPA Design §PipelinesPage, D-14 (TanStack Query), query keys §['pipelines']
 * Task: T-12
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { isWriter } from '../lib.js';
import type { PipelineConfig, PipelineStep } from '@registry/core';
import {
  usePipelines,
  useCreatePipeline,
  useUpdatePipeline,
  useDeletePipeline,
  usePrompt,
  useCreatePrompt,
} from '../hooks/usePipelines.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Well-known Bedrock model IDs offered in the step model selector. */
const KNOWN_MODELS = [
  'us.anthropic.claude-sonnet-4-6',
  'us.anthropic.claude-haiku-4-5',
];

function makeStep(index: number): PipelineStep {
  return {
    stepId: `s${index + 1}`,
    label: `Step ${index + 1}`,
    model: KNOWN_MODELS[0],
    promptKey: '',
    optional: false,
    waitForHuman: false,
    includeContext: true,
  };
}

// ---------------------------------------------------------------------------
// StepRow — one editable (or read-only) step in the inline panel
// ---------------------------------------------------------------------------

function StepRow({
  api,
  step,
  index,
  total,
  writer,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  api: Api;
  step: PipelineStep;
  index: number;
  total: number;
  writer: boolean;
  onChange: (s: PipelineStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [showPromptBody, setShowPromptBody] = useState(false);
  const [newPromptMode, setNewPromptMode] = useState(false);
  const [newPromptKey, setNewPromptKey] = useState('');
  const [newPromptBody, setNewPromptBody] = useState('');
  const [newPromptError, setNewPromptError] = useState('');

  // Fetch prompt body for inline preview — query is skipped when promptKey is empty
  const { data: promptData } = usePrompt(api, step.promptKey);
  const createPromptMutation = useCreatePrompt(api);

  const isCustomModel = step.model !== '' && !KNOWN_MODELS.includes(step.model);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 12px',
      marginBottom: 8,
      background: 'var(--surface, #fff)',
    }}>
      {/* Row header: step number, stepId, reorder/remove controls */}
      <div className="cluster" style={{ marginBottom: 8 }}>
        <span className="badge badge-muted" style={{ fontSize: 11 }}>
          {index + 1}
        </span>
        <span className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
          {step.stepId}
        </span>
        {writer && (
          <div className="cluster" style={{ marginLeft: 'auto', gap: 4 }}>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              title="Move up"
            >
              ↑
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              title="Move down"
            >
              ↓
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              style={{ color: 'var(--danger, #e53e3e)' }}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Edit fields (writer) / read-only metadata (non-writer) */}
      {writer ? (
        <div className="form-grid">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Label</label>
              <input
                className="form-input"
                value={step.label}
                onChange={(e) => onChange({ ...step, label: e.target.value })}
                placeholder="Step label"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Model</label>
              <select
                className="form-select"
                value={isCustomModel ? '__custom__' : (step.model || KNOWN_MODELS[0])}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    onChange({ ...step, model: e.target.value });
                  } else {
                    onChange({ ...step, model: '' });
                  }
                }}
              >
                {KNOWN_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {isCustomModel && (
                <input
                  className="form-input"
                  style={{ marginTop: 4 }}
                  value={step.model}
                  onChange={(e) => onChange({ ...step, model: e.target.value })}
                  placeholder="us.anthropic.claude-..."
                />
              )}
            </div>
          </div>

          {/* Prompt key + "New Prompt" sub-form */}
          <div className="form-group">
            <label className="form-label">Prompt key</label>
            <div className="cluster" style={{ gap: 6 }}>
              <input
                className="form-input"
                style={{ flex: 1 }}
                value={step.promptKey}
                onChange={(e) => onChange({ ...step, promptKey: e.target.value })}
                placeholder="functional-test-gen-default"
              />
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setNewPromptMode((p) => !p)}
              >
                {newPromptMode ? 'Cancel' : '+ New prompt'}
              </button>
            </div>
          </div>

          {newPromptMode && (
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 10px',
              background: 'var(--bg)',
            }}>
              <p className="text-sm" style={{ marginBottom: 6, fontWeight: 500 }}>New prompt</p>
              <div className="form-group">
                <label className="form-label">Prompt key</label>
                <input
                  className="form-input"
                  value={newPromptKey}
                  onChange={(e) => setNewPromptKey(e.target.value)}
                  placeholder="my-prompt-key"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Prompt body</label>
                <textarea
                  className="form-textarea"
                  value={newPromptBody}
                  onChange={(e) => setNewPromptBody(e.target.value)}
                  rows={4}
                />
              </div>
              {newPromptError && (
                <p className="form-error" role="alert">{newPromptError}</p>
              )}
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={createPromptMutation.isPending || !newPromptKey || !newPromptBody}
                onClick={async () => {
                  setNewPromptError('');
                  try {
                    await createPromptMutation.mutateAsync({
                      promptKey: newPromptKey,
                      body: newPromptBody,
                    });
                    onChange({ ...step, promptKey: newPromptKey });
                    setNewPromptMode(false);
                    setNewPromptKey('');
                    setNewPromptBody('');
                  } catch (err) {
                    const msg =
                      err instanceof ApiError && err.serverMessage
                        ? err.serverMessage
                        : (err as Error).message;
                    setNewPromptError(msg);
                  }
                }}
              >
                {createPromptMutation.isPending ? 'Creating…' : 'Create prompt'}
              </button>
            </div>
          )}

          {/* Flags */}
          <div className="cluster" style={{ gap: 16, flexWrap: 'wrap' }}>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={step.optional}
                onChange={(e) => onChange({ ...step, optional: e.target.checked })}
              />
              Optional
            </label>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={step.waitForHuman}
                onChange={(e) => onChange({ ...step, waitForHuman: e.target.checked })}
              />
              Wait for human
            </label>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={step.includeContext}
                onChange={(e) => onChange({ ...step, includeContext: e.target.checked })}
              />
              Include context
            </label>
          </div>
        </div>
      ) : (
        /* Read-only view */
        <dl className="meta-grid">
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Label</dt>
            <dd className="meta-val">{step.label}</dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Model</dt>
            <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {step.model}
            </dd>
          </div>
          <div style={{ display: 'contents' }}>
            <dt className="meta-key">Prompt key</dt>
            <dd className="meta-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {step.promptKey || '—'}
            </dd>
          </div>
        </dl>
      )}

      {/* Prompt body preview (expandable for all users) */}
      {step.promptKey && (
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => setShowPromptBody((p) => !p)}
          >
            {showPromptBody ? 'Hide prompt body' : 'View prompt body'}
          </button>
          {showPromptBody && (
            promptData?.body ? (
              <pre style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 10,
                fontSize: 12,
                maxHeight: '20vh',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
                marginTop: 4,
              }}>
                {promptData.body}
              </pre>
            ) : (
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                {promptData === undefined
                  ? 'Loading…'
                  : 'No inline body (may be stored in S3 or prompt not found).'}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineEditorPanel — inline panel for an existing pipeline
// ---------------------------------------------------------------------------

function PipelineEditorPanel({
  api,
  pipeline,
  writer,
  onClose,
}: {
  api: Api;
  pipeline: PipelineConfig;
  writer: boolean;
  onClose: () => void;
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

      {/* Pipeline metadata */}
      <dl className="meta-grid" style={{ marginBottom: 12 }}>
        {(
          [
            ['Version', String(pipeline.version)],
            ['Mode', pipeline.defaultMode],
            ['Max steps', String(pipeline.maxSteps)],
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
          <StepRow
            key={step.stepId || String(index)}
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const writer = isWriter(token);
  const pipelines = data?.pipelines ?? [];

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

  return (
    <div className="app-body" aria-label="pipelines">
      <div className="app-main">
        {/* Page heading + "New Pipeline" button */}
        <div className="cluster" style={{ marginBottom: 12 }}>
          <h3 className="section-heading" style={{ marginBottom: 0 }}>Pipelines</h3>
          {writer && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={openNew}
              data-testid="new-pipeline-btn"
            >
              New Pipeline
            </button>
          )}
        </div>

        {isLoading && <p className="loading">Loading…</p>}
        {fetchError && (
          <p className="alert alert-danger" role="alert">Failed to load pipelines.</p>
        )}

        {!isLoading && !fetchError && pipelines.length === 0 && (
          <p className="text-muted text-sm">
            No active pipelines.
            {writer ? ' Click "New Pipeline" to create one.' : ''}
          </p>
        )}

        {/* Pipeline list (R-38) */}
        {pipelines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pipelines.map((p) => {
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

                  <span className={`badge ${p.active ? 'badge-success' : 'badge-muted'}`}>
                    {p.active ? 'active' : 'inactive'}
                  </span>

                  <span className="text-muted text-sm">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>

                  {/* Delete controls (writer only) */}
                  {writer && deleteConfirmId !== p.pipelineId && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      style={{ color: 'var(--danger, #e53e3e)', flexShrink: 0 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(p.pipelineId);
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {writer && deleteConfirmId === p.pipelineId && (
                    <div
                      className="cluster"
                      style={{ gap: 4, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-sm" style={{ color: 'var(--danger, #e53e3e)' }}>
                        Confirm?
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline editor / create panel */}
      {panelOpen && (
        <aside className="app-panel" aria-label="pipeline-detail">
          {showNewForm ? (
            <NewPipelinePanel api={api} onCreated={closePanel} onClose={closePanel} />
          ) : selected ? (
            <PipelineEditorPanel
              api={api}
              pipeline={selected}
              writer={writer}
              onClose={closePanel}
            />
          ) : null}
        </aside>
      )}
    </div>
  );
}
