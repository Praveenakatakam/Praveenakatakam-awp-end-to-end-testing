/**
 * T-AR-01a — uploadRun + resolveAdversarialConfig (R-5, R-6, R-1a).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadRun, resolveAdversarialConfig } from '../adversarial-review-finalize.js';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
  ddb.on(PutCommand).resolves({});
  s3.on(PutObjectCommand).resolves({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const makeReview = (overrides: object = {}) => ({
  skill: 'adversarial-test-review',
  version: '0.1',
  model: 'claude-fable-5-1',
  scope: 'main',
  verdict: 'PASS',
  pass1WrittenAt: '2026-10-21T14:30:00.000Z',
  finalizedAt: '2026-10-21T14:31:00.000Z',
  findings: [],
  needsDecision: [],
  uncovered: [],
  discardedInstructions: [],
  droppedByPostureLint: 0,
  malformed: 0,
  ...overrides,
});

function makeTmpRun(review: object, includeVerification = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'ar-upload-test-'));
  writeFileSync(join(dir, 'review.json'), JSON.stringify(review));
  if (includeVerification) {
    writeFileSync(join(dir, 'verification.json'), JSON.stringify({ model: 'fable', findings: [] }));
  }
  return dir;
}

describe('resolveAdversarialConfig (T-AR-01a · R-6)', () => {
  it('(a) reads from env vars when both are set', () => {
    vi.stubEnv('ADVERSARIAL_BUCKET', 'my-bucket');
    vi.stubEnv('ADVERSARIAL_TABLE', 'my-table');
    expect(resolveAdversarialConfig()).toEqual({ bucket: 'my-bucket', table: 'my-table' });
  });

  it('(b) reads from .sst/outputs.json when env vars absent', () => {
    vi.stubEnv('ADVERSARIAL_BUCKET', '');
    vi.stubEnv('ADVERSARIAL_TABLE', '');
    const sst = mkdtempSync(join(tmpdir(), 'sst-test-'));
    const sstDir = join(sst, '.sst');
    mkdirSync(sstDir);
    writeFileSync(
      join(sstDir, 'outputs.json'),
      JSON.stringify({ StorageStack: { ContractsBucketName: 'sst-bucket', RegistryTableName: 'sst-table' } }),
    );
    const orig = process.cwd();
    try {
      process.chdir(sst);
      expect(resolveAdversarialConfig()).toEqual({ bucket: 'sst-bucket', table: 'sst-table' });
    } finally {
      process.chdir(orig);
      rmSync(sst, { recursive: true });
    }
  });

  it('(c) throws when neither env vars nor outputs.json available', () => {
    vi.stubEnv('ADVERSARIAL_BUCKET', '');
    vi.stubEnv('ADVERSARIAL_TABLE', '');
    const sst = mkdtempSync(join(tmpdir(), 'sst-empty-'));
    const orig = process.cwd();
    try {
      process.chdir(sst);
      expect(() => resolveAdversarialConfig()).toThrow();
    } finally {
      process.chdir(orig);
      rmSync(sst, { recursive: true });
    }
  });
});

describe('uploadRun (T-AR-01a · R-5, R-1a)', () => {
  beforeEach(() => {
    vi.stubEnv('ADVERSARIAL_BUCKET', 'test-bucket');
    vi.stubEnv('ADVERSARIAL_TABLE', 'test-table');
  });

  it('(d) throws when review.json is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ar-upload-empty-'));
    try {
      await expect(uploadRun(dir)).rejects.toThrow('review.json not found');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('(e) uploads review.json to S3 and puts DynamoDB item (no verification.json)', async () => {
    const review = makeReview();
    const dir = makeTmpRun(review);
    try {
      await uploadRun(dir);
      const s3Calls = s3.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);
      expect(s3Calls[0].args[0].input.Key).toMatch(/^adversarial-runs\/test\/.+\/review\.json$/);
      expect(s3Calls[0].args[0].input.Bucket).toBe('test-bucket');
      expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('(f) uploads verification.json after review.json when present (write order R-1a)', async () => {
    const review = makeReview();
    const dir = makeTmpRun(review, true);
    try {
      await uploadRun(dir);
      const s3Calls = s3.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(2);
      expect(s3Calls[0].args[0].input.Key).toContain('review.json');
      expect(s3Calls[1].args[0].input.Key).toContain('verification.json');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('(g) DynamoDB item has correct shape (kind, reviewKind, startedAt, counts, sha256)', async () => {
    const review = makeReview({
      findings: [{ id: 'F-01', severity: 'Critical', target: 't', defect: 'd', failureScenario: 'fs' }],
    });
    const dir = makeTmpRun(review);
    try {
      await uploadRun(dir);
      const item = ddb.commandCalls(PutCommand)[0].args[0].input.Item!;
      expect(item['kind']).toBe('ADVERSARIAL_TEST');
      expect(item['reviewKind']).toBe('test');
      expect(item['startedAt']).toBe('2026-10-21T14:30:00.000Z');
      expect(item['countCritical']).toBe(1);
      expect(item['countMajor']).toBe(0);
      expect(item['reviewSha256']).toMatch(/^[a-f0-9]{64}$/);
      expect(item['PK']).toBe('ADV#ADVERSARIAL_TEST');
      expect(item['verificationStatus']).toBe('not_run');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
