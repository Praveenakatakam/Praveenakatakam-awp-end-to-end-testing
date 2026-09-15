import { describe, it, expect } from 'vitest';
import { redact } from '../src/log.js';

describe('redact (NFR-2, NFR-J2)', () => {
  it('scrubs GitHub-token-shaped substrings by pattern', () => {
    expect(redact('bad creds ghp_abc123XYZ here')).toBe('bad creds [redacted] here');
  });

  it('scrubs literal secret values passed explicitly, in addition to the GitHub pattern', () => {
    const token = 'super-secret-jira-token-xyz';
    const email = 'svc@collegeboard.org';
    const msg = `401 unauthorized for token ${token} account ${email}`;
    const out = redact(msg, [token, email]);
    expect(out).not.toContain(token);
    expect(out).not.toContain(email);
    expect(out).toContain('[redacted]');
  });

  it('ignores empty/undefined entries in the secrets list without throwing', () => {
    expect(redact('hello world', ['', undefined as any])).toBe('hello world');
  });

  it('is a no-op when no secrets list is passed (backward compatible)', () => {
    expect(redact('plain message')).toBe('plain message');
  });
});
