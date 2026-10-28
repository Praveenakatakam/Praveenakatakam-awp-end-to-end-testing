import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { isWriter } from '../lib.js';

type ExperimentRecord = Awaited<ReturnType<Api['getExperiment']>>;
type PromptVersionSummary = Awaited<ReturnType<Api['listPromptVersions']>>['promptVersions'][number];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    valid: 'badge-success', invalid: 'badge-danger',
    succeeded: 'badge-success', failed: 'badge-danger',
    running: 'badge-accent badge-pulse', pending: 'badge-muted',
  };
  return `badge ${map[status] ?? 'badge-muted'}`;
}

const KNOWN_MODELS = [
  'us.anthropic.claude-sonnet-4-6',
];

function NewPromptVersionForm({ api, onCreated }: { api: Api; onCreated: () => void }) {
  const [promptVersion, setPromptVersion] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelCustom, setModelCustom] = useState(false);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="card">
      <p className="card-title">New Prompt Version</p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await api.createPromptVersion({ promptVersion, modelId, text, notes: notes || undefined });
            setPromptVersion(''); setModelId(''); setModelCustom(false); setText(''); setNotes('');
            onCreated();
          } catch (err: any) {
            setError(err?.status === 409 ? 'Version already exists' : (err as Error).message);
          }
        }}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="npv-version">Version ID</label>
            <input id="npv-version" className="form-input" value={promptVersion} onChange={(e) => setPromptVersion(e.target.value)} placeholder="v2-concise" required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="npv-model">Model ID</label>
            <select id="npv-model" className="form-select"
              value={modelCustom ? 'custom' : modelId}
              onChange={(e) => {
                if (e.target.value === 'custom') { setModelCustom(true); setModelId(''); }
                else { setModelCustom(false); setModelId(e.target.value); }
              }}
              required={!modelCustom}
            >
              <option value="">— select model —</option>
              {KNOWN_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {modelCustom && (
              <input className="form-input" style={{ marginTop: 6 }}
                value={modelId} onChange={(e) => setModelId(e.target.value)}
                placeholder="e.g. us.anthropic.claude-..." required />
            )}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="npv-text">Prompt text</label>
          <textarea id="npv-text" className="form-textarea" value={text} onChange={(e) => setText(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="npv-notes">Notes (optional)</label>
          <input id="npv-notes" className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed in this version?" />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div><button className="btn btn-primary" type="submit">Create</button></div>
      </form>
    </div>
  );
}

function NewExperimentForm({ api, versions, onCreated }: { api: Api; versions: PromptVersionSummary[]; onCreated: (experimentId: string) => void }) {
  const [selectedVersion, setSelectedVersion] = useState('');
  return (
    <div className="card">
      <p className="card-title">Run Experiment</p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selectedVersion) return;
          const result = await api.createExperiment({ promptVersion: selectedVersion });
          onCreated(result.experimentId);
        }}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="nef-prompt-version">Prompt version</label>
          <select id="nef-prompt-version" className="form-select" value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} required>
            <option value="">— select a version —</option>
            {versions.map((v) => (
              <option key={v.promptVersion} value={v.promptVersion}>
                {v.promptVersion} · {v.modelId}
              </option>
            ))}
          </select>
        </div>
        <div><button className="btn btn-primary" type="submit" disabled={!selectedVersion}>Run experiment</button></div>
      </form>
    </div>
  );
}

function ExperimentComparison({ api, experimentId }: { api: Api; experimentId: string }) {
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [artifact, setArtifact] = useState<{ planCount?: number; skipCount?: number; artifact: unknown } | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      const data = await api.getExperiment(experimentId);
      if (!active) return;
      setExperiment(data);
      if (data.status === 'succeeded') {
        const art = await api.getExperimentArtifact(experimentId);
        if (active) setArtifact(art);
      }
    }
    poll();
    const id = setInterval(async () => {
      const data = await api.getExperiment(experimentId);
      if (!active) return;
      setExperiment(data);
      if (data.status === 'succeeded' || data.status === 'failed') {
        clearInterval(id);
        if (data.status === 'succeeded') {
          const art = await api.getExperimentArtifact(experimentId);
          if (active) setArtifact(art);
        }
      }
    }, 5000);
    return () => { active = false; clearInterval(id); };
  }, [api, experimentId]);

  if (!experiment) return <p className="loading">Loading…</p>;

  const manifest = artifact && (artifact.artifact as any)?.manifest;
  const plans = manifest && Array.isArray(manifest.plans) ? manifest.plans as any[] : null;
  const skipped = manifest && Array.isArray(manifest.skipped) ? manifest.skipped as { requirement: string; reason: string }[] : null;

  return (
    <div className="card" aria-label="experiment detail">
      <div className="cluster" style={{ marginBottom: 12 }}>
        <p className="detail-heading" style={{ marginBottom: 0 }}>Experiment</p>
        <span className={statusBadge(experiment.status)}>{experiment.status}</span>
      </div>
      <dl className="meta-grid">
        {[['Prompt version', experiment.promptVersion], ['Created', new Date(experiment.createdAt).toLocaleString()], ['Created by', experiment.createdBy]].map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt className="meta-key">{k}</dt>
            <dd className="meta-val">{v}</dd>
          </div>
        ))}
      </dl>
      {(experiment.status === 'pending' || experiment.status === 'running') && (
        <p className="alert alert-info" role="status" aria-live="polite">Running… polling every 5s</p>
      )}
      {experiment.status === 'failed' && (
        <p className="alert alert-danger" role="alert">Error: {experiment.error ?? 'Unknown error'}</p>
      )}
      {experiment.status === 'succeeded' && artifact && (
        <div className="mt-12">
          <div className="cluster" style={{ marginBottom: 8 }}>
            <span className="badge badge-success">{artifact.planCount ?? 0} plans</span>
            <span className="badge badge-muted">{artifact.skipCount ?? 0} skipped</span>
          </div>
          {(artifact.planCount ?? 0) === 0 && (artifact.skipCount ?? 0) === 0 && (
            <p className="alert alert-info" style={{ marginTop: 8 }}>
              No plans generated — catalog may be empty. Use Refresh to crawl contracts first, then re-run.
            </p>
          )}
          {skipped && skipped.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="text-muted text-sm" style={{ cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}>
                {skipped.length} skipped requirement{skipped.length !== 1 ? 's' : ''} — click to see reasons
              </summary>
              <ul className="row-list" style={{ marginTop: 6 }}>
                {skipped.map((s, i) => (
                  <li key={i} style={{ padding: '6px 8px', fontSize: 13 }}>
                    <span className="row-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.requirement}</span>
                    <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {plans && plans.length > 0 && (
            <ul className="row-list" style={{ marginTop: 8 }}>
              {plans.map((plan: any, i: number) => {
                const label = plan.title ?? plan.summary ?? plan.name ?? `Plan ${i + 1}`;
                const pretty = JSON.stringify(plan, null, 2);
                const open = expandedPlan === i;
                return (
                  <li key={i}>
                    <button className="row-btn" onClick={() => setExpandedPlan(open ? null : i)} style={{ width: '100%', textAlign: 'left' }}>
                      <span className="row-label">{label}</span>
                      <span className="badge badge-muted" style={{ fontSize: 11 }}>{open ? '▲' : '▼'}</span>
                    </button>
                    {open && (
                      <div style={{ padding: '8px 0 4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => {
                            const blob = new Blob([pretty], { type: 'application/json' });
                            window.open(URL.createObjectURL(blob), '_blank');
                          }}>↗ Popout</button>
                        </div>
                        <pre style={{
                          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                          padding: '10px', fontSize: '12px', color: 'var(--text)', overflowX: 'hidden',
                          overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: '50vh', fontFamily: 'var(--font-mono)',
                        }}>{pretty}</pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function PromptVersionDetail({ api, version }: { api: Api; version: string }) {
  const [record, setRecord] = useState<any>(null);
  useEffect(() => { api.getPromptVersion(version).then(setRecord); }, [api, version]);
  if (!record) return <p className="loading">Loading…</p>;
  return (
    <div>
      <h3 className="detail-heading">{record.promptVersion}</h3>
      <dl className="meta-grid">
        {[['Model', record.modelId], ['Created', new Date(record.createdAt).toLocaleString()], ['Created by', record.createdBy], ['Notes', record.notes ?? '—']].map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}><dt className="meta-key">{k}</dt><dd className="meta-val">{v}</dd></div>
        ))}
      </dl>
      {record.text && (
        <>
          <p className="section-heading" style={{ marginTop: 16 }}>Prompt text</p>
          <pre className="code-block" aria-label="prompt text" style={{ height: 'auto', maxHeight: '60vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{record.text}</pre>
        </>
      )}
    </div>
  );
}

export default function ExperimentsPage({ api, token }: { api: Api; token: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  // Derive current tab from the URL path.
  // /experiments/prompt-versions → 'prompts'
  // /experiments/run, /experiments/compare, or anything else → 'experiments'
  const promptTab: 'experiments' | 'prompts' = location.pathname.includes('prompt-versions')
    ? 'prompts'
    : 'experiments';

  async function refreshExperiments() { const r = await api.listExperiments(); setExperiments(r.experiments); }
  async function refreshVersions()    { const r = await api.listPromptVersions(); setVersions(r.promptVersions); }

  useEffect(() => { refreshExperiments(); refreshVersions(); }, [api]);

  // Poll the list while any experiment is pending/running so status badges update automatically.
  useEffect(() => {
    const hasActive = experiments.some(e => e.status === 'pending' || e.status === 'running');
    if (!hasActive) return;
    const id = setInterval(() => refreshExperiments(), 5000);
    return () => clearInterval(id);
  }, [experiments]);

  function toggleSelect(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id)
        : prev.length >= 2 ? [prev[1], id]
        : [...prev, id]
    );
  }

  const showPanel = promptTab === 'experiments' ? selectedIds.length > 0 : selectedVersion !== null;

  return (
    <div className="app-body" aria-label="experiments">
      <div className="app-main">
        <h3 className="section-heading" style={{ marginBottom: 12 }}>Experiments</h3>
        {isWriter(token) && (
          <div className="experiments-grid">
            <NewPromptVersionForm api={api} onCreated={() => refreshVersions()} />
            <NewExperimentForm api={api} versions={versions} onCreated={(id) => { refreshExperiments(); setSelectedIds([id]); navigate('/experiments/run'); }} />
          </div>
        )}

        <div className="cluster mt-12" style={{ borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          {(['experiments', 'prompts'] as const).map(t => (
            <button key={t} className="app-nav-btn" aria-pressed={promptTab === t} disabled={promptTab === t}
              onClick={() => navigate(t === 'experiments' ? '/experiments/run' : '/experiments/prompt-versions')}>
              {{ experiments: 'Experiment runs', prompts: 'Prompt versions' }[t]}
            </button>
          ))}
        </div>

        {promptTab === 'experiments' ? (
          <>
            {selectedIds.length > 0 && <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              {selectedIds.length === 1 ? 'Click another to compare side-by-side' : 'Showing 2 experiments — click a third to replace the oldest'}
            </p>}
            {experiments.length === 0
              ? <p className="text-muted text-sm">No experiments yet.</p>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {experiments.map((exp) => (
                    <button key={exp.experimentId} className="exp-row"
                      aria-pressed={selectedIds.includes(exp.experimentId)}
                      onClick={() => toggleSelect(exp.experimentId)}>
                      <div className="exp-row-info">
                        <div className="exp-row-ver">{exp.promptVersion}</div>
                        <div className="exp-row-id">{exp.experimentId}</div>
                      </div>
                      <span className={statusBadge(exp.status)}>{exp.status}</span>
                      <span className="exp-row-time">{new Date(exp.createdAt).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              )
            }
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {versions.length === 0
              ? <p className="text-muted text-sm">No prompt versions yet.</p>
              : versions.map((v) => (
                <button key={v.promptVersion} className="exp-row" style={{ textAlign: 'left' }}
                  aria-pressed={selectedVersion === v.promptVersion}
                  onClick={() => setSelectedVersion(prev => prev === v.promptVersion ? null : v.promptVersion)}>
                  <div className="exp-row-info">
                    <div className="exp-row-ver">{v.promptVersion}</div>
                    <div className="exp-row-id">{v.modelId}</div>
                  </div>
                  <span className="exp-row-time">{new Date(v.createdAt).toLocaleString()}</span>
                </button>
              ))
            }
          </div>
        )}
      </div>

      {showPanel && (
        <aside className="app-panel" style={promptTab === 'experiments' && selectedIds.length === 2 ? { width: '60vw', maxWidth: '70vw' } : {}}>
          {promptTab === 'experiments' ? (
            selectedIds.length === 2 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {selectedIds.map(id => <ExperimentComparison key={id} api={api} experimentId={id} />)}
              </div>
            ) : (
              <ExperimentComparison api={api} experimentId={selectedIds[0]} />
            )
          ) : (
            selectedVersion && <PromptVersionDetail api={api} version={selectedVersion} />
          )}
        </aside>
      )}
    </div>
  );
}
