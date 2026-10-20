/**
 * AppShell — production entry point for the registry SPA.
 *
 * Owns:
 *   - Auth gate: currentToken() → <SignIn> if unauthenticated
 *   - Theme toggle: 'dark' | 'light', persisted in localStorage
 *   - API instance: created from token via createApi()
 *   - <HashRouter> wrapping <AppRoutes>
 *   - <CrawlProvider> so the Sidebar's Refresh button has context
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Link } from 'react-router-dom';
import { signOut, currentToken } from './auth.js';
import { createApi } from './api.js';
import { SignIn } from './SignIn.js';
import { CrawlProvider } from './contexts/CrawlContext.js';
import AppRoutes from './AppRoutes.js';

export default function AppShell() {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  useEffect(() => { currentToken().then((t) => { setToken(t); setReady(true); }); }, []);

  // Called before every API request — getSession() refreshes the access token
  // automatically using the Cognito refresh token when it has expired.
  const getToken = useCallback(async (): Promise<string> => {
    const t = await currentToken();
    if (!t) { setToken(undefined); throw new Error('session expired'); }
    setToken(t);
    return t;
  }, []);

  const api = useMemo(() => token ? createApi(getToken) : undefined, [token, getToken]);

  if (!ready) return <p className="loading" style={{ padding: 40 }}>Loading…</p>;
  if (!token) return <SignIn onToken={setToken} />;

  return (
    <HashRouter>
      <CrawlProvider api={api!}>
        <div className="app-shell">
          <header className="app-header">
            <h1><Link to="/" className="brand-link" title="Home">E2E Testing Registry</Link></h1>
            <button
              className="btn btn-ghost btn-sm"
              title="Toggle light/dark mode"
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { signOut(); setToken(undefined); }}
            >
              Sign out
            </button>
          </header>
          <AppRoutes api={api!} token={token} />
        </div>
      </CrawlProvider>
    </HashRouter>
  );
}
