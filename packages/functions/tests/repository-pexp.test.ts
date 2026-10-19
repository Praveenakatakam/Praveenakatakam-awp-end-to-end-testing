/**
 * PEXP repository helpers (v0.6.0 · R-80, R-82): putPexp / getPexp / listPexps
 * and the chunked PRUN-header BatchGet used for status aggregation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { putPexp, getPexp, listPexps, batchGetPruns } from '../src/repository.js';
import type { PipelineExperiment } from '@registry/core';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

beforeEach(() => ddbMock.reset());

const pexp: PipelineExperiment = {
  pk: 'PEXP#e1',
  sk: 'PEXP',
  kind: 'PEXP',
  experimentId: 'e1',
  pipelineId: 'p1',
  pipelineName: 'P',
  pipelineConfigVersion: 1,
  sampling: { strategy: 'all' },
  mode: 'per_requirement',
  runs: [{ runId: 'r1', requirementIds: ['publisher/R-1'] }],
  skipped: [],
  createdAt: '2026-10-19T00:00:00Z',
  startedAt: '2026-10-19T00:00:00Z',
  createdBy: 'w',
};

describe('PEXP repository helpers', () => {
  it('putPexp writes PEXP#<id> / PEXP with kind + startedAt so byKind indexes it', async () => {
    ddbMock.on(PutCommand).resolves({});
    await putPexp(ddb, pexp);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item).toMatchObject({ PK: 'PEXP#e1', SK: 'PEXP', kind: 'PEXP', startedAt: '2026-10-19T00:00:00Z' });
  });

  it('getPexp reads by key', async () => {
    ddbMock.on(GetCommand).resolves({ Item: pexp });
    expect(await getPexp(ddb, 'e1')).toEqual(pexp);
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({ PK: 'PEXP#e1', SK: 'PEXP' });
  });

  it('listPexps queries byKind for kind=PEXP newest-first and round-trips nextToken', async () => {
    const lek = { PK: 'PEXP#z', SK: 'PEXP', kind: 'PEXP', startedAt: 'x' };
    ddbMock.on(QueryCommand).resolves({ Items: [pexp], LastEvaluatedKey: lek });
    const first = await listPexps(ddb);
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.IndexName).toBe('byKind');
    expect(input.ExpressionAttributeValues).toEqual({ ':k': 'PEXP' });
    expect(input.ScanIndexForward).toBe(false);
    expect(first.items).toEqual([pexp]);
    await listPexps(ddb, first.nextToken);
    expect(ddbMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lek);
  });

  it('batchGetPruns chunks at 100 keys and retries unprocessed keys', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `r${i}`);
    let first = true;
    ddbMock.on(BatchGetCommand).callsFake((input) => {
      const keys = input.RequestItems.Registry.Keys as { PK: string }[];
      const runs = keys.map((k) => ({ runId: k.PK.slice('PRUN#'.length), status: 'completed' }));
      if (first) {
        first = false;
        // Leave the last key of the first chunk unprocessed.
        return { Responses: { Registry: runs.slice(0, -1) }, UnprocessedKeys: { Registry: { Keys: [keys[keys.length - 1]] } } };
      }
      return { Responses: { Registry: runs } };
    });
    const out = await batchGetPruns(ddb, ids);
    expect(out.size).toBe(150);
    const calls = ddbMock.commandCalls(BatchGetCommand).map((c) => c.args[0].input.RequestItems!.Registry.Keys!.length);
    expect(calls).toEqual([100, 1, 50]);
  });
});
