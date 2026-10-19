/**
 * Shared experiment helpers for the Experiments hub and Compare page (R-88, R-90):
 * the `<kind>:<id>` URL reference, the kind badge, and status badge classes.
 */
import type { ExperimentKind } from '@registry/core';

/** `<kind>:<id>` ⇄ `{ kind, id }` — the URL form used by the hub and Compare (R-90). */
export function parseExperimentRef(ref: string | null): { kind: ExperimentKind; id: string } | null {
  if (!ref) return null;
  const i = ref.indexOf(':');
  if (i < 0) return null;
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if ((kind !== 'pipeline' && kind !== 'legacy') || !id) return null;
  return { kind, id };
}
export const experimentRef = (e: { kind: ExperimentKind; id: string }) => `${e.kind}:${e.id}`;

export function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    completed: 'badge-success', succeeded: 'badge-success', cached: 'badge-success', valid: 'badge-success',
    completed_with_warnings: 'badge-warning', warning: 'badge-warning',
    failed: 'badge-danger', timed_out: 'badge-danger', invalid: 'badge-danger',
    running: 'badge-accent badge-pulse', pending: 'badge-muted',
  };
  return `badge ${map[status] ?? 'badge-muted'}`;
}

export function KindBadge({ kind }: { kind: ExperimentKind }) {
  return (
    <span className={`badge ${kind === 'legacy' ? 'badge-warning' : 'badge-accent'}`} data-testid="kind-badge">
      {kind}
    </span>
  );
}
