import { useEffect, useState } from 'react';
import { groupRequirementsBySection, type RequirementEntry } from '../lib.js';
import type { Api } from '../api.js';

export default function RequirementsPage({ api }: { api: Api }) {
  const [reqs, setReqs] = useState<RequirementEntry[]>([]);
  const [selected, setSelected] = useState<RequirementEntry | null>(null);
  useEffect(() => { api.listRequirements().then(setReqs); }, [api]);
  const groups = groupRequirementsBySection(reqs);
  return (
    <div className="app-body" aria-label="requirements">
      <div className="app-main">
        {groups.map((sg) => (
          <div key={sg.source}>
            <h3 className="section-heading">{sg.source}</h3>
            {sg.sections.map((sec) => (
              <div key={sec.section} className="mt-8">
                <h4 className="text-muted text-sm" style={{ marginBottom: 4, fontWeight: 500 }}>{sec.section}</h4>
                <ul className="row-list">
                  {sec.requirements.map((r) => (
                    <li key={r.id}>
                      <button className="req-item" style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }} onClick={() => setSelected(r)}>
                        <span className="req-id">{r.id}</span>
                        <span className="req-text">{r.text}</span>
                        <div className="req-tags">
                          <span className="badge badge-accent">{r.earsType}</span>
                          {r.modality && <span className="badge badge-muted">{r.modality}</span>}
                          {!r.earsConforming && <span className="badge badge-warning" data-testid="non-conforming">non-conforming</span>}
                          {r.changedInLastCrawl && <span className="badge badge-success" data-testid="changed">changed</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
      {selected && (
        <aside className="app-panel" aria-label="requirement-detail">
          <h3 className="detail-heading">{selected.source} / {selected.id}</h3>
          <dl className="meta-grid">
            {[['Section', selected.section], ['EARS type', selected.earsType], ['Modality', selected.modality ?? 'none'], ['Conforming', String(selected.earsConforming)]].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="meta-key">{k}</dt>
                <dd className="meta-val">{v}</dd>
              </div>
            ))}
          </dl>
          {(() => {
            const raw = (selected as any).text;
            let pretty: string;
            let isJson = false;
            if (raw !== null && raw !== undefined && typeof raw === 'object') {
              pretty = JSON.stringify(raw, null, 2); isJson = true;
            } else {
              const str = String(raw ?? '').trim();
              // Try full parse first (single JSON value)
              try { pretty = JSON.stringify(JSON.parse(str), null, 2); isJson = true; }
              catch {
                // Try NDJSON: every non-empty line is its own JSON object
                const nonEmpty = str.split('\n').filter(l => l.trim());
                const allJson = nonEmpty.length > 1 &&
                  nonEmpty.every(l => { const t = l.trim(); return t.startsWith('{') || t.startsWith('['); });
                if (allJson) {
                  try {
                    pretty = nonEmpty.map(l => JSON.stringify(JSON.parse(l.trim()), null, 2)).join('\n\n');
                    isJson = true;
                  } catch { pretty = str; }
                } else {
                  pretty = str;
                }
              }
            }
            return (
              <div className="mt-8">
                <div className="cluster" style={{ marginBottom: 6 }}>
                  <p className="section-heading" style={{ margin: 0 }}>Text</p>
                  <button className="btn btn-ghost btn-sm" title="Open in new tab" onClick={() => {
                    const blob = new Blob([pretty], { type: isJson ? 'application/json' : 'text/plain' });
                    window.open(URL.createObjectURL(blob), '_blank');
                  }}>↗ Popout</button>
                </div>
                <pre style={{
                  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: '12px', fontSize: '13px', color: 'var(--text)', overflowX: 'hidden',
                  overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: '60vh', marginTop: 8,
                  fontFamily: isJson ? 'var(--font-mono)' : 'var(--font)',
                }}>{pretty}</pre>
              </div>
            );
          })()}
        </aside>
      )}
    </div>
  );
}
