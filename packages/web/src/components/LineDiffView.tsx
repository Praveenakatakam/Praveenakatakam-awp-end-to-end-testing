/**
 * LineDiffView — LCS line diff (lib.ts `lineDiff`) of two texts with +/− counts
 * (R-70). Shared by the run-level and experiment-level compare pages.
 */
import { useMemo } from 'react';
import { lineDiff } from '../lib.js';

export default function LineDiffView({ a, b, label = 'artifact diff' }: { a: string; b: string; label?: string }) {
  const lines = useMemo(() => lineDiff(a, b), [a, b]);
  const added = lines.filter((l) => l.op === 'add').length;
  const removed = lines.filter((l) => l.op === 'remove').length;
  return (
    <div aria-label={label}>
      <p className="text-sm" style={{ marginBottom: 6 }}>
        <span className="diff-add-count">+{added}</span> <span className="diff-remove-count">−{removed}</span>
        {added === 0 && removed === 0 && <span className="text-muted"> — identical</span>}
      </p>
      <pre className="code-block line-diff" style={{ height: 'auto', maxHeight: '70vh' }}>
        {lines.map((l, i) => (
          <div key={i} className={`diff-line diff-${l.op}`} data-op={l.op}>
            {l.op === 'add' ? '+ ' : l.op === 'remove' ? '- ' : '  '}{l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
