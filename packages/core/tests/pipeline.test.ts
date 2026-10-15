/**
 * Tests for pipeline.ts type structure (T-01a).
 *
 * Tests are split into two categories:
 *  1. Compile-time: TypeScript would fail to compile this file if the union
 *     is incomplete or a required field is missing — no runtime assertion needed.
 *  2. Runtime: Vitest assertions that confirm assignability and field presence
 *     at test execution time.
 *
 * Requirements: R-01, R-02, R-45, R-51, R-52
 */

import { describe, it, expect } from 'vitest';
import type {
  PipelineRunStatus,
  StepStatus,
  SamplingConfig,
  StepRecord,
  PromptItem,
} from '../src/pipeline.js';

// ---------------------------------------------------------------------------
// Compile-time exhaustiveness helpers
//
// Each function below has a non-void return type and a switch with no default
// arm. TypeScript strict compilation fails ("Function lacks ending return
// statement") if any union member is not handled — that is the test.
// ---------------------------------------------------------------------------

function exhaustPipelineRunStatus(s: PipelineRunStatus): string {
  switch (s) {
    case 'running':                return 'running';
    case 'completed':              return 'completed';
    case 'completed_with_warnings': return 'completed_with_warnings';
    case 'failed':                 return 'failed';
    case 'timed_out':              return 'timed_out';
  }
}

function exhaustStepStatus(s: StepStatus): string {
  switch (s) {
    case 'running':   return 'running';
    case 'completed': return 'completed';
    case 'cached':    return 'cached';
    case 'failed':    return 'failed';
    case 'warning':   return 'warning';
  }
}

// ---------------------------------------------------------------------------
// Compile-time fixture: StepRecord with all R-51 metric fields
//
// If any R-51 field is missing from StepRecord, the type assignment below
// would be flagged by TypeScript's strict mode (excess-property checking on
// the explicitly typed variable ensures we test real field names too).
// ---------------------------------------------------------------------------

const FULL_STEP_RECORD: StepRecord = {
  pk: 'PRUN#run-abc',
  sk: 'STEP#00',
  stepId: 's0',
  stepIndex: 0,
  label: 'Generate tests',
  model: 'us.anthropic.claude-sonnet-4-6',
  promptKey: 'functional-test-gen-default',
  promptVersion: 1,
  status: 'completed',
  cacheKey: 'deadbeef01234567',
  outputRef: { inline: 'test output' },
  startedAt: '2024-01-01T00:00:00.000Z',
  completedAt: '2024-01-01T00:00:01.500Z',
  // R-51 metric fields
  durationMs: 1500,
  bedrockLatencyMs: 1200,
  inputTokens: 1000,
  outputTokens: 500,
  inputCharacters: 4000,
  outputCharacters: 2000,
  contextTokenEstimate: 1024,
  costEstimateUsd: 0.00525,
  errorMessage: undefined,
  errorStack: undefined,
};

// ---------------------------------------------------------------------------
// Compile-time fixture: PromptItem with active boolean (R-52)
// ---------------------------------------------------------------------------

const ACTIVE_PROMPT: PromptItem = {
  pk: 'PRMPT#functional-test-gen-default',
  sk: 'PRMPT',
  kind: 'PRMPT',
  promptKey: 'functional-test-gen-default',
  currentVersion: 3,
  body: 'You are a test generator...',
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const SOFT_DELETED_PROMPT: PromptItem = {
  pk: 'PRMPT#old-prompt',
  sk: 'PRMPT',
  kind: 'PRMPT',
  promptKey: 'old-prompt',
  currentVersion: 1,
  active: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Runtime tests
// ---------------------------------------------------------------------------

describe('PipelineRunStatus union exhaustiveness (T-01a · R-01)', () => {
  it('covers all five status values via exhaustive switch with no default arm', () => {
    // GIVEN each member of the union
    const statuses: PipelineRunStatus[] = [
      'running',
      'completed',
      'completed_with_warnings',
      'failed',
      'timed_out',
    ];

    // WHEN mapped through the exhaustive helper (compile-time test above)
    // THEN every status is handled and returned as a non-empty string
    for (const s of statuses) {
      expect(exhaustPipelineRunStatus(s)).toBe(s);
    }
  });
});

describe('StepStatus union exhaustiveness (T-01a · R-01)', () => {
  it('covers all five status values via exhaustive switch with no default arm', () => {
    // GIVEN each member of the union
    const statuses: StepStatus[] = [
      'running',
      'completed',
      'cached',
      'failed',
      'warning',
    ];

    // WHEN mapped through the exhaustive helper
    // THEN every status is handled and returned as a non-empty string
    for (const s of statuses) {
      expect(exhaustStepStatus(s)).toBe(s);
    }
  });
});

describe('SamplingConfig — first_n default shape (T-01a · R-45)', () => {
  it('accepts { strategy: "first_n", n: 3 } as a valid SamplingConfig', () => {
    // GIVEN the default sampling shape from the design (R-45)
    const defaultSampling: SamplingConfig = { strategy: 'first_n', n: 3 };

    // WHEN we inspect the shape
    // THEN strategy and n are as expected
    expect(defaultSampling.strategy).toBe('first_n');
    expect((defaultSampling as { strategy: 'first_n'; n: number }).n).toBe(3);
  });

  it('accepts all four strategy variants at the SamplingConfig type level', () => {
    // GIVEN one instance of each discriminated variant
    const strategies: SamplingConfig[] = [
      { strategy: 'first_n', n: 5 },
      { strategy: 'percentage', percentage: 50 },
      { strategy: 'ids', ids: ['R-01', 'R-02'] },
      { strategy: 'all' },
    ];

    // WHEN we read strategy values
    // THEN all four strategy strings are present
    const strategyNames = strategies.map((s) => s.strategy);
    expect(strategyNames).toEqual(['first_n', 'percentage', 'ids', 'all']);
  });
});

describe('StepRecord — R-51 metric fields (T-01a · R-51)', () => {
  it('fixture with all metric fields is typed correctly', () => {
    // GIVEN the full fixture declared at module level (compile-time check above)
    // WHEN we read numeric metric fields
    // THEN all values are numbers
    expect(typeof FULL_STEP_RECORD.durationMs).toBe('number');
    expect(typeof FULL_STEP_RECORD.bedrockLatencyMs).toBe('number');
    expect(typeof FULL_STEP_RECORD.inputTokens).toBe('number');
    expect(typeof FULL_STEP_RECORD.outputTokens).toBe('number');
    expect(typeof FULL_STEP_RECORD.inputCharacters).toBe('number');
    expect(typeof FULL_STEP_RECORD.outputCharacters).toBe('number');
    expect(typeof FULL_STEP_RECORD.contextTokenEstimate).toBe('number');
    expect(typeof FULL_STEP_RECORD.costEstimateUsd).toBe('number');
  });

  it('metric fields are optional — a minimal StepRecord compiles without them', () => {
    // GIVEN a step record with only required fields (no metrics yet — e.g. step just started)
    const minimalStep: StepRecord = {
      pk: 'PRUN#run-abc',
      sk: 'STEP#01',
      stepId: 's1',
      stepIndex: 1,
      label: 'Refine',
      model: 'us.anthropic.claude-haiku-4-5',
      promptKey: 'refine-prompt',
      promptVersion: 2,
      status: 'running',
      cacheKey: 'cafe0000',
      startedAt: '2024-01-01T00:00:01.000Z',
    };

    // WHEN we check for metric fields
    // THEN they are all undefined (not yet populated)
    expect(minimalStep.durationMs).toBeUndefined();
    expect(minimalStep.costEstimateUsd).toBeUndefined();
    expect(minimalStep.errorMessage).toBeUndefined();
  });
});

describe('PromptItem — active boolean field (T-01a · R-52)', () => {
  it('active: true is a valid PromptItem', () => {
    // GIVEN the fixture declared at module level (compile-time check above)
    // WHEN we read the active field
    // THEN it is a boolean true
    expect(ACTIVE_PROMPT.active).toBe(true);
    expect(typeof ACTIVE_PROMPT.active).toBe('boolean');
  });

  it('active: false represents a soft-deleted prompt (R-52)', () => {
    // GIVEN a soft-deleted prompt
    // WHEN we read the active field
    // THEN it is a boolean false
    expect(SOFT_DELETED_PROMPT.active).toBe(false);
    expect(typeof SOFT_DELETED_PROMPT.active).toBe('boolean');
  });

  it('uses PRMPT kind prefix — not PROMPT (D-11)', () => {
    // GIVEN the active prompt fixture
    // WHEN we inspect the pk and kind fields
    // THEN they start with PRMPT# and kind is PRMPT
    expect(ACTIVE_PROMPT.pk).toMatch(/^PRMPT#/);
    expect(ACTIVE_PROMPT.sk).toBe('PRMPT');
    expect(ACTIVE_PROMPT.kind).toBe('PRMPT');
  });
});
