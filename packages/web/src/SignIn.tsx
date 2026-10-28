import { useState } from 'react';
import { signIn } from './auth.js';

export function SignIn({ onToken }: { onToken: (t: string) => void }) {
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
