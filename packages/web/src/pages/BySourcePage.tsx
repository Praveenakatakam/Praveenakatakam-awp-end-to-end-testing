/**
 * BySourcePage — contracts grouped by source repository with a detail panel.
 * Extracted from App.tsx's view === 'source' branch (T-09).
 *
 * Detail and statusBadge are copied locally here. Once a shared components
 * module is extracted (e.g. packages/web/src/components/Detail.tsx), replace
 * these local copies with imports from that module.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Api } from '../api.js';
import { groupBySource } from '../lib.js';
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

export default function BySourcePage({ api }: { api: Api }) {
  const { entries } = useContractData();
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);

  const sourceGroups = useMemo(() => groupBySource(entries), [entries]);

  return (
    <div className="app-body">
      <div className="app-main">
        <div aria-label="by-source">
          {sourceGroups.map((sg) => (
            <div key={sg.source}>
              <h3 className="section-heading">{sg.source}</h3>
              <ul className="row-list">
                {sg.contracts.map((c) => (
                  <li key={c.id}>
                    <button
                      className="row-btn"
                      aria-pressed={selected?.source === c.source && selected?.id === c.id}
                      onClick={() => setSelected({ source: c.source, id: c.id })}
                    >
                      {c.entity} v{c.currentVersion} ({c.validation})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <aside className="app-panel">
          <Detail
            key={`${selected.source}/${selected.id}`}
            api={api}
            source={selected.source}
            id={selected.id}
          />
        </aside>
      )}
    </div>
  );
}
