/**
 * PromptsPage — list/archive of active prompts (T-13, R-41, R-52, R-53, R-44)
 * merged with legacy prompt versions (T-33, R-89).
 *
 * Displays all active prompts (soft-deleted excluded server-side), then every
 * legacy prompt version not yet imported. Imported versions (`legacy-<pv>`)
 * render as their prompt row with a `legacy` badge and model; un-imported ones
 * get a per-row "Import" action (R-86).
 * Writers see a "New Prompt" form and per-row delete controls.
 * Clicking a row navigates to PromptPage (/prompts/:key) for full edit.
 *
 * TanStack Query hooks: usePrompts, useCreatePrompt, useDeletePrompt (D-14).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Api } from '../api.js';
import { ApiError } from '../api.js';
import type { PromptItem } from '@registry/core';
import { isWriter } from '../lib.js';
import {
  usePrompts,
  useCreatePrompt,
  useDeletePrompt,
  useImportLegacyPrompts,
  useLegacyPromptVersions,
  legacyPromptKey,
} from '../hooks/usePipelines.js';
import PageHeader from '../components/PageHeader.js';

/** PromptItem extended with the best-effort usedByPipelines field (R-41). */
type PromptListItem = PromptItem & { usedByPipelines?: string[] };

// ---------------------------------------------------------------------------
// NewPromptForm
// ---------------------------------------------------------------------------

function NewPromptForm({
  api,
  onCancel,
}: {
  api: Api;
  onCancel: () => void;
}) {
  const [promptKey, setPromptKey] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const { mutateAsync, isPending } = useCreatePrompt(api);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <p className="card-title">New Prompt</p>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await mutateAsync({ promptKey, body });
            onCancel();
          } catch (err) {
            const msg =
              err instanceof ApiError && err.serverMessage
                ? err.serverMessage
                : (err as Error).message;
            setError(msg);
          }
        }}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="np-key">
            Prompt key
          </label>
          <input
            id="np-key"
            className="form-input"
            value={promptKey}
            onChange={(e) => setPromptKey(e.target.value)}
            placeholder="functional-test-gen-v2"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="np-body">
            Prompt body
          </label>
          <textarea
            id="np-body"
            className="form-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="cluster">
          <button className="btn btn-primary" type="submit" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromptsPage
// ---------------------------------------------------------------------------

export default function PromptsPage({
  api,
  token,
}: {
  api: Api;
  token: string;
}) {
  const navigate = useNavigate();
  const writer = isWriter(token);

  const { data, isLoading } = usePrompts(api);
  const { mutateAsync: deletePrompt, isPending: isDeleting } =
    useDeletePrompt(api);

  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const importMutation = useImportLegacyPrompts(api);
  const [importResult, setImportResult] = useState<{ imported: string[]; skipped: string[] } | null>(null);
  const [importError, setImportError] = useState('');

  async function handleImport() {
    setImportError('');
    setImportResult(null);
    try {
      setImportResult(await importMutation.mutateAsync());
    } catch (err) {
      setImportError(
        err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message
      );
    }
  }

  const prompts = (data?.prompts ?? []) as PromptListItem[];

  // Legacy prompt versions (R-89) — failure is non-fatal: the list just omits them.
  const { data: legacyData } = useLegacyPromptVersions(api);
  const legacyVersions = legacyData?.promptVersions ?? [];
  const legacyByKey = new Map(legacyVersions.map((v) => [legacyPromptKey(v.promptVersion), v]));
  const promptKeySet = new Set(prompts.map((p) => p.promptKey));
  const unimported = legacyVersions.filter((v) => !promptKeySet.has(legacyPromptKey(v.promptVersion)));
  const [rowImporting, setRowImporting] = useState<string | null>(null);

  async function handleRowImport(promptVersion: string) {
    setImportError('');
    setImportResult(null);
    setRowImporting(promptVersion);
    try {
      await importMutation.mutateAsync({ promptVersions: [promptVersion] });
    } catch (err) {
      setImportError(
        err instanceof ApiError && err.serverMessage ? err.serverMessage : (err as Error).message
      );
    } finally {
      setRowImporting(null);
    }
  }

  async function handleDelete(key: string) {
    setDeleteError('');
    try {
      await deletePrompt(key);
      setDeleteConfirm(null);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.serverMessage
          ? err.serverMessage
          : (err as Error).message;
      setDeleteError(msg);
    }
  }

  return (
    <div className="app-body" aria-label="prompts">
      <div className="app-main">
        <PageHeader
          title="Prompts"
          subtitle="Versioned system prompts that pipeline steps run with — editing a prompt creates a new version"
          actions={
            <>
              {writer && !showNewForm && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowNewForm(true)}
                >
                  New Prompt
                </button>
              )}
              {writer && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={importMutation.isPending}
                  onClick={handleImport}
                  title="Copy legacy /prompt-versions records into the prompt store as legacy-<version>"
                >
                  {importMutation.isPending ? 'Importing…' : 'Import legacy prompt versions'}
                </button>
              )}
            </>
          }
        />

        {/* Legacy import result (R-72) */}
        {importResult && (
          <p className="alert alert-info" role="status">
            Imported {importResult.imported.length} legacy prompt version
            {importResult.imported.length !== 1 ? 's' : ''}
            {importResult.skipped.length > 0 ? `; skipped ${importResult.skipped.length} already imported` : ''}.
          </p>
        )}
        {importError && (
          <p className="alert alert-danger" role="alert">Import failed: {importError}</p>
        )}

        {/* Inline new-prompt form */}
        {showNewForm && (
          <NewPromptForm api={api} onCancel={() => setShowNewForm(false)} />
        )}

        {/* Delete error banner */}
        {deleteError && (
          <p className="alert alert-danger" role="alert">
            {deleteError}
          </p>
        )}

        {/* Prompt list */}
        {isLoading ? (
          <p className="loading">Loading…</p>
        ) : prompts.length === 0 && unimported.length === 0 ? (
          <p className="text-muted text-sm">No prompts yet.</p>
        ) : (
          <ul className="row-list" style={{ marginTop: 4 }}>
            {prompts.map((prompt) => {
              const legacy = legacyByKey.get(prompt.promptKey);
              return (
              <li
                key={prompt.promptKey}
                data-testid="prompt-row"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  transition: 'border-color 0.1s',
                }}
              >
                {/* Main clickable area */}
                <button
                  style={{
                    flex: '1 1 280px',
                    minWidth: 0,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--text)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                  onClick={() =>
                    navigate(
                      `/prompts/${encodeURIComponent(prompt.promptKey)}`
                    )
                  }
                >
                  {/* Name on its own line */}
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {prompt.promptKey}
                  </div>

                  {/* Meta line: version, legacy info, usage */}
                  <div
                    className="text-muted"
                    style={{
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0 8px',
                    }}
                  >
                    <span>v{prompt.currentVersion}</span>
                    {legacy && (
                      <>
                        <span>·</span>
                        <span>imported from legacy {legacy.promptVersion}</span>
                        <span>·</span>
                        <span>{legacy.modelId}</span>
                      </>
                    )}
                    {prompt.usedByPipelines &&
                      prompt.usedByPipelines.length > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            used by {prompt.usedByPipelines.length} pipeline
                            {prompt.usedByPipelines.length !== 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                  </div>

                  {/* Body snippet: 2-line clamp, sans font */}
                  {prompt.body && (
                    <div
                      className="text-muted"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                      }}
                    >
                      {prompt.body}
                    </div>
                  )}
                </button>

                {/* Right-side: status badge + updated-at + delete */}
                <div
                  className="cluster"
                  style={{ flexShrink: 0, flexWrap: 'wrap', alignSelf: 'flex-start', gap: 6 }}
                >
                  {legacy && <span className="badge badge-warning">legacy</span>}
                  <span
                    className={`badge ${prompt.active ? 'badge-success' : 'badge-muted'}`}
                  >
                    {prompt.active ? 'active' : 'inactive'}
                  </span>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {new Date(prompt.updatedAt).toLocaleString()}
                  </span>
                  {writer &&
                    (deleteConfirm === prompt.promptKey ? (
                      <>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={isDeleting}
                          onClick={() => handleDelete(prompt.promptKey)}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setDeleteError('');
                          setDeleteConfirm(prompt.promptKey);
                        }}
                      >
                        Delete
                      </button>
                    ))}
                </div>
              </li>
              );
            })}
            {unimported.map((v) => (
              <li
                key={`legacy:${v.promptVersion}`}
                data-testid="prompt-row"
                aria-label={`legacy prompt version ${v.promptVersion}`}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {/* Name on its own line */}
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.promptVersion}
                  </div>
                  {/* Meta line: model, not-imported note */}
                  <div
                    className="text-muted"
                    style={{
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0 8px',
                    }}
                  >
                    <span>{v.modelId}</span>
                    <span>·</span>
                    <span>not imported (would become {legacyPromptKey(v.promptVersion)})</span>
                  </div>
                </div>
                <div className="cluster" style={{ flexShrink: 0, flexWrap: 'wrap', alignSelf: 'flex-start', gap: 6 }}>
                  <span className="badge badge-warning">legacy</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  {writer && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={importMutation.isPending}
                      onClick={() => handleRowImport(v.promptVersion)}
                    >
                      {rowImporting === v.promptVersion ? 'Importing…' : 'Import'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
