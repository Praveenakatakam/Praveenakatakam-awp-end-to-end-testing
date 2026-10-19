/**
 * PlanView — a `plan` step output rendered as labelled sections (R-77):
 * rationale, setup, trigger (with example payload), propagation, assertions,
 * negative cases.
 */
import type { PlanView as Plan } from '../../lib.js';

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (value === undefined || value === '') return null;
  return (
    <div style={{ display: 'contents' }}>
      <dt className="meta-key">{label}</dt>
      <dd className="meta-val" style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{value}</dd>
    </div>
  );
}

/** Pretty-print the example payload when it is JSON; otherwise show as-is. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export default function PlanView({ plan }: { plan: Plan }) {
  const { trigger, propagation } = plan;
  const setup = plan.setup ?? [];
  const negativeCases = plan.negativeCases ?? [];
  const hasFieldChecks = plan.assertions.some((a) => a.field !== undefined || a.expected !== undefined);

  return (
    <div className="plan-view" aria-label="plan output">
      {plan.title && <p className="card-title" style={{ marginBottom: 4 }}>{plan.title}</p>}
      {plan.requirementIds && plan.requirementIds.length > 0 && (
        <p className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
          {plan.requirementIds.join(', ')}
        </p>
      )}

      <section aria-label="rationale">
        <p className="section-heading">Rationale</p>
        {plan.rationale ? <p className="prose">{plan.rationale}</p> : <p className="text-muted text-sm">Not provided (v1 plan).</p>}
      </section>

      <section aria-label="setup">
        <p className="section-heading">Setup</p>
        {setup.length === 0 ? (
          <p className="text-muted text-sm">None.</p>
        ) : (
          <ol className="plan-list">
            {setup.map((s, i) => <li key={i}>{s.description}</li>)}
          </ol>
        )}
      </section>

      <section aria-label="trigger">
        <p className="section-heading">Trigger</p>
        <p className="plan-endpoint">
          <span className="badge badge-muted">{trigger.method ?? '?'}</span>{' '}
          <code>{trigger.path ?? '?'}</code>
        </p>
        <dl className="meta-grid" style={{ marginBottom: 8 }}>
          <Field label="Source" value={trigger.source} mono />
          <Field label="Entity" value={trigger.entity} mono />
          <Field label="Payload shape" value={trigger.payloadShape} />
        </dl>
        {trigger.examplePayload && (
          <>
            <p className="text-muted text-sm">Example payload</p>
            <pre className="code-block code-block-auto" aria-label="example payload">{prettyJson(trigger.examplePayload)}</pre>
          </>
        )}
      </section>

      {propagation && (
        <section aria-label="propagation">
          <p className="section-heading">Propagation</p>
          <dl className="meta-grid">
            <Field label="Kind" value={propagation.kind} />
            <Field label="Channel" value={propagation.channel} mono />
            <Field label="Wait for" value={propagation.waitFor} />
          </dl>
        </section>
      )}

      <section aria-label="assertions">
        <p className="section-heading">Assertions ({plan.assertions.length})</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Assertion</th>
              {hasFieldChecks && <th>Field</th>}
              {hasFieldChecks && <th>Expected</th>}
            </tr>
          </thead>
          <tbody>
            {plan.assertions.map((a, i) => (
              <tr key={i}>
                <td className="mono">{a.service}</td>
                <td>{a.assertion}</td>
                {hasFieldChecks && <td className="mono">{a.field ?? ''}</td>}
                {hasFieldChecks && <td className="mono">{a.expected ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="negative cases">
        <p className="section-heading">Negative cases ({negativeCases.length})</p>
        {negativeCases.length === 0 ? (
          <p className="text-muted text-sm">None.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Description</th><th>Expected outcome</th></tr>
            </thead>
            <tbody>
              {negativeCases.map((n, i) => (
                <tr key={i}><td>{n.description}</td><td>{n.expectedOutcome}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
