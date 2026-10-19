/**
 * LegacyExperimentRunForm — the deprecated legacy experiment runner
 * (`POST /experiments`), moved out of the old ExperimentsPage (R-91, T-32).
 *
 * Offered only as a secondary action on the Experiments hub until the
 * `baseline-legacy-v1` pipeline is verified to reproduce legacy output (Q5).
 */
import { useState } from 'react';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { useLegacyPromptVersions } from '../hooks/usePipelines.js';

export default function LegacyExperimentRunForm({
  api,
  onCreated,
  onCancel,
}: {
  api: Api;
  onCreated: (experimentId: string) => void;
  onCancel: () => void;
}) {
  const { data } = useLegacyPromptVersions(api);
  const versions = data?.promptVersions ?? [];
  const [selectedVersion, setSelectedVersion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="card" aria-label="legacy experiment form" style={{ marginBottom: 16 }}>
      <p className="card-title">Run legacy experiment (deprecated)</p>
      <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
        Runs one legacy prompt version over every groundable requirement. Prefer the
        &ldquo;Baseline (legacy v1)&rdquo; pipeline via New experiment.
      </p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selectedVersion) return;
          setError('');
          setPending(true);
          try {
            const result = await api.createExperiment({ promptVersion: selectedVersion });
            onCreated(result.experimentId);
          } catch (err) {
            setError(err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="nef-prompt-version">Prompt version</label>
          <select id="nef-prompt-version" className="form-select" value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)} required>
            <option value="">— select a version —</option>
            {versions.map((v) => (
              <option key={v.promptVersion} value={v.promptVersion}>
                {v.promptVersion} · {v.modelId}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="cluster">
          <button className="btn btn-primary" type="submit" disabled={!selectedVersion || pending}>
            {pending ? 'Starting…' : 'Run legacy experiment'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
