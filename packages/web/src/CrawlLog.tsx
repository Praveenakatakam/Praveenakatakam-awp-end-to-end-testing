export function CrawlLog({ summary }: { summary: any }) {
  const duration = summary.startedAt && summary.endedAt
    ? ((new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1000).toFixed(1)
    : null;
  return (
    <div className="crawl-log" aria-label="crawl log">
      <p style={{ marginBottom: 6, color: 'var(--success)' }}>
        ✓ Crawl done{duration ? ` in ${duration}s` : ''} · run {summary.runId}
      </p>
      {summary.sources?.map((s: any) => (
        <details key={s.label} open>
          <summary>
            {s.outcome === 'failed' ? '✗' : '✓'}{' '}
            <strong style={{ color: 'var(--text)' }}>{s.label}</strong>
            {` (${s.branch}:${s.pathPrefix ?? '/'})`}
            {s.outcome === 'success' && ` — ${s.discovered} discovered · ${s.valid} valid · ${s.invalid} invalid`}
            {s.outcome === 'failed' && ` — failed: ${s.reason}`}
          </summary>
          {s.outcome === 'success' && (
            <ul>
              <li>new versions: {s.newVersion} · unchanged: {s.unchanged}</li>
              {s.requirements && !s.requirements.failed && (
                <li>requirements: {s.requirements.discovered} discovered · {s.requirements.conforming} conforming · {s.requirements.nonConforming} non-conforming · {s.requirements.changed} changed · {s.requirements.removed} removed</li>
              )}
              {s.requirements?.failed && <li>⚠ requirements failed: {s.requirements.reason}</li>}
            </ul>
          )}
        </details>
      ))}
      {summary.collisions?.length > 0 && (
        <details>
          <summary>⚠ {summary.collisions.length} id collision(s)</summary>
          <ul>{summary.collisions.map((c: any, i: number) => <li key={i}>{c.source} / {c.id}: {c.paths.join(', ')}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
