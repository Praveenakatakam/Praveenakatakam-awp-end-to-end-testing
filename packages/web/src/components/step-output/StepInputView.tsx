/**
 * StepInputView — exactly what a step sent to the model (R-74, R-77): system
 * prompt (key, version, body) and each user-message section as a collapsible
 * block, with a notice when prior outputs were truncated.
 */
import { Link } from 'react-router-dom';
import type { StepInputSnapshot } from '@registry/core';

export default function StepInputView({ input }: { input: StepInputSnapshot | null }) {
  if (!input) {
    return (
      <p className="text-muted text-sm" role="note">
        Input not recorded — this step ran before input snapshots were captured (v0.5.0).
      </p>
    );
  }
  const { systemPrompt } = input;

  return (
    <div aria-label="step input">
      <dl className="meta-grid">
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Model</dt>
          <dd className="meta-val mono">{input.model}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Output type</dt>
          <dd className="meta-val">{input.outputType}</dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Tool</dt>
          <dd className="meta-val mono">
            {input.tool ? `${input.tool.name} (${input.tool.schemaVersion})` : 'none (freeform)'}
          </dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt className="meta-key">Output instructions</dt>
          <dd className="meta-val">{input.instructionsVersion ?? 'off (baseline input)'}</dd>
        </div>
      </dl>

      {input.priorOutputsTruncated && (
        <p className="alert alert-warning" role="note">
          Prior step outputs were truncated to fit the context budget — oldest outputs were cut first.
        </p>
      )}

      <p className="section-heading">System prompt</p>
      <details className="input-block" open>
        <summary>
          <Link to={`/prompts/${encodeURIComponent(systemPrompt.promptKey)}`} className="mono">
            {systemPrompt.promptKey}@v{systemPrompt.version}
          </Link>
          <span className="input-block-meta">{systemPrompt.body.length.toLocaleString()} chars</span>
        </summary>
        <pre className="code-block code-block-auto" aria-label="system prompt body">{systemPrompt.body}</pre>
      </details>

      <p className="section-heading">User message ({input.sections.length} sections)</p>
      {input.sections.map((section, i) => (
        <details key={`${i}-${section.name}`} className="input-block" aria-label={`section ${section.name}`}>
          <summary>
            <span>{section.name}</span>
            <span className="input-block-meta">{section.text.length.toLocaleString()} chars</span>
          </summary>
          <pre className="code-block code-block-auto">{section.text}</pre>
        </details>
      ))}
    </div>
  );
}
