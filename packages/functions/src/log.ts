/**
 * Minimal structured logger (NFR-5).
 *
 * Emits one JSON object per line to stdout; CloudWatch supplies the timestamp.
 * Every Lambda uses this so logs are machine-parseable. The GitHub credential
 * (and any other secret) MUST NOT be passed in `fields` — nothing here scrubs,
 * so callers keep secrets out (NFR-2, R-02).
 */
type Fields = Record<string, unknown>;

/**
 * Redact GitHub-token-shaped substrings, plus any literal secret values passed
 * in `secrets` — defense in depth for NFR-2/NFR-J2.
 *
 * The logger itself does not scrub `fields` (callers keep secrets out). This
 * helper is applied at the places that log/record an *uncontrolled* upstream
 * string — a crawl source-failure `reason` and a requirements-failure `reason`,
 * both derived from a client error — so a credential accidentally echoed by
 * that error can never reach the logs or the `POST /refresh` response.
 *
 * GitHub PATs have a recognizable prefix, so a pattern catches them without
 * the caller needing to know the value. Jira API tokens and service-account
 * emails have no such shape, so callers that hold the actual secret value
 * (e.g. the Jira crawl) pass it explicitly via `secrets` for an exact-match scrub.
 */
export function redact(s: string, secrets: (string | undefined)[] = []): string {
  let out = s.replace(/\b(?:ghp_|github_pat_|gho_|ghs_|ghu_|ghr_)[A-Za-z0-9_]+/g, '[redacted]');
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields): void {
  // eslint-disable-next-line no-console -- structured Lambda logging (NFR-5)
  console.log(JSON.stringify({ level, event, ...fields }));
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}) => emit('warn', event, fields),
  error: (event: string, fields: Fields = {}) => emit('error', event, fields),
};
