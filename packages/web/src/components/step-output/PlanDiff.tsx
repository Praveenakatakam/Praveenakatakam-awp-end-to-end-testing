/**
 * PlanDiff — field-level changes of a plan against an earlier plan step in the
 * same run (R-77 Changes tab). Pure diffing lives in `diffPlans` (lib.ts).
 */
import { diffPlans } from '../../lib.js';

export default function PlanDiff({ before, after, againstLabel }: {
  before: unknown;
  after: unknown;
  /** Describes the earlier step being compared against, e.g. `STEP #00 · Plan`. */
  againstLabel: string;
}) {
  const changes = diffPlans(before, after);
  const added = changes.filter((c) => c.kind === 'added').length;
  const removed = changes.filter((c) => c.kind === 'removed').length;
  const changed = changes.filter((c) => c.kind === 'changed').length;

  return (
    <div aria-label="plan changes">
      <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
        Compared with <strong>{againstLabel}</strong>:{' '}
        <span className="diff-add-count">+{added}</span>{' '}
        <span className="diff-remove-count">−{removed}</span>{' '}
        <span className="diff-change-count">~{changed}</span>
      </p>
      {changes.length === 0 ? (
        <p className="text-muted text-sm">No changes — the plans are identical.</p>
      ) : (
        <ul className="plan-diff">
          {changes.map((c, i) => (
            <li key={i} className={`plan-diff-item plan-diff-${c.kind}`} data-kind={c.kind}>
              <span className="plan-diff-field mono">{c.field}</span>
              <span className="plan-diff-kind">{c.kind}</span>
              <div className="plan-diff-values">
                {c.before !== undefined && <div className="plan-diff-before"><span aria-hidden>− </span>{c.before}</div>}
                {c.after !== undefined && <div className="plan-diff-after"><span aria-hidden>+ </span>{c.after}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
