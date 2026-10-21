/**
 * T-AR-02a — adversarial runs API handlers (R-8, R-9, R-35).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { listAdversarialRuns, getAdversarialFindings } from '../src/adversarialRuns.js';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

const ev = (pathParameters: Record<string, string> = {}, queryStringParameters: Record<string, string> = {}) =>
  ({ pathParameters, queryStringParameters }) as any;

const run = {
  PK: 'ADV#ADVERSARIAL_TEST',
  SK: '20261021-1430_test_main',
  kind: 'ADVERSARIAL_TEST',
  reviewKind: 'test',
  startedAt: '2026-10-21T14:30:00Z',
  scope: 'main',
  verdict: 'PASS',
  countCritical: 0,
  countMajor: 0,
  countMinor: 1,
  reviewSha256: 'abc123',
  verificationStatus: 'ok',
};

const reviewData = {
  skill: 'adversarial-test-review',
  scope: 'main',
  verdict: 'PASS',
  findings: [{ id: 'F-01', severity: 'Minor', target: 'f.ts', defect: 'd', failureScenario: 'fs' }],
  verification: { status: 'ok', confirmed: 0, refuted: 0, unclear: 0, notVerified: 1 },
};
const reviewJson = JSON.stringify(reviewData);
const reviewSha256 = createHash('sha256').update(reviewJson).digest('hex');

describe('listAdversarialRuns (T-AR-02a · R-8)', () => {
  it('(a) missing kind → 400', async () => {
    const res = await listAdversarialRuns(ev());
    expect(res.statusCode).toBe(400);
  });

  it('(b) invalid kind value → 400', async () => {
    const res = await listAdversarialRuns(ev({}, { kind: 'invalid' }));
    expect(res.statusCode).toBe(400);
  });

  it('(c) kind=test → queries byKind with ADVERSARIAL_TEST, returns mapped list', async () => {
    ddb.on(QueryCommand).resolves({ Items: [run] });
    const res = await listAdversarialRuns(ev({}, { kind: 'test' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body).toHaveLength(1);
    expect(body[0].reviewKind).toBe('test');
    expect(body[0].run_dir).toBe('20261021-1430_test_main');
    expect(body[0].verificationStatus).toBe('ok');
    const call = ddb.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues?.[':k']).toBe('ADVERSARIAL_TEST');
    expect(call.args[0].input.IndexName).toBe('byKind');
    expect(call.args[0].input.ScanIndexForward).toBe(false);
    expect(call.args[0].input.Limit).toBe(100);
  });

  it('(d) kind=code → queries with ADVERSARIAL_CODE', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await listAdversarialRuns(ev({}, { kind: 'code' }));
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues?.[':k']).toBe('ADVERSARIAL_CODE');
  });

  it('(e) empty result → empty array', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const res = await listAdversarialRuns(ev({}, { kind: 'test' }));
    expect(JSON.parse(res.body!)).toEqual([]);
  });
});

describe('getAdversarialFindings (T-AR-02a · R-9)', () => {
  it('(f) missing path params → 404', async () => {
    const res = await getAdversarialFindings(ev());
    expect(res.statusCode).toBe(404);
  });

  it('(g) run not in DynamoDB → 404', async () => {
    ddb.on(GetCommand).resolves({ Item: undefined });
    const res = await getAdversarialFindings(ev({ kind: 'test', run_dir: '20261021-1430_test_main' }));
    expect(res.statusCode).toBe(404);
  });

  it('(h) S3 GetObject fails (run_dir not found in S3) → 404', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...run, reviewSha256 } });
    s3.on(GetObjectCommand).rejects(new Error('NoSuchKey'));
    const res = await getAdversarialFindings(ev({ kind: 'test', run_dir: '20261021-1430_test_main' }));
    expect(res.statusCode).toBe(404);
  });

  it('(i) SHA-256 mismatch → 409', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...run, reviewSha256: 'wronghash' } });
    s3.on(GetObjectCommand).resolves({ Body: { transformToString: async () => reviewJson } as any });
    const res = await getAdversarialFindings(ev({ kind: 'test', run_dir: '20261021-1430_test_main' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body!).error).toBe('integrity_mismatch');
  });

  it('(j) success → 200 with findings and verificationStatus', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...run, reviewSha256 } });
    s3.on(GetObjectCommand).resolves({ Body: { transformToString: async () => reviewJson } as any });
    const res = await getAdversarialFindings(ev({ kind: 'test', run_dir: '20261021-1430_test_main' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body.findings).toHaveLength(1);
    expect(body.verificationStatus).toBe('ok');
    // Verify S3 key shape (adversarial-runs/{kind}/{run_dir}/review.json)
    const s3Call = s3.commandCalls(GetObjectCommand)[0];
    expect(s3Call.args[0].input.Key).toBe('adversarial-runs/test/20261021-1430_test_main/review.json');
  });
});
