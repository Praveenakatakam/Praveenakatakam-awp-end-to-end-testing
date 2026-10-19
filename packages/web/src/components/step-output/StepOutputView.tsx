/**
 * StepOutputView — dispatches a step output string to the renderer for its
 * output type (R-77). Unparseable structured output falls back to raw text
 * with a notice.
 */
import type { StepOutputType } from '@registry/core';
import { parseCritique, parsePlan } from '../../lib.js';
import PlanView from './PlanView.js';
import CritiqueView from './CritiqueView.js';

export function RawText({ text, label = 'raw output' }: { text: string; label?: string }) {
  return (
    <pre className="code-block code-block-auto" aria-label={label} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </pre>
  );
}

export default function StepOutputView({ outputType, output }: { outputType: StepOutputType; output: string | null }) {
  if (output === null) return <p className="text-muted text-sm">This step produced no output.</p>;

  if (outputType === 'plan') {
    const plan = parsePlan(output);
    if (plan) return <PlanView plan={plan} />;
  } else if (outputType === 'critique') {
    const critique = parseCritique(output);
    if (critique) return <CritiqueView critique={critique} />;
  } else {
    return <RawText text={output} label="step output" />;
  }

  return (
    <>
      <p className="alert alert-warning" role="note">
        Output could not be parsed as a {outputType} — showing raw text.
      </p>
      <RawText text={output} label="step output" />
    </>
  );
}
