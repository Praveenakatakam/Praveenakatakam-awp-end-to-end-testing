/**
 * PipelinePage — detail and full-edit page for a single pipeline.
 *
 * Route: /pipelines/:pipelineId
 * - Writers can edit name, mode, sampling, steps; Run button triggers a pipeline run.
 * - Layout: shared SplitPane (R-68) — configuration + ordered step list on the
 *   left, the selected step's shared StepEditor (R-67) on the right.
 * - Wait for human and Max steps are not exposed in the UI.
 *
 * Requirements: R-38, R-39, R-40, R-44
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { isWriter } from '../lib.js';
import type { PipelineStep, SamplingConfig, SkippedRequirement } from '@registry/core';
import {
  usePipeline,
  useUpdatePipeline,
  useRunPipeline,
} from '../hooks/usePipelines.js';
import SplitPane from '../components/SplitPane.js';
import StepEditor, { makeStep, outputTypeOf } from '../components/StepEditor.js';
import SkippedRequirements, { type RunNavState } from '../components/SkippedRequirements.js';

// ---------------------------------------------------------------------------
// PipelinePage — main export
// ---------------------------------------------------------------------------

export default function PipelinePage({ api, token }: { api: Api; token: string }) {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const navigate = useNavigate();

  const { data: pipeline, isLoading, error: fetchError } =
    usePipeline(api, pipelineId ?? '');
  const updateMutation = useUpdatePipeline(api);
  const runMutation = useRunPipeline(api);

  const [name, setName] = useState('');
  const [defaultMode, setDefaultMode] = useState<'per_requirement' | 'batch'>('per_requirement');
  const [sampling, setSampling] = useState<SamplingConfig>({ strategy: 'first_n', n: 3 });
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [saveError, setSaveError] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [runSkipped, setRunSkipped] = useState<SkippedRequirement[]>([]);

  const writer = isWriter(token);

  // Sync form state from the fetched pipeline (only when the pipeline ID changes)
  useEffect(() => {
    if (pipeline) {
      setName(pipeline.name);
      setDefaultMode(pipeline.defaultMode);
      setSampling(pipeline.defaultSampling);
      setSteps(pipeline.steps);
      setSaveError('');
      setSelectedIndex(0);
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
    // Selection follows the step that moved (or the one displaced by it).
    setSelectedIndex((sel) => (sel === from ? to : sel === to ? from : sel));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex((sel) => (sel > index ? sel - 1 : sel === index ? Math.max(0, sel - 1) : sel));
  }

  function addStep() {
    setSteps((prev) => [...prev, makeStep(prev.length)]);
    setSelectedIndex(steps.length);
  }

  async function handleSave() {
    setSaveError('');
    try {
      await updateMutation.mutateAsync({
        id: pipelineId!,
        body: { name, defaultMode, defaultSampling: sampling, steps },
      });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setSaveError(msg);
    }
  }

  async function handleRun() {
    setSaveError('');
    setRunSkipped([]);
    try {
      const res = await runMutation.mutateAsync(pipeline!.pipelineId);
      const runId = res.runIds[0];
      // skipped (R-55, R-71) travels with the navigation; RunDetailPage lists it.
      if (runId) navigate(`/pipelines/${pipeline!.pipelineId}/runs/${runId}`, { state: res satisfies RunNavState });
      else setRunSkipped(res.skipped);
    } catch (err) {
      setSaveError(err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message);
      setRunSkipped(err instanceof ApiError ? (err.skipped ?? []) : []);
    }
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

  const selectedStep = steps[selectedIndex];

  return (
    <SplitPane id="pipeline-page" sideLabel="step-detail">
      <div aria-label="pipeline-detail">
        {/* Breadcrumb + actions */}
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
            {pipeline.active ? 'active' : 'archived'}
          </span>

          {writer && (
            <div className="cluster" style={{ marginLeft: 'auto', gap: 8 }}>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={runMutation.isPending || !pipeline.active}
                onClick={handleRun}
                title={!pipeline.active ? 'Cannot run an archived pipeline' : undefined}
              >
                {runMutation.isPending ? 'Starting…' : '▶ Run'}
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
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="meta-key">{k}</dt>
                <dd
                  className="meta-val"
                  style={k === 'Pipeline ID' ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>

          {/* Editable config (writer only) */}
          {writer && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="pp-name">Name</label>
                <input
                  id="pp-name"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="pp-mode">Mode</label>
                  <select
                    id="pp-mode"
                    className="form-select"
                    value={defaultMode}
                    onChange={(e) => setDefaultMode(e.target.value as 'per_requirement' | 'batch')}
                  >
                    <option value="per_requirement">Per requirement</option>
                    <option value="batch">Batch</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="pp-sampling">Sampling strategy</label>
                  <select
                    id="pp-sampling"
                    className="form-select"
                    value={sampling.strategy}
                    onChange={(e) => {
                      const s = e.target.value;
                      if (s === 'first_n') setSampling({ strategy: 'first_n', n: 3 });
                      else if (s === 'percentage') setSampling({ strategy: 'percentage', percentage: 100 });
                      else if (s === 'ids') setSampling({ strategy: 'ids', ids: [] });
                      else setSampling({ strategy: 'all' });
                    }}
                  >
                    <option value="first_n">First N</option>
                    <option value="percentage">Percentage</option>
                    <option value="all">All</option>
                    <option value="ids">Specific IDs</option>
                  </select>
                  {sampling.strategy === 'first_n' && (
                    <input
                      className="form-input"
                      style={{ marginTop: 4 }}
                      type="number"
                      min={1}
                      value={(sampling as { strategy: 'first_n'; n: number }).n}
                      onChange={(e) => setSampling({ strategy: 'first_n', n: Number(e.target.value) })}
                    />
                  )}
                  {sampling.strategy === 'percentage' && (
                    <input
                      className="form-input"
                      style={{ marginTop: 4 }}
                      type="number"
                      min={1}
                      max={100}
                      value={(sampling as { strategy: 'percentage'; percentage: number }).percentage}
                      onChange={(e) => setSampling({ strategy: 'percentage', percentage: Number(e.target.value) })}
                    />
                  )}
                  {sampling.strategy === 'ids' && (
                    <textarea
                      className="form-textarea"
                      style={{ marginTop: 4 }}
                      rows={3}
                      placeholder="One requirement ID per line"
                      value={(sampling as { strategy: 'ids'; ids: string[] }).ids.join('\n')}
                      onChange={(e) =>
                        setSampling({
                          strategy: 'ids',
                          ids: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                        })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error / success banners */}
        {saveError && (
          <p className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}>
            {saveError}
          </p>
        )}
        <SkippedRequirements skipped={runSkipped} />
        {updateMutation.isSuccess && !saveError && (
          <p className="alert alert-info" role="status" style={{ marginBottom: 12 }}>
            Pipeline saved successfully.
          </p>
        )}

        {/* Steps section — ordered list; the selected step is edited in the side pane */}
        <div className="cluster" style={{ marginBottom: 8 }}>
          <p className="section-heading" style={{ marginBottom: 0 }}>
            Steps ({steps.length})
          </p>
          {writer && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={addStep}>
              + Add step
            </button>
          )}
        </div>

        {steps.length === 0 && (
          <p className="text-muted text-sm">
            No steps.{writer ? ' Click "+ Add step" to begin.' : ''}
          </p>
        )}

        <ol className="step-list" aria-label="steps">
          {steps.map((step, index) => (
            <li key={index} className="step-list-item">
              <button
                className="row-btn"
                type="button"
                aria-pressed={index === selectedIndex}
                onClick={() => setSelectedIndex(index)}
              >
                <span className="badge badge-muted" style={{ fontSize: 11 }}>{index + 1}</span>
                <span className="row-label">{step.label || step.stepId}</span>
                <span className="badge badge-muted">{outputTypeOf(step)}</span>
                <span className="row-meta">{step.promptKey || 'no prompt'}</span>
              </button>
              {writer && (
                <div className="cluster" style={{ gap: 4, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" type="button" title="Move up"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={index === 0} onClick={() => moveStep(index, index - 1)}>↑</button>
                  <button className="btn btn-ghost btn-sm" type="button" title="Move down"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={index === steps.length - 1} onClick={() => moveStep(index, index + 1)}>↓</button>
                  <button className="btn btn-ghost btn-sm" type="button"
                    aria-label={`Remove step ${index + 1}`}
                    style={{ color: 'var(--danger, #e53e3e)' }} onClick={() => removeStep(index)}>✕</button>
                </div>
              )}
            </li>
          ))}
        </ol>

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

      {selectedStep ? (
        <StepEditor
          key={selectedIndex}
          api={api}
          step={selectedStep}
          index={selectedIndex}
          total={steps.length}
          writer={writer}
          onChange={(updated) => handleStepChange(selectedIndex, updated)}
        />
      ) : (
        <p className="text-muted text-sm">Select a step to view or edit it.</p>
      )}
    </SplitPane>
  );
}
