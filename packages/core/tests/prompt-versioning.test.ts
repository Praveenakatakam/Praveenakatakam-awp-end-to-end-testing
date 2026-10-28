import { describe, it, expect } from 'vitest';
import {
  isValidPromptVersion,
  type PromptVersionRecord,
  type ExperimentRecord,
} from '../src/index.js';

describe('isValidPromptVersion (T-01a)', () => {
  // --- valid cases ---

  it('accepts a simple version string', () => {
    expect(isValidPromptVersion('v1')).toBe(true);
  });

  it('accepts a hyphenated version string', () => {
    expect(isValidPromptVersion('v2-concise')).toBe(true);
  });

  it('accepts a version with dots and underscores', () => {
    expect(isValidPromptVersion('a.b_c')).toBe(true);
  });

  it('accepts an alphanumeric version string', () => {
    expect(isValidPromptVersion('abc123')).toBe(true);
  });

  it('accepts a string that is exactly 64 characters long', () => {
    // GIVEN: a string of exactly 64 lowercase alphanumeric characters
    const maxLength = 'a'.repeat(64);
    // WHEN / THEN
    expect(isValidPromptVersion(maxLength)).toBe(true);
  });

  // --- invalid cases ---

  it('rejects an empty string', () => {
    expect(isValidPromptVersion('')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValidPromptVersion('V1')).toBe(false);
  });

  it('rejects a string containing a space', () => {
    expect(isValidPromptVersion('v 1')).toBe(false);
  });

  it('rejects a string containing @', () => {
    expect(isValidPromptVersion('v1@foo')).toBe(false);
  });

  it('rejects a string containing /', () => {
    expect(isValidPromptVersion('v1/foo')).toBe(false);
  });

  it('rejects a string that is 65 characters long (one over the limit)', () => {
    // GIVEN: a string of exactly 65 lowercase alphanumeric characters
    const tooLong = 'a'.repeat(65);
    // WHEN / THEN
    expect(isValidPromptVersion(tooLong)).toBe(false);
  });
});

// Type smoke tests — compile-time only; no runtime assertions needed
describe('prompt-versioning types (T-01a barrel export)', () => {
  it('PromptVersionRecord is importable and assignable', () => {
    // GIVEN
    const record: PromptVersionRecord = {
      promptVersion: 'v1',
      text: 'You are a helpful assistant.',
      modelId: 'us.anthropic.claude-sonnet-4-6',
      createdAt: '2026-10-08T00:00:00.000Z',
      startedAt: '2026-10-08T00:00:00.000Z',
      createdBy: 'test-user',
    };
    // THEN: assignment compiles and the field is accessible at runtime
    expect(record.promptVersion).toBe('v1');
  });

  it('ExperimentRecord is importable and assignable', () => {
    // GIVEN
    const record: ExperimentRecord = {
      experimentId: 'exp-001',
      kind: 'EXPERIMENT',
      status: 'pending',
      promptVersion: 'v1',
      createdAt: '2026-10-08T00:00:00.000Z',
      startedAt: '2026-10-08T00:00:00.000Z',
      createdBy: 'test-user',
    };
    // THEN
    expect(record.kind).toBe('EXPERIMENT');
  });
});
