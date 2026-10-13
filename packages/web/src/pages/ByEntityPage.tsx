/**
 * ByEntityPage — entity table + contract detail panel (T-08).
 * Consumes ContractDataContext for entries and groups.
 */
import { useEffect, useState } from 'react';
import type { Api } from '../api.js';
import { useContractData } from '../contexts/ContractDataContext.js';

function statusBadge(status: string) {
  const map: Record<string, string> = {
    valid: 'badge-success', invalid: 'badge-danger',
    succeeded: 'badge-success', failed: 'badge-danger',
    running: 'badge-accent badge-pulse', pending: 'badge-muted',
  };
  return `badge ${map[status] ?? 'badge-muted'}`;
}

function Detail({ api, source, id }: { api: Api; source: string; id: string }) {
  const [data, setData] = useState<any>(null);
  const [yaml, setYaml] = useState<string>('');
  useEffect(() => { api.getContract(source, id).then(setData); }, [api, source, id]);
  if (!data) return <p className="loading">Loading…</p>;
  const e = data.entry ?? {};
  const meta: [string, unknown][] = [
    ['Entity', e.entity], ['Domain', e.domain], ['Name', e.name],
    ['Declared version', e.declaredVersion], ['Current version', e.currentVersion],
    ['Validation', e.validation], ['Source', e.source],
    ['Commit', e.commitSha], ['File', e.filePath], ['Last crawled', e.lastCrawledAt],
  ];
  return (
    <div>
      <h3 className="detail-heading">{source} / {id}</h3>
      <dl className="meta-grid" aria-label="metadata">
        {meta.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="meta-key">{k}</dt>
            <dd className="meta-val">
              {k === 'Validation'
                ? <span className={statusBadge(String(v))}>{String(v)}</span>
                : String(v)}
            </dd>
          </div>
        ))}
      </dl>
      {data.versions?.length > 0 && (
        <>
          <p className="section-heading">Version history</p>
          <ul className="row-list">
            {data.versions.map((v: any) => (
              <li key={v.versionNumber} className="row-btn" style={{ cursor: 'default' }}>
                <span className="row-label text-sm">v{v.versionNumber}</span>
                <span className="row-meta">{v.hash?.slice(0, 8)}</span>
                {v.versionNotBumped && <span className="badge badge-warning">version not bumped</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-12">
        <div className="cluster" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={async () => {
            if (yaml) { setYaml(''); } else { setYaml(await api.getRaw(source, id)); }
          }}>
            {yaml ? 'Hide YAML' : 'View YAML'}
          </button>
          {yaml && (
            <button className="btn btn-ghost btn-sm" title="Open in new tab" onClick={() => {
              const blob = new Blob([yaml], { type: 'text/plain' });
              window.open(URL.createObjectURL(blob), '_blank');
            }}>↗ Popout</button>
          )}
        </div>
        {yaml && <pre className="code-block" aria-label="yaml">{yaml}</pre>}
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: any }) {
  const d = diff.diff;
  return (
    <div aria-label="diff">
      <h3 className="detail-heading">
        {diff.entity} diff{' '}
        <span className={diff.divergent ? 'badge badge-warning' : 'badge badge-success'}>
          {diff.divergent ? 'divergent' : 'identical'}
        </span>
      </h3>
      {d && (
        <div className="stack">
          <div className="diff-row"><span className="diff-label">Only in publisher</span><span className="diff-val">{d.onlyInA.map((p: any) => p.path).join(', ') || '—'}</span></div>
          <div className="diff-row"><span className="diff-label">Only in consumer</span><span className="diff-val">{d.onlyInB.map((p: any) => p.path).join(', ') || '—'}</span></div>
          <div className="diff-row"><span className="diff-label">Changed</span><span className="diff-val">{d.changed.map((c: any) => `${c.path}.${c.field}`).join(', ') || '—'}</span></div>
        </div>
      )}
    </div>
  );
}

export default function ByEntityPage({ api }: { api: Api }) {
  const { groups, loading, error } = useContractData();
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);
  const [diff, setDiff] = useState<any>(null);

  if (loading) return <p className="loading">Loading…</p>;
  if (error) return <p className="alert alert-danger" role="alert">Error: {error}</p>;

  return (
    <div className="app-body">
      <div className="app-main">
        <div>
          {groups.map((g) => (
            <div key={g.entity} className="entity-group">
              <div className="entity-header">
                <span className="entity-name">{g.entity}</span>
                {g.divergent && (
                  <>
                    <span className="badge badge-warning" data-testid="divergent">divergent</span>
                    <button className="btn btn-ghost btn-sm"
                      onClick={async () => { const r = await api.getEntity(g.entity); setDiff(r); }}>
                      Show {g.entity} diff
                    </button>
                  </>
                )}
              </div>
              <ul className="entity-variants">
                {g.variants.map((v) => (
                  <li key={v.source}>
                    <button className="row-btn"
                      aria-pressed={selected?.source === v.source && selected?.id === v.id}
                      onClick={() => setSelected({ source: v.source, id: v.id })}>
                      <span className="row-label">{v.domain ?? v.source}</span>
                      <span className="row-meta">v{v.currentVersion}</span>
                      <span className={statusBadge(v.validation)}>{v.validation}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {(selected || diff) && (
        <aside className="app-panel">
          {selected && <Detail key={`${selected.source}/${selected.id}`} api={api} source={selected.source} id={selected.id} />}
          {diff && <div className="mt-16"><DiffView diff={diff} /></div>}
        </aside>
      )}
    </div>
  );
}
