import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { decideIngest, LockHeldError, repository } from '../src/repository.js';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

describe('decideIngest (T-11 · R-31, R-32, R-33, R-33a · D-16)', () => {
  it('new {source,id} → version 1', () => {
    expect(decideIngest(undefined, { hash: 'h1', declaredVersion: '1.0.0' })).toEqual({
      outcome: 'new',
      nextVersion: 1,
      versionNotBumped: false,
    });
  });
  it('same hash → unchanged, no new version (AC-32)', () => {
    const cur = { hash: 'h1', declaredVersion: '1.0.0', version: 3 };
    expect(decideIngest(cur, { hash: 'h1', declaredVersion: '1.0.0' })).toEqual({
      outcome: 'unchanged',
      nextVersion: 3,
      versionNotBumped: false,
    });
  });
  it('changed hash → new version (AC-33)', () => {
    const cur = { hash: 'h1', declaredVersion: '1.0.0', version: 3 };
    expect(decideIngest(cur, { hash: 'h2', declaredVersion: '1.1.0' })).toEqual({
      outcome: 'new-version',
      nextVersion: 4,
      versionNotBumped: false,
    });
  });
  it('changed hash but same declared version → versionNotBumped (AC-33a)', () => {
    const cur = { hash: 'h1', declaredVersion: '1.0.0', version: 1 };
    expect(decideIngest(cur, { hash: 'h2', declaredVersion: '1.0.0' })).toEqual({
      outcome: 'new-version',
      nextVersion: 2,
      versionNotBumped: true,
    });
  });
});

describe('lock (T-11 · R-15, D-15 · AC-15)', () => {
  it('acquireLock writes a conditional lock item', async () => {
    ddb.on(PutCommand).resolves({});
    await repository.acquireLock('run-1', 300);
    const put = ddb.commandCalls(PutCommand)[0].args[0].input as any;
    expect(put.Item.PK).toBe('LOCK');
    expect(put.ConditionExpression).toMatch(/attribute_not_exists/);
  });
  it('throws LockHeldError carrying the in-flight run id when the lock exists (AC-15, E-11)', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    ddb.on(PutCommand).rejects(err);
    ddb.on(GetCommand).resolves({ Item: { PK: 'LOCK', SK: 'CRAWL', runId: 'run-inflight' } });
    await expect(repository.acquireLock('run-2', 300)).rejects.toMatchObject({
      name: 'LockHeldError',
      runId: 'run-inflight',
    });
  });
});

describe('ingestContract (T-11 · R-30, R-31, R-33, R-41)', () => {
  const file = {
    source: 'publisher',
    id: 'org-1',
    entity: 'org',
    name: 'Org',
    path: 'contract/org.odcs.yaml',
    blobSha: 'h1',
    commitSha: 'c1',
    bytes: 'yaml-bytes',
    declaredVersion: '1.0.0',
    validation: 'valid' as const,
    validationErrors: [],
  };

  it("new contract → puts S3 blob + version row + entry, outcome 'new' (AC-30/31/41)", async () => {
    ddb.on(GetCommand).resolves({}); // no existing entry
    ddb.on(PutCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});
    const r = await repository.ingestContract(file);
    expect(r.outcome).toBe('new');
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(1);
    // entry + version rows written.
    expect(ddb.commandCalls(PutCommand).length).toBeGreaterThanOrEqual(2);
  });

  it('unchanged contract → only touches the entry, no S3 write (AC-32)', async () => {
    ddb.on(GetCommand).resolves({ Item: { currentHash: 'h1', currentVersion: 1, declaredVersion: '1.0.0' } });
    ddb.on(UpdateCommand).resolves({});
    const r = await repository.ingestContract(file);
    expect(r.outcome).toBe('unchanged');
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe('prompt versions (T-04 · prompt-versioning-experiments)', () => {
  const promptRecord = {
    promptVersion: 'v1.0.0',
    text: 'You are a test generator.',
    modelId: 'claude-sonnet-4-6',
    createdAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'test-user',
  };

  it('putPromptVersion — happy path: PutCommand with correct PK and kind:PROMPT', async () => {
    ddb.on(PutCommand).resolves({});
    await repository.putPromptVersion(promptRecord);
    const put = ddb.commandCalls(PutCommand)[0].args[0].input as any;
    expect(put.Item.PK).toBe('PROMPT#v1.0.0');
    expect(put.Item.SK).toBe('PROMPT');
    expect(put.Item.kind).toBe('PROMPT');
    expect(put.ConditionExpression).toMatch(/attribute_not_exists/);
  });

  it('putPromptVersion — conflict: propagates ConditionalCheckFailedException', async () => {
    const err = Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    ddb.on(PutCommand).rejects(err);
    await expect(repository.putPromptVersion(promptRecord)).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
  });

  it('getPromptVersion — found: returns the record', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...promptRecord, PK: 'PROMPT#v1.0.0', SK: 'PROMPT', kind: 'PROMPT' } });
    const result = await repository.getPromptVersion('v1.0.0');
    expect(result?.promptVersion).toBe('v1.0.0');
    const get = ddb.commandCalls(GetCommand)[0].args[0].input as any;
    expect(get.Key.PK).toBe('PROMPT#v1.0.0');
    expect(get.Key.SK).toBe('PROMPT');
  });

  it('getPromptVersion — not found: returns undefined', async () => {
    ddb.on(GetCommand).resolves({});
    const result = await repository.getPromptVersion('v-missing');
    expect(result).toBeUndefined();
  });

  it('listPromptVersions — uses QueryCommand on byKind GSI with kind=PROMPT and ScanIndexForward:false', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...promptRecord, PK: 'PROMPT#v1.0.0', SK: 'PROMPT', kind: 'PROMPT' }] });
    const results = await repository.listPromptVersions();
    expect(results).toHaveLength(1);
    const query = ddb.commandCalls(QueryCommand)[0].args[0].input as any;
    expect(query.IndexName).toBe('byKind');
    expect(query.ExpressionAttributeValues[':k']).toBe('PROMPT');
    expect(query.ScanIndexForward).toBe(false);
    // must not fall back to a table scan
    expect(ddb.commandCalls(ScanCommand)).toHaveLength(0);
  });
});

describe('experiments (T-04 · prompt-versioning-experiments)', () => {
  const experimentRecord = {
    experimentId: 'exp-001',
    kind: 'EXPERIMENT' as const,
    status: 'pending' as const,
    promptVersion: 'v1.0.0',
    createdAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'test-user',
  };

  it('putExperiment — happy path: PutCommand with correct PK/SK', async () => {
    ddb.on(PutCommand).resolves({});
    await repository.putExperiment(experimentRecord);
    const put = ddb.commandCalls(PutCommand)[0].args[0].input as any;
    expect(put.Item.PK).toBe('EXP#exp-001');
    expect(put.Item.SK).toBe('EXP');
  });

  it('updateExperiment — aliases status via ExpressionAttributeNames (reserved word safety)', async () => {
    ddb.on(UpdateCommand).resolves({});
    await repository.updateExperiment('exp-001', { status: 'running' });
    const update = ddb.commandCalls(UpdateCommand)[0].args[0].input as any;
    expect(update.Key.PK).toBe('EXP#exp-001');
    // ExpressionAttributeNames must alias every field to guard against reserved words
    const nameValues = Object.values(update.ExpressionAttributeNames) as string[];
    expect(nameValues).toContain('status');
    // The UpdateExpression must use the alias, not the raw field name
    expect(update.UpdateExpression).toMatch(/#f\d+ = :v\d+/);
  });

  it('getExperiment — not found: returns undefined', async () => {
    ddb.on(GetCommand).resolves({});
    const result = await repository.getExperiment('exp-missing');
    expect(result).toBeUndefined();
  });

  it('listExperiments — uses QueryCommand on byKind GSI with kind=EXPERIMENT and ScanIndexForward:false', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...experimentRecord, PK: 'EXP#exp-001', SK: 'EXP' }] });
    const results = await repository.listExperiments();
    expect(results).toHaveLength(1);
    const query = ddb.commandCalls(QueryCommand)[0].args[0].input as any;
    expect(query.IndexName).toBe('byKind');
    expect(query.ExpressionAttributeValues[':k']).toBe('EXPERIMENT');
    expect(query.ScanIndexForward).toBe(false);
    expect(ddb.commandCalls(ScanCommand)).toHaveLength(0);
  });

  it('putExperimentArtifact — PutObjectCommand with key prefixed experiments/', async () => {
    s3.on(PutObjectCommand).resolves({});
    const key = await repository.putExperimentArtifact('exp-001', { foo: 'bar' });
    expect(key).toMatch(/^experiments\//);
    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(put.Key).toMatch(/^experiments\/exp-001\//);
    expect(put.ContentType).toBe('application/json');
  });

  it('getExperimentArtifact — NoSuchKey returns undefined', async () => {
    const err = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    s3.on(GetObjectCommand).rejects(err);
    const result = await repository.getExperimentArtifact('exp-missing');
    expect(result).toBeUndefined();
  });
});

describe('entity variants + divergence (T-11 · R-34 · AC-34)', () => {
  it('reports divergent=true when variant hashes differ, false when equal', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { source: 'publisher', currentHash: 'hA', currentVersion: 1 },
        { source: 'consumer', currentHash: 'hB', currentVersion: 2 },
      ],
    });
    const d = await repository.getEntityVariants('user');
    expect(d.divergent).toBe(true);

    ddb.on(QueryCommand).resolves({
      Items: [
        { source: 'publisher', currentHash: 'same', currentVersion: 1 },
        { source: 'consumer', currentHash: 'same', currentVersion: 1 },
      ],
    });
    const org = await repository.getEntityVariants('org');
    expect(org.divergent).toBe(false);
  });
});
