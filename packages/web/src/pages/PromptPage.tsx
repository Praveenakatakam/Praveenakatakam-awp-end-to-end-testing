/**
 * PromptPage — detail and edit page for a single prompt (T-13, R-42, R-43, R-44, R-52, R-53).
 *
 * Route: /prompts/:key
 * - Shows promptKey, currentVersion, active status.
 * - Textarea pre-filled with the current body (inline only; S3-stored bodies show a note).
 * - Save calls PUT /prompts/{key} via useUpdatePrompt; displayed version updates on success.
 * - Version history aside panel: version number + createdAt per entry.
 * - Soft-delete via DELETE /prompts/{key}; navigates back to /prompts on success.
 * - Write controls (save, delete) hidden for non-writers (R-44).
 *
 * TanStack Query hooks: usePrompt, useUpdatePrompt, useDeletePrompt, usePromptVersions (D-14).
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import { isWriter } from '../lib.js';
import {
  usePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  usePromptVersions,
} from '../hooks/usePipelines.js';

export default function PromptPage({
  api,
  token,
}: {
  api: Api;
  token: string;
}) {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const writer = isWriter(token);

  const { data: prompt, isLoading } = usePrompt(api, key ?? '');
  const { data: versionsData } = usePromptVersions(api, key ?? '');
  const { mutateAsync: updatePrompt, isPending: isSaving } =
    useUpdatePrompt(api);
  const { mutateAsync: deletePrompt, isPending: isDeleting } =
    useDeletePrompt(api);

  const [body, setBody] = useState('');
  const [saveError, setSaveError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Sync textarea with fetched prompt body (only on initial load / version bump)
  useEffect(() => {
    if (prompt?.body !== undefined) {
      setBody(prompt.body);
    }
  }, [prompt?.body]);

  if (!key) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="text-muted text-sm">No prompt key provided.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="loading">Loading…</p>
        </div>
      </div>
    );
  }

  if (!prompt) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="alert alert-danger" role="alert">
            Prompt not found.
          </p>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => navigate('/prompts')}
          >
            ← Back to Prompts
          </button>
        </div>
      </div>
    );
  }

  const versions = versionsData?.versions ?? [];

  async function handleSave() {
    setSaveError('');
    try {
      await updatePrompt({ key: key!, body: { body } });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setSaveError(msg);
    }
  }

  async function handleDelete() {
    setDeleteError('');
    try {
      await deletePrompt(key!);
      navigate('/prompts');
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setDeleteError(msg);
      setDeleteConfirm(false);
    }
  }

  return (
    <div className="app-body" aria-label="prompt-detail">
      {/* Main panel */}
      <div className="app-main">
        {/* Breadcrumb + heading */}
        <div className="cluster" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/prompts')}
          >
            ← Prompts
          </button>
          <h3 className="detail-heading" style={{ marginBottom: 0 }}>
            {prompt.promptKey}
          </h3>
          <span
            className={`badge ${prompt.active ? 'badge-success' : 'badge-muted'}`}
          >
            {prompt.active ? 'active' : 'inactive'}
          </span>
        </div>

        {/* Metadata */}
        <dl className="meta-grid" style={{ marginBottom: 16 }}>
          {(
            [
              ['Current version', `v${prompt.currentVersion}`],
              ['Created', new Date(prompt.createdAt).toLocaleString()],
              ['Updated', new Date(prompt.updatedAt).toLocaleString()],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt className="meta-key">{k}</dt>
              <dd className="meta-val">{v}</dd>
            </div>
          ))}
        </dl>

        {/* Editor card */}
        <div className="card">
          <p className="card-title">Prompt body</p>

          {/* Note when body is in S3 and can't be shown inline */}
          {prompt.s3Ref && !prompt.body && (
            <p
              className="alert alert-info"
              style={{ marginBottom: 8 }}
              role="status"
            >
              Current body is stored in S3 (too large to display inline). Enter
              a new body below to create a new version.
            </p>
          )}

          <textarea
            className="form-textarea"
            style={{ minHeight: 300 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!writer}
            aria-label="prompt body"
            placeholder={
              prompt.s3Ref && !prompt.body
                ? 'Enter new body here…'
                : undefined
            }
          />

          {saveError && (
            <p className="form-error" role="alert" style={{ marginTop: 8 }}>
              {saveError}
            </p>
          )}

          {writer && (
            <div style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save (creates new version)'}
              </button>
            </div>
          )}
        </div>

        {/* Danger zone — writers only */}
        {writer && (
          <div className="card" style={{ marginTop: 16 }}>
            <p className="card-title">Danger zone</p>
            {deleteError && (
              <p className="form-error" role="alert" style={{ marginBottom: 8 }}>
                {deleteError}
              </p>
            )}
            {deleteConfirm ? (
              <div className="cluster">
                <span className="text-muted text-sm">
                  Soft-delete this prompt? Pipelines referencing it will fail
                  validation.
                </span>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={isDeleting}
                  onClick={handleDelete}
                >
                  {isDeleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDeleteError('');
                  setDeleteConfirm(true);
                }}
              >
                Soft-delete prompt
              </button>
            )}
          </div>
        )}
      </div>

      {/* Version history aside panel */}
      <aside className="app-panel" aria-label="version-history">
        <p className="section-heading" style={{ marginBottom: 8 }}>
          Version history
        </p>
        {versions.length === 0 ? (
          <p className="text-muted text-sm">No versions yet.</p>
        ) : (
          <ul className="row-list">
            {versions.map((v) => (
              <li key={v.version} style={{ padding: '8px 0' }}>
                <div className="cluster" style={{ marginBottom: 2 }}>
                  <span
                    className="badge badge-muted"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    v{v.version}
                  </span>
                  {v.version === prompt.currentVersion && (
                    <span className="badge badge-success">current</span>
                  )}
                </div>
                <div className="text-muted text-sm">
                  {new Date(v.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
