/**
 * StepEditor — the single pipeline step editor (R-39, R-67, T-21).
 *
 * Used by both the /pipelines side panel and the full /pipelines/:id page.
 * Writers edit label, model, prompt (select / new-prompt sub-form), output
 * type, and the includeContext / optional toggles; everyone can "View prompt
 * body". Reorder/remove controls render only when the callbacks are supplied.
 */
import { useEffect, useState } from 'react';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import type { PipelineStep, StepOutputType } from '@registry/core';
import { usePrompt, usePrompts, useCreatePrompt } from '../hooks/usePipelines.js';

export const KNOWN_MODELS = [
  'us.anthropic.claude-sonnet-4-6',
  'us.anthropic.claude-haiku-4-5',
];

/**
 * Mirrors `STEP_OUTPUT_TYPES` / `resolveOutputType` from `@registry/core`.
 * Only types may be imported from core in the SPA: its runtime module pulls in
 * `node:crypto` and Node-only dependencies.
 */
export const OUTPUT_TYPES: readonly StepOutputType[] = ['plan', 'critique', 'freeform'];
export const outputTypeOf = (step: Pick<PipelineStep, 'outputType'>): StepOutputType =>
  step.outputType ?? 'plan';

const OUTPUT_TYPE_LABELS: Record<StepOutputType, string> = {
  plan: 'Plan (functional test plan)',
  critique: 'Critique',
  freeform: 'Freeform text',
};

export function makeStep(index: number): PipelineStep {
  return {
    stepId: `s${index + 1}`,
    label: `Step ${index + 1}`,
    model: KNOWN_MODELS[0],
    promptKey: '',
    optional: false,
    waitForHuman: false,
    includeContext: true,
    outputType: 'plan',
  };
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message;
}

export interface StepEditorProps {
  api: Api;
  step: PipelineStep;
  index: number;
  total: number;
  writer: boolean;
  onChange: (s: PipelineStep) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
}

export default function StepEditor({
  api,
  step,
  index,
  total,
  writer,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: StepEditorProps) {
  const [showPromptBody, setShowPromptBody] = useState(false);
  const [newPromptMode, setNewPromptMode] = useState(false);
  const [newPromptKey, setNewPromptKey] = useState('');
  const [newPromptBody, setNewPromptBody] = useState('');
  const [newPromptError, setNewPromptError] = useState('');

  const { data: promptsData } = usePrompts(api);
  const promptKeys = (promptsData?.prompts ?? []).map((p) => p.promptKey);
  // Keep a key that is not (yet) in the list selectable so it is never lost.
  const promptOptions =
    step.promptKey && !promptKeys.includes(step.promptKey) ? [step.promptKey, ...promptKeys] : promptKeys;

  // Debounce free-text prompt keys; starts at the current key so the first
  // reveal fetches immediately.
  const [debouncedPromptKey, setDebouncedPromptKey] = useState(step.promptKey);
  useEffect(() => {
    if (step.promptKey === debouncedPromptKey) return;
    const t = setTimeout(() => setDebouncedPromptKey(step.promptKey), 300);
    return () => clearTimeout(t);
  }, [step.promptKey, debouncedPromptKey]);

  const { data: promptData, isLoading: promptLoading } = usePrompt(
    api,
    showPromptBody ? debouncedPromptKey : ''
  );
  const createPromptMutation = useCreatePrompt(api);

  const isCustomModel = step.model !== '' && !KNOWN_MODELS.includes(step.model);
  const outputType = outputTypeOf(step);
  const fieldId = (name: string) => `step-${index}-${name}`;
  const hasControls = writer && (onMoveUp || onMoveDown || onRemove);

  return (
    <div className="step-editor card" data-testid="step-editor">
      <div className="cluster" style={{ marginBottom: 8 }}>
        <span className="badge badge-accent" style={{ fontSize: 11 }}>Step {index + 1}</span>
        <span className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>{step.stepId}</span>
        {hasControls && (
          <div className="cluster" style={{ marginLeft: 'auto', gap: 4 }}>
            {onMoveUp && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onMoveUp}
                disabled={index === 0} title="Move up" aria-label="Move step up">↑</button>
            )}
            {onMoveDown && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={onMoveDown}
                disabled={index === total - 1} title="Move down" aria-label="Move step down">↓</button>
            )}
            {onRemove && (
              <button className="btn btn-ghost btn-sm" type="button"
                style={{ color: 'var(--danger, #e53e3e)' }} onClick={onRemove}>Remove</button>
            )}
          </div>
        )}
      </div>

      {writer ? (
        <div className="form-grid">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor={fieldId('label')}>Label</label>
              <input id={fieldId('label')} className="form-input" value={step.label}
                onChange={(e) => onChange({ ...step, label: e.target.value })} placeholder="Step label" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={fieldId('model')}>Model</label>
              <select
                id={fieldId('model')}
                className="form-select"
                value={isCustomModel ? '__custom__' : (step.model || KNOWN_MODELS[0])}
                onChange={(e) =>
                  onChange({ ...step, model: e.target.value === '__custom__' ? '' : e.target.value })
                }
              >
                {KNOWN_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              {isCustomModel && (
                <input className="form-input" style={{ marginTop: 4 }} value={step.model}
                  aria-label="Custom model ID"
                  onChange={(e) => onChange({ ...step, model: e.target.value })}
                  placeholder="us.anthropic.claude-..." />
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor={fieldId('prompt')}>Prompt key</label>
              <div className="cluster" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {promptOptions.length > 0 ? (
                  <select id={fieldId('prompt')} className="form-select" style={{ flex: 1, minWidth: 0 }}
                    value={step.promptKey}
                    onChange={(e) => onChange({ ...step, promptKey: e.target.value })}>
                    <option value="">— select prompt —</option>
                    {promptOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                ) : (
                  <input id={fieldId('prompt')} className="form-input" style={{ flex: 1, minWidth: 0 }}
                    value={step.promptKey}
                    onChange={(e) => onChange({ ...step, promptKey: e.target.value })}
                    placeholder="functional-test-gen-default" />
                )}
                <button className="btn btn-ghost btn-sm" type="button" style={{ flexShrink: 0 }}
                  onClick={() => setNewPromptMode((p) => !p)}>
                  {newPromptMode ? 'Cancel' : '+ New prompt'}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={fieldId('output-type')}>Output type</label>
              <select id={fieldId('output-type')} className="form-select" value={outputType}
                onChange={(e) => onChange({ ...step, outputType: e.target.value as StepOutputType })}>
                {OUTPUT_TYPES.map((t) => <option key={t} value={t}>{OUTPUT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          {newPromptMode && (
            <div className="step-editor-subform">
              <p className="text-sm" style={{ marginBottom: 6, fontWeight: 500 }}>New prompt</p>
              <div className="form-group">
                <label className="form-label" htmlFor={fieldId('new-prompt-key')}>New prompt key</label>
                <input id={fieldId('new-prompt-key')} className="form-input" value={newPromptKey}
                  onChange={(e) => setNewPromptKey(e.target.value)} placeholder="my-prompt-key" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor={fieldId('new-prompt-body')}>Prompt body</label>
                <textarea id={fieldId('new-prompt-body')} className="form-textarea" rows={4}
                  value={newPromptBody} onChange={(e) => setNewPromptBody(e.target.value)} />
              </div>
              {newPromptError && <p className="form-error" role="alert">{newPromptError}</p>}
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={createPromptMutation.isPending || !newPromptKey || !newPromptBody}
                onClick={async () => {
                  setNewPromptError('');
                  try {
                    await createPromptMutation.mutateAsync({ promptKey: newPromptKey, body: newPromptBody });
                    onChange({ ...step, promptKey: newPromptKey });
                    setNewPromptMode(false);
                    setNewPromptKey('');
                    setNewPromptBody('');
                  } catch (err) {
                    setNewPromptError(errorMessage(err));
                  }
                }}
              >
                {createPromptMutation.isPending ? 'Creating…' : 'Create prompt'}
              </button>
            </div>
          )}

          <div className="cluster" style={{ gap: 16, flexWrap: 'wrap' }}>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={step.includeContext}
                onChange={(e) => onChange({ ...step, includeContext: e.target.checked })} />
              Include context
            </label>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={step.optional}
                onChange={(e) => onChange({ ...step, optional: e.target.checked })} />
              Optional
            </label>
            <label className="cluster" style={{ gap: 4, fontSize: 13, cursor: outputType === 'freeform' ? 'default' : 'pointer' }}
              title="Append runtime output-format instructions for this output type to the model input (off = baseline input)">
              <input type="checkbox" checked={step.outputInstructions === true}
                disabled={outputType === 'freeform'}
                onChange={(e) => onChange({ ...step, outputInstructions: e.target.checked })} />
              Output instructions
            </label>
          </div>
        </div>
      ) : (
        <dl className="meta-grid">
          {(
            [
              ['Label', step.label],
              ['Model', step.model],
              ['Prompt key', step.promptKey || '—'],
              ['Output type', outputType],
              ['Include context', step.includeContext ? 'Yes' : 'No'],
              ['Optional', step.optional ? 'Yes' : 'No'],
              ['Output instructions', step.outputInstructions ? 'On' : 'Off'],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt className="meta-key">{k}</dt>
              <dd className="meta-val"
                style={k === 'Model' || k === 'Prompt key' ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {step.promptKey && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" aria-expanded={showPromptBody}
            onClick={() => setShowPromptBody((p) => !p)}>
            {showPromptBody ? 'Hide prompt body' : 'View prompt body'}
          </button>
          {showPromptBody && (
            promptData?.body ? (
              <pre className="code-block step-editor-prompt" aria-label="prompt body">{promptData.body}</pre>
            ) : (
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                {promptLoading || debouncedPromptKey !== step.promptKey
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
