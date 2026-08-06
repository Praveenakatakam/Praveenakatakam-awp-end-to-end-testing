/**
 * Registry SPA (T-14/T-15/T-17 · R-60..R-65).
 *  - login gate (native Cognito) → browse
 *  - catalog grouped by entity with a divergence flag (R-61, default view)
 *  - by-source view, toggleable with the by-entity view (R-65)
 *  - contract detail: metadata + version history + raw YAML (R-62)
 *  - per-property diff for divergent entities (R-63)
 *  - writer-only Refresh (R-64)
 */
import { useEffect, useState } from 'react';
import { signIn, signOut, currentToken } from './auth.js';
import { createApi, type Api } from './api.js';
import { groupByEntity, groupBySource, groupRequirementsBySection, isWriter, type Entry, type RequirementEntry } from './lib.js';

function SignIn({ onToken }: { onToken: (t: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main>
      <h1>BAWP End-to-End Testing Registry</h1>
      <h2>Sign in</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onToken(await signIn(username, password));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input aria-label="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input aria-label="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Sign in</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

function Detail({ api, source, id }: { api: Api; source: string; id: string }) {
  const [data, setData] = useState<any>(null);
  const [yaml, setYaml] = useState<string>('');
  useEffect(() => {
    api.getContract(source, id).then(setData);
  }, [api, source, id]);
  if (!data) return <p>Loading…</p>;
  const e = data.entry ?? {};
  const meta: [string, unknown][] = [
    ['Entity', e.entity],
    ['Domain', e.domain],
    ['Name', e.name],
    ['Declared version', e.declaredVersion],
    ['Current version', e.currentVersion],
    ['Validation', e.validation],
    ['Source', e.source],
    ['Source commit', e.commitSha],
    ['File path', e.filePath],
    ['Last crawled', e.lastCrawledAt],
  ];
  return (
    <section aria-label="detail">
      <h3>
        {source} / {id}
      </h3>
      <dl aria-label="metadata">
        {meta
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
      </dl>
      <ul>
        {data.versions?.map((v: any) => (
          <li key={v.versionNumber}>
            v{v.versionNumber} — {v.hash?.slice(0, 8)} {v.versionNotBumped && <em>(version not bumped)</em>}
          </li>
        ))}
      </ul>
      <button onClick={async () => setYaml(await api.getRaw(source, id))}>View YAML</button>
      {yaml && <pre aria-label="yaml">{yaml}</pre>}
    </section>
  );
}

function DiffView({ diff }: { diff: any }) {
  const d = diff.diff;
  return (
    <section aria-label="diff">
      <h3>
        {diff.entity} diff {diff.divergent ? '(divergent)' : '(identical)'}
      </h3>
      {d && (
        <>
          <p>Only in publisher: {d.onlyInA.map((p: any) => p.path).join(', ') || '—'}</p>
          <p>Only in consumer: {d.onlyInB.map((p: any) => p.path).join(', ') || '—'}</p>
          <p>Changed: {d.changed.map((c: any) => `${c.path}.${c.field}`).join(', ') || '—'}</p>
        </>
      )}
    </section>
  );
}

function RequirementsView({ api }: { api: Api }) {
  const [reqs, setReqs] = useState<RequirementEntry[]>([]);
  const [selected, setSelected] = useState<RequirementEntry | null>(null);
  useEffect(() => {
    api.listRequirements().then(setReqs);
  }, [api]);

  const groups = groupRequirementsBySection(reqs);
  return (
    <section aria-label="requirements">
      {groups.map((sg) => (
        <div key={sg.source}>
          <h3>{sg.source}</h3>
          {sg.sections.map((sec) => (
            <div key={sec.section}>
              <h4>{sec.section}</h4>
              <ul>
                {sec.requirements.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setSelected(r)}>
                      <strong>{r.id}</strong>{' '}
                      <span>
                        [{r.earsType}/{r.modality ?? '—'}]
                      </span>{' '}
                      {r.text}
                    </button>
                    {!r.earsConforming && <span data-testid="non-conforming">non-conforming</span>}
                    {r.changedInLastCrawl && <span data-testid="changed">changed</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {selected && (
        <aside aria-label="requirement-detail">
          <h3>
            {selected.source} / {selected.id}
          </h3>
          <dl>
            <div>
              <dt>Section</dt>
              <dd>{selected.section}</dd>
            </div>
            <div>
              <dt>EARS type</dt>
              <dd>{selected.earsType}</dd>
            </div>
            <div>
              <dt>Modality</dt>
              <dd>{selected.modality ?? 'none'}</dd>
            </div>
            <div>
              <dt>Conforming</dt>
              <dd>{String(selected.earsConforming)}</dd>
            </div>
          </dl>
          <p>{selected.text}</p>
        </aside>
      )}
    </section>
  );
}

function CrawlLog({ summary }: { summary: any }) {
  const duration =
    summary.startedAt && summary.endedAt
      ? ((new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1000).toFixed(1)
      : null;
  return (
    <section aria-label="crawl log" style={{ fontFamily: 'monospace', fontSize: '0.85em', margin: '0.5em 0' }}>
      <p style={{ margin: '0 0 0.25em' }}>
        ✓ Crawl done{duration ? ` in ${duration}s` : ''} · run {summary.runId}
      </p>
      {summary.sources?.map((s: any) => (
        <details key={s.label} open>
          <summary style={{ cursor: 'pointer' }}>
            {s.outcome === 'failed' ? '✗' : '✓'} <strong>{s.label}</strong>
            {` (${s.branch}:${s.pathPrefix ?? '/'})`}
            {s.outcome === 'success' &&
              ` — ${s.discovered} discovered · ${s.valid} valid · ${s.invalid} invalid`}
            {s.outcome === 'failed' && ` — failed: ${s.reason}`}
          </summary>
          {s.outcome === 'success' && (
            <ul style={{ margin: '0.2em 0 0.2em 1.2em', padding: 0 }}>
              <li>
                new versions: {s.newVersion} · unchanged: {s.unchanged}
              </li>
              {s.requirements && !s.requirements.failed && (
                <li>
                  requirements: {s.requirements.discovered} discovered · {s.requirements.conforming} conforming ·{' '}
                  {s.requirements.nonConforming} non-conforming · {s.requirements.changed} changed ·{' '}
                  {s.requirements.removed} removed
                </li>
              )}
              {s.requirements?.failed && <li>⚠ requirements failed: {s.requirements.reason}</li>}
            </ul>
          )}
        </details>
      ))}
      {summary.collisions?.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer' }}>
            ⚠ {summary.collisions.length} id collision(s)
          </summary>
          <ul style={{ margin: '0.2em 0 0.2em 1.2em', padding: 0 }}>
            {summary.collisions.map((c: any, i: number) => (
              <li key={i}>
                {c.source} / {c.id}: {c.paths.join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function App() {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<{ source: string; id: string } | null>(null);
  const [diff, setDiff] = useState<any>(null);
  const [view, setView] = useState<'entity' | 'source' | 'requirements'>('entity');
  const [crawlRunning, setCrawlRunning] = useState(false);
  const [crawlElapsed, setCrawlElapsed] = useState(0);
  const [crawlSummary, setCrawlSummary] = useState<any>(null);
  const [crawlError, setCrawlError] = useState('');

  useEffect(() => {
    if (!crawlRunning) return;
    const t0 = Date.now();
    const id = setInterval(() => setCrawlElapsed((Date.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [crawlRunning]);

  useEffect(() => {
    currentToken().then((t) => {
      setToken(t);
      setReady(true);
    });
  }, []);

  const api = token ? createApi(token) : undefined;

  async function load(t: string) {
    setEntries(await createApi(t).listContracts());
  }
  useEffect(() => {
    if (token) load(token);
  }, [token]);

  async function runRefresh() {
    setCrawlRunning(true);
    setCrawlElapsed(0);
    setCrawlSummary(null);
    setCrawlError('');
    try {
      const summary = await api!.refresh();
      setCrawlSummary(summary);
      await load(token!);
    } catch (err) {
      setCrawlError((err as Error).message);
    } finally {
      setCrawlRunning(false);
    }
  }

  if (!ready) return <p>Loading…</p>;
  if (!token) return <SignIn onToken={setToken} />;

  const groups = groupByEntity(entries);
  const sourceGroups = groupBySource(entries);
  return (
    <main>
      <header>
        <h1>BAWP End-to-End Testing Registry</h1>
        {isWriter(token) && (
          <button onClick={runRefresh} disabled={crawlRunning}>
            Refresh
          </button>
        )}
        <button
          onClick={() => {
            signOut();
            setToken(undefined);
          }}
        >
          Sign out
        </button>
      </header>
      {crawlRunning && (
        <p role="status" aria-live="polite">
          Crawling… {crawlElapsed.toFixed(1)}s
        </p>
      )}
      {crawlError && (
        <p role="alert" style={{ color: 'red' }}>
          Refresh failed: {crawlError}
        </p>
      )}
      {crawlSummary && <CrawlLog summary={crawlSummary} />}
      <nav aria-label="view toggle">
        <button aria-pressed={view === 'entity'} disabled={view === 'entity'} onClick={() => setView('entity')}>
          By entity
        </button>
        <button aria-pressed={view === 'source'} disabled={view === 'source'} onClick={() => setView('source')}>
          By source
        </button>
        <button aria-pressed={view === 'requirements'} disabled={view === 'requirements'} onClick={() => setView('requirements')}>
          Requirements
        </button>
      </nav>
      {view === 'requirements' ? (
        <RequirementsView api={api!} />
      ) : view === 'entity' ? (
        <ul aria-label="by-entity">
          {groups.map((g) => (
            <li key={g.entity}>
              <strong>{g.entity}</strong> {g.divergent && <span data-testid="divergent">divergent</span>}
              <ul>
                {g.variants.map((v) => (
                  <li key={v.source}>
                    <button onClick={() => setSelected({ source: v.source, id: v.id })}>
                      {v.domain ?? v.source} v{v.currentVersion} ({v.validation})
                    </button>
                  </li>
                ))}
              </ul>
              {g.divergent && <button onClick={async () => setDiff(await api!.getEntity(g.entity))}>Show {g.entity} diff</button>}
            </li>
          ))}
        </ul>
      ) : (
        <section aria-label="by-source">
          {sourceGroups.map((sg) => (
            <div key={sg.source}>
              <h3>{sg.source}</h3>
              <ul>
                {sg.contracts.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setSelected({ source: c.source, id: c.id })}>
                      {c.entity} v{c.currentVersion} ({c.validation})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {selected && <Detail api={api!} source={selected.source} id={selected.id} />}
      {diff && <DiffView diff={diff} />}
    </main>
  );
}
