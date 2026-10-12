/**
 * Registry SPA (T-14/T-15/T-17 · R-60..R-65).
 *  - login gate (native Cognito) → browse
 *  - catalog grouped by entity with a divergence flag (R-61, default view)
 *  - by-source view, toggleable with the by-entity view (R-65)
 *  - contract detail: metadata + version history + raw YAML (R-62)
 *  - per-property diff for divergent entities (R-63)
 *  - writer-only Refresh (R-64)
 */
import { useEffect, useMemo, useState } from 'react';
import { signIn, signOut, currentToken } from './auth.js';
import { createApi, type Api } from './api.js';
import { groupByEntity, applyEntityDivergence, groupBySource, groupRequirementsBySection, isWriter, type Entry, type EntityGroup, type RequirementEntry } from './lib.js';
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

function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <h1>E2E Testing Registry</h1>
        <h2 className="subtitle">Sign in</h2>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try { onToken(await signIn(username, password)); }
            catch (err) { setError((err as Error).message); }
          }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <input id="username" className="form-input" aria-label="username"
              value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input id="password" className="form-input" aria-label="password" type="password"
              value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
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

function RequirementsView({ api }: { api: Api }) {
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

function CrawlLog({ summary }: { summary: any }) {
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

function ExperimentsView({ api, token }: { api: Api; token: string }) {
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [versions, setVersions] = useState<PromptVersionSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<'experiments' | 'prompts'>('experiments');

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
            <NewExperimentForm api={api} versions={versions} onCreated={(id) => { refreshExperiments(); setSelectedIds([id]); setPromptTab('experiments'); }} />
          </div>
        )}

        <div className="cluster mt-12" style={{ borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          {(['experiments', 'prompts'] as const).map(t => (
            <button key={t} className="app-nav-btn" aria-pressed={promptTab === t} disabled={promptTab === t} onClick={() => setPromptTab(t)}>
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

export default function App() {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<EntityGroup[]>([]);
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);
  const [diff, setDiff] = useState<any>(null);
  const [view, setView] = useState<'entity' | 'source' | 'requirements' | 'experiments'>('entity');
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlElapsed, setCrawlElapsed] = useState(0);
  const [crawlSummary, setCrawlSummary] = useState<any>(null);
  const [crawlError, setCrawlError] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (!crawlRunning) return;
    const t0 = Date.now();
    const id = setInterval(() => setCrawlElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [crawlRunning]);

  useEffect(() => { currentToken().then((t) => { setToken(t); setReady(true); }); }, []);

  const api = useMemo(() => token ? createApi(token) : undefined, [token]);

  async function load(t: string) {
    const a = createApi(t);
    const items = await a.listContracts();
    setEntries(items);
    const initial = groupByEntity(items);
    setGroups(initial);
    const multiVariant = initial.filter((g) => g.variants.length > 1);
    for (const g of multiVariant) {
      a.getEntity(g.entity).then((result) => {
        setGroups((prev) => applyEntityDivergence(prev, result));
      });
    }
  }
  useEffect(() => { if (token) load(token); }, [token]);

  async function runRefresh() {
    setCrawlRunning(true); setCrawlElapsed(0); setCrawlSummary(null); setCrawlError('');
    try { const summary = await api!.refresh(); setCrawlSummary(summary); await load(token!); }
    catch (err) { setCrawlError((err as Error).message); }
    finally { setCrawlRunning(false); }
  }

  if (!ready) return <p className="loading" style={{ padding: 40 }}>Loading…</p>;
  if (!token) return <SignIn onToken={setToken} />;

  const sourceGroups = groupBySource(entries);
  const writer = isWriter(token);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>E2E Testing Registry</h1>
        {crawlRunning && (
          <span className="badge badge-accent badge-pulse">Crawling… {crawlElapsed.toFixed(1)}s</span>
        )}
        {crawlError && <span className="badge badge-danger">Refresh failed</span>}
        {writer && (
          <button className="btn btn-ghost btn-sm" onClick={runRefresh} disabled={crawlRunning}>
            ↺ Refresh
          </button>
        )}
        <button className="btn btn-ghost btn-sm" title="Toggle light/dark mode" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { signOut(); setToken(undefined); }}>
          Sign out
        </button>
      </header>

      {crawlError && (
        <div style={{ padding: '0 20px' }}>
          <p className="alert alert-danger" role="alert">Refresh failed: {crawlError}</p>
        </div>
      )}
      {crawlSummary && <div style={{ padding: '0 20px' }}><CrawlLog summary={crawlSummary} /></div>}

      <nav className="app-nav" aria-label="view toggle">
        {(['entity', 'source', 'requirements', 'experiments'] as const).map((v) => (
          <button key={v} className="app-nav-btn"
            aria-pressed={view === v} disabled={view === v} onClick={() => setView(v)}>
            {{ entity: 'By entity', source: 'By source', requirements: 'Requirements', experiments: 'Experiments' }[v]}
          </button>
        ))}
      </nav>

      {view === 'experiments' ? (
        <ExperimentsView api={api!} token={token} />
      ) : view === 'requirements' ? (
        <RequirementsView api={api!} />
      ) : (
        <div className="app-body">
          <div className="app-main">
            {view === 'entity' ? (
              <div>
                {groups.map((g) => (
                  <div key={g.entity} className="entity-group">
                    <div className="entity-header">
                      <span className="entity-name">{g.entity}</span>
                      {g.divergent && (
                        <>
                          <span className="badge badge-warning" data-testid="divergent">divergent</span>
                          <button className="btn btn-ghost btn-sm"
                            onClick={async () => { const r = await api!.getEntity(g.entity); setGroups((p) => applyEntityDivergence(p, r)); setDiff(r); }}>
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
            ) : (
              <div aria-label="by-source">
                {sourceGroups.map((sg) => (
                  <div key={sg.source}>
                    <h3 className="section-heading">{sg.source}</h3>
                    <ul className="row-list">
                      {sg.contracts.map((c) => (
                        <li key={c.id}>
                          <button className="row-btn"
                            aria-pressed={selected?.source === c.source && selected?.id === c.id}
                            onClick={() => setSelected({ source: c.source, id: c.id })}>
                            {c.entity} v{c.currentVersion} ({c.validation})
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(selected || diff) && (
            <aside className="app-panel">
              {selected && <Detail key={`${selected.source}/${selected.id}`} api={api!} source={selected.source} id={selected.id} />}
              {diff && <div className="mt-16"><DiffView diff={diff} /></div>}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
