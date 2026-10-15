/**
 * PipelinePage — detail and full-edit page for a single pipeline.
 *
 * Route: /pipelines/:pipelineId
 * - Shows pipeline name, version, default sampling/mode, and ordered step list.
 * - Writers can edit all fields: name, maxSteps, steps (add/remove/reorder), per-step
 *   label/model/promptKey/flags.
 * - Save calls PUT /pipelines/{id}; HTTP 422 response body displayed as inline error
 *   banner, form stays open (R-40, TS-26).
 * - "Run" button stubs a pipeline run (POST /generate-functional-tests) — navigates or
 *   shows a placeholder until the run page (T-14) is wired up.
 * - Non-writers see a read-only view.
 *
 * Requirements: R-38, R-39, R-40, R-44
 * Design: SPA Design §PipelinesPage (detail editor), D-14 (TanStack Query)
 * Task: T-12 (extra — explicitly requested alongside PipelinesPage.tsx)
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { isWriter } from '../lib.js';
import type { PipelineStep } from '@registry/core';
import {
  usePipeline,
  useUpdatePipeline,
  usePrompts,
} from '../hooks/usePipelines.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
// StepEditor — editable (or read-only) card for one step
// ---------------------------------------------------------------------------

function StepEditor({
  step,
  index,
  total,
  writer,
  promptKeys,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: PipelineStep;
  index: number;
  total: number;
  writer: boolean;
  promptKeys: string[];
  onChange: (s: PipelineStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const isCustomModel = step.model !== '' && !KNOWN_MODELS.includes(step.model);

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      {/* Step header */}
      <div className="cluster" style={{ marginBottom: 8 }}>
        <span className="badge badge-accent" style={{ fontSize: 11 }}>Step {index + 1}</span>
        <span
          className="text-muted text-sm"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
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

      {writer ? (
        <div className="form-grid">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Step ID</label>
              <input
                className="form-input"
                value={step.stepId}
                onChange={(e) => onChange({ ...step, stepId: e.target.value })}
                placeholder="s1"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Label</label>
              <input
                className="form-input"
                value={step.label}
                onChange={(e) => onChange({ ...step, label: e.target.value })}
                placeholder="Step label"
              />
            </div>
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

          <div className="form-group">
            <label className="form-label">Prompt key</label>
            {promptKeys.length > 0 ? (
              <select
                className="form-select"
                value={step.promptKey}
                onChange={(e) => onChange({ ...step, promptKey: e.target.value })}
              >
                <option value="">— select prompt —</option>
                {promptKeys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            ) : (
              <input
                className="form-input"
                value={step.promptKey}
                onChange={(e) => onChange({ ...step, promptKey: e.target.value })}
                placeholder="functional-test-gen-default"
              />
            )}
          </div>

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
          {(
            [
              ['Label', step.label],
              ['Model', step.model],
              ['Prompt key', step.promptKey || '—'],
              ['Optional', step.optional ? 'Yes' : 'No'],
              ['Include context', step.includeContext ? 'Yes' : 'No'],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt className="meta-key">{k}</dt>
              <dd
                className="meta-val"
                style={
                  k === 'Model' || k === 'Prompt key'
                    ? { fontFamily: 'var(--font-mono)', fontSize: 12 }
                    : undefined
                }
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelinePage — main export
// ---------------------------------------------------------------------------

export default function PipelinePage({ api, token }: { api: Api; token: string }) {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();

  const { data: pipeline, isLoading, error: fetchError } =
    usePipeline(api, pipelineId ?? '');
  const updateMutation = useUpdatePipeline(api);
  const { data: promptsData } = usePrompts(api);

  const [name, setName] = useState('');
  const [maxSteps, setMaxSteps] = useState(10);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [saveError, setSaveError] = useState('');

  const writer = isWriter(token);
  const promptKeys = (promptsData?.prompts ?? []).map((p) => p.promptKey);

  // Sync form state from the fetched pipeline (only when the pipeline ID changes,
  // not on every background refetch — preserves unsaved edits)
  useEffect(() => {
    if (pipeline) {
      setName(pipeline.name);
      setMaxSteps(pipeline.maxSteps);
      setSteps(pipeline.steps);
      setSaveError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline?.pipelineId]);

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
        id: pipelineId!,
        body: { name, maxSteps, steps },
      });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setSaveError(msg);
    }
  }

  function handleRun() {
    // Stub: RunDetailPage (T-14) handles the actual run flow.
    // TODO: POST /generate-functional-tests { pipelineId } then navigate to run detail.
    alert(`Run pipeline "${name}" — pipeline run UI coming in a future task.`);
  }

  // Loading / error states
  if (!pipelineId) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="alert alert-danger" role="alert">No pipeline ID specified.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (fetchError || !pipeline) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="alert alert-danger" role="alert">Failed to load pipeline.</p>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => navigate('/pipelines')}
          >
            ← Back to Pipelines
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-body" aria-label="pipeline-detail">
      <div className="app-main">
        {/* Breadcrumb */}
        <div className="cluster" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/pipelines')}
          >
            ← Pipelines
          </button>
          <h3 className="detail-heading" style={{ marginBottom: 0 }}>
            {pipeline.name}
          </h3>
          <span className={`badge ${pipeline.active ? 'badge-success' : 'badge-muted'}`}>
            {pipeline.active ? 'active' : 'inactive'}
          </span>

          {writer && (
            <div className="cluster" style={{ marginLeft: 'auto', gap: 8 }}>
              <button className="btn btn-ghost" type="button" onClick={handleRun}>
                ▶ Run
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={updateMutation.isPending}
                onClick={handleSave}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Metadata card */}
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="card-title">Configuration</p>
          <dl className="meta-grid">
            {(
              [
                ['Pipeline ID', pipeline.pipelineId],
                ['Version', String(pipeline.version)],
                ['Created', new Date(pipeline.createdAt).toLocaleString()],
                ['Updated', new Date(pipeline.updatedAt).toLocaleString()],
                ['Default mode', pipeline.defaultMode],
                ['Sampling strategy', pipeline.defaultSampling.strategy],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="meta-key">{k}</dt>
                <dd
                  className="meta-val"
                  style={
                    k === 'Pipeline ID'
                      ? { fontFamily: 'var(--font-mono)', fontSize: 12 }
                      : undefined
                  }
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>

          {/* Editable name + maxSteps (writer only) */}
          {writer && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="pp-name">Name</label>
                  <input
                    id="pp-name"
                    className="form-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ maxWidth: 120 }}>
                  <label className="form-label" htmlFor="pp-max-steps">Max steps</label>
                  <input
                    id="pp-max-steps"
                    className="form-input"
                    type="number"
                    min={1}
                    max={20}
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 422 error banner — form stays open */}
        {saveError && (
          <p className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}>
            {saveError}
          </p>
        )}
        {updateMutation.isSuccess && !saveError && (
          <p className="alert alert-info" role="status" style={{ marginBottom: 12 }}>
            Pipeline saved successfully.
          </p>
        )}

        {/* Steps section */}
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

        {steps.length === 0 && (
          <p className="text-muted text-sm">
            No steps.{writer ? ' Click "+ Add step" to begin.' : ''}
          </p>
        )}

        {steps.map((step, index) => (
          <StepEditor
            key={step.stepId || String(index)}
            step={step}
            index={index}
            total={steps.length}
            writer={writer}
            promptKeys={promptKeys}
            onChange={(updated) => handleStepChange(index, updated)}
            onMoveUp={() => moveStep(index, index - 1)}
            onMoveDown={() => moveStep(index, index + 1)}
            onRemove={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
          />
        ))}

        {/* Bottom save bar (writer only) */}
        {writer && (
          <div
            className="cluster"
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
              gap: 8,
            }}
          >
            <button
              className="btn btn-primary"
              type="button"
              disabled={updateMutation.isPending}
              onClick={handleSave}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate('/pipelines')}
            >
              Cancel
            </button>
            {updateMutation.isSuccess && !saveError && (
              <span className="badge badge-success">Saved</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
