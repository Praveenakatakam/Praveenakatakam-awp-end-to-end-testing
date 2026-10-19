/**
 * SkippedRequirements — "N requirements skipped" disclosure for a run trigger
 * response (R-55, R-71). Renders nothing when the list is empty.
 */
import type { SkippedRequirement } from '@registry/core';

/**
 * Router state handed to RunDetailPage after a trigger, so the `skipped` list
 * (and sibling run ids) survive the navigation away from the pipeline page.
 */
export interface RunNavState {
  skipped: SkippedRequirement[];
  runIds: string[];
}

export default function SkippedRequirements({
  skipped,
  open = true,
}: {
  skipped: SkippedRequirement[] | undefined;
  open?: boolean;
}) {
  if (!skipped || skipped.length === 0) return null;
  const n = skipped.length;
  return (
    <details className="card skipped-requirements" open={open} aria-label="skipped requirements">
      <summary className="card-title" style={{ cursor: 'pointer', color: 'var(--warning)' }}>
        {n} requirement{n !== 1 ? 's' : ''} skipped (could not be grounded)
      </summary>
      <ul className="skipped-list">
        {skipped.map((s) => (
          <li key={s.requirement}>
            <code>{s.requirement}</code>
            <span className="text-muted text-sm"> — {s.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
