import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { listPrmpts, listPrmptVers } from '../src/repository.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

beforeEach(() => ddbMock.reset());

describe('listPrmpts (R-41, R-52)', () => {
  it('scans by PRMPT# prefix instead of the byKind GSI (prompt items have no startedAt)', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ PK: 'PRMPT#a', SK: 'PRMPT', promptKey: 'a', active: true }] });
    const res = await listPrmpts(ddb);
    expect(res.items.map((p) => p.promptKey)).toEqual(['a']);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    const input = ddbMock.commandCalls(ScanCommand)[0].args[0].input;
    expect(input.IndexName).toBeUndefined();
    expect(input.FilterExpression).toContain('begins_with(PK, :prefix)');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':prefix': 'PRMPT#', ':sk': 'PRMPT', ':active': true });
  });

  it('round-trips nextToken through ExclusiveStartKey', async () => {
    const lek = { PK: 'PRMPT#z', SK: 'PRMPT' };
    ddbMock.on(ScanCommand).resolves({ Items: [], LastEvaluatedKey: lek });
    const first = await listPrmpts(ddb);
    expect(first.nextToken).toBeDefined();
    await listPrmpts(ddb, first.nextToken);
    expect(ddbMock.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lek);
  });
});

describe('listPrmptVers (R-32, R-42)', () => {
  it('scans by the prompt\'s PRMPTVER# prefix (version items have no startedAt), paginates, and sorts by version', async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [{ PK: 'PRMPTVER#p#00002', SK: 'PRMPTVER', promptKey: 'p', version: 2 }],
        LastEvaluatedKey: { PK: 'PRMPTVER#p#00002', SK: 'PRMPTVER' },
      })
      .resolvesOnce({ Items: [{ PK: 'PRMPTVER#p#00001', SK: 'PRMPTVER', promptKey: 'p', version: 1 }] });
    const res = await listPrmptVers(ddb, 'p');
    expect(res.map((v) => v.version)).toEqual([1, 2]);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    const calls = ddbMock.commandCalls(ScanCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.IndexName).toBeUndefined();
    expect(calls[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':prefix': 'PRMPTVER#p#', ':sk': 'PRMPTVER' });
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ PK: 'PRMPTVER#p#00002', SK: 'PRMPTVER' });
  });
});
