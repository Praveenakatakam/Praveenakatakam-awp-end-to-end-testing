import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { repository } from '../src/repository.js';
import type { ParsedRequirement } from '@registry/core';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

/** Minimal S3 body that mimics the AWS SDK's transformToString(). */
function s3Body(text: string) {
  return { transformToString: async () => text } as any;
}

function req(id: string, text: string, over: Partial<ParsedRequirement> = {}): ParsedRequirement {
  return {
    id,
    text,
    section: over.section ?? 'Some Section',
    earsType: over.earsType ?? 'ubiquitous',
    modality: over.modality ?? 'SHALL',
    earsConforming: over.earsConforming ?? true,
    ...(over.rawText !== undefined ? { rawText: over.rawText } : {}),
    ...(over.jiraUrl !== undefined ? { jiraUrl: over.jiraUrl } : {}),
  };
}

/** Flatten every put/delete request across all BatchWrite calls for a table. */
function batchRequests() {
  const puts: any[] = [];
  const deletes: any[] = [];
  for (const call of ddb.commandCalls(BatchWriteCommand)) {
    const input = call.args[0].input as any;
    for (const reqItems of Object.values(input.RequestItems) as any[]) {
      for (const r of reqItems) {
        if (r.PutRequest) puts.push(r.PutRequest.Item);
        if (r.DeleteRequest) deletes.push(r.DeleteRequest.Key);
      }
    }
  }
  return { puts, deletes };
}

describe('putRequirements — snapshot replace + change flags (T-28 · R-106, R-107, R-108, R-114)', () => {
  it('first crawl (no prior): all requirements flagged changed, persisted with full fields + raw spec in S3', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior items
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements(
      'publisher',
      [req('R-01', 'The system SHALL x'), req('R-20', 'Before returning, validates', { modality: null, earsConforming: false })],
      { contentHash: 'sha-abc', sourceVersion: '1.2.3', rawSnapshot: '# spec bytes', snapshotKey: 'requirements/publisher/snapshot.md' }
    );

    expect(counts).toEqual({ discovered: 2, conforming: 1, nonConforming: 1, changed: 2, removed: 0 });

    const { puts } = batchRequests();
    expect(puts).toHaveLength(2);
    const r01 = puts.find((p) => p.id === 'R-01');
    expect(r01).toMatchObject({
      PK: 'REQ#publisher',
      SK: 'R#R-01',
      source: 'publisher',
      id: 'R-01',
      text: 'The system SHALL x',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: true,
      contentHash: 'sha-abc',
      sourceVersion: '1.2.3',
    });
    expect(r01.lastCrawledAt).toBeTruthy();

    // raw snapshot stored in S3 at the caller-supplied key (R-114).
    const s3put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(s3put.Key).toBe('requirements/publisher/snapshot.md');
    expect(s3put.Body).toBe('# spec bytes');
    expect(s3put.ContentType).toBe('text/markdown');
  });

  it('picks the S3 content type from the snapshot key extension (.md, .json, or a plain fallback)', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    await repository.putRequirements('jira-awp', [req('BAWP-1', 'a')], {
      contentHash: 'h',
      rawSnapshot: '[]',
      snapshotKey: 'requirements/jira-awp/snapshot.json',
    });
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input.ContentType).toBe('application/json');

    s3.resetHistory();
    await repository.putRequirements('other', [req('R-01', 'a')], {
      contentHash: 'h',
      rawSnapshot: 'bytes',
      snapshotKey: 'requirements/other/snapshot.bin',
    });
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input.ContentType).toBe('text/plain');
  });

  it('re-crawl: changed text flagged, unchanged not, removed ids deleted, counts correct (AC-107/108)', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { PK: 'REQ#publisher', SK: 'R#R-01', id: 'R-01', text: 't1 OLD' },
        { PK: 'REQ#publisher', SK: 'R#R-02', id: 'R-02', text: 't2 same' },
        { PK: 'REQ#publisher', SK: 'R#R-99', id: 'R-99', text: 'going away' },
      ],
    });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements(
      'publisher',
      [
        req('R-01', 't1 NEW'), // text changed
        req('R-02', 't2 same'), // unchanged
        req('R-03', 't3 brand new'), // new
      ],
      { contentHash: 'sha-2', sourceVersion: '1.2.4', rawSnapshot: 'bytes2', snapshotKey: 'requirements/publisher/snapshot.md' }
    );

    expect(counts).toEqual({ discovered: 3, conforming: 3, nonConforming: 0, changed: 2, removed: 1 });

    const { puts, deletes } = batchRequests();
    const flag = (id: string) => puts.find((p) => p.id === id)?.changedInLastCrawl;
    expect(flag('R-01')).toBe(true); // changed
    expect(flag('R-02')).toBe(false); // unchanged
    expect(flag('R-03')).toBe(true); // new
    expect(deletes).toEqual([{ PK: 'REQ#publisher', SK: 'R#R-99' }]); // removed
  });
});

describe('putRequirements — de-dups a repeated R-nn within a source (HC · R-106, mirrors R-30a)', () => {
  it('keeps the first occurrence so the batch has no duplicate keys', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements(
      'publisher',
      [req('R-01', 'first'), req('R-01', 'SECOND — duplicate id'), req('R-02', 'other')],
      { contentHash: 'h', rawSnapshot: 'b', snapshotKey: 'requirements/publisher/snapshot.md' }
    );

    // duplicate id collapsed → discovered counts the de-duped set, collision recorded (D-49)
    expect(counts.discovered).toBe(2);
    expect(counts.collisions).toEqual(['R-01']);
    const { puts } = batchRequests();
    expect(puts.map((p) => p.id).sort()).toEqual(['R-01', 'R-02']);
    // the FIRST R-01 wins
    expect(puts.find((p) => p.id === 'R-01').text).toBe('first');
  });

  it('carries rawText + jiraUrl onto the DynamoDB item when present on the parsed requirement', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    await repository.putRequirements(
      'jira-awp',
      [req('BAWP-1', 'WHEN x THE system SHALL y', { rawText: 'raw AC text', jiraUrl: 'https://collegeboard.atlassian.net/browse/BAWP-1' })],
      { contentHash: 'h', rawSnapshot: '[]', snapshotKey: 'requirements/jira-awp/snapshot.json' }
    );

    const { puts } = batchRequests();
    expect(puts[0]).toMatchObject({ rawText: 'raw AC text', jiraUrl: 'https://collegeboard.atlassian.net/browse/BAWP-1' });
  });

  it('omits rawText + jiraUrl from the DynamoDB item when absent on the parsed requirement (not stored as null)', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    await repository.putRequirements('publisher', [req('R-01', 'a')], {
      contentHash: 'h',
      rawSnapshot: 'b',
      snapshotKey: 'requirements/publisher/snapshot.md',
    });

    const { puts } = batchRequests();
    expect(puts[0]).not.toHaveProperty('rawText');
    expect(puts[0]).not.toHaveProperty('jiraUrl');
  });

  it('skips the S3 write entirely when snapshotKey is omitted', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});

    await repository.putRequirements('jira-awp', [req('BAWP-1', 'a')], { contentHash: 'h' });

    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it('omits `collisions` when there are no duplicates', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});
    const counts = await repository.putRequirements('publisher', [req('R-01', 'a')], { contentHash: 'h', rawSnapshot: 'b', snapshotKey: 'requirements/publisher/snapshot.md' });
    expect(counts.collisions).toBeUndefined();
  });
});

describe('listRequirements — deterministic natural-id order (HC · R-109)', () => {
  it('sorts by source then natural requirement id, regardless of scan order', async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        { PK: 'REQ#publisher', SK: 'R#R-100', source: 'publisher', id: 'R-100', earsConforming: true },
        { PK: 'REQ#consumer', SK: 'R#R-2', source: 'consumer', id: 'R-2', earsConforming: true },
        { PK: 'REQ#publisher', SK: 'R#R-2', source: 'publisher', id: 'R-2', earsConforming: true },
        { PK: 'REQ#publisher', SK: 'R#R-10', source: 'publisher', id: 'R-10', earsConforming: true },
      ],
    });
    const out = await repository.listRequirements();
    // R-2 < R-10 < R-100 (natural, not lexicographic); consumer before publisher
    expect(out.map((r) => `${r.source}/${r.id}`)).toEqual(['consumer/R-2', 'publisher/R-2', 'publisher/R-10', 'publisher/R-100']);
  });
});

describe('putRequirements([]) — present-but-empty spec wipes the snapshot (HC · R-105, R-107)', () => {
  it('writes no puts and deletes every prior requirement (discovered 0, removed = prior)', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { id: 'R-01', text: 'a' },
        { id: 'R-02', text: 'b' },
      ],
    });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements('publisher', [], { contentHash: 'h', rawSnapshot: 'b', snapshotKey: 'requirements/publisher/snapshot.md' });

    expect(counts).toMatchObject({ discovered: 0, removed: 2 });
    const { puts, deletes } = batchRequests();
    expect(puts).toHaveLength(0);
    expect(deletes.map((d) => d.SK).sort()).toEqual(['R#R-01', 'R#R-02']);
  });
});

describe('putRequirements — retries UnprocessedItems (HC · R-107, NFR-4)', () => {
  it('re-sends items DynamoDB declines until the batch drains', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior
    s3.on(PutObjectCommand).resolves({});
    // First BatchWrite leaves one item unprocessed; the retry accepts it.
    const unprocessed = { PutRequest: { Item: { PK: 'REQ#publisher', SK: 'R#R-01' } } };
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { Registry: [unprocessed] } })
      .resolves({});

    await repository.putRequirements('publisher', [req('R-01', 'x')], { contentHash: 'h', rawSnapshot: 'b', snapshotKey: 'requirements/publisher/snapshot.md' });

    // initial send + a retry that carries the previously-unprocessed item (not the wrong batch)
    const calls = ddb.commandCalls(BatchWriteCommand);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[1].args[0].input as any).RequestItems.Registry).toContainEqual(unprocessed);
  });
});

describe('wipeRequirements — absent docs/spec.md wipes the snapshot (T-28 · R-105, D-45)', () => {
  it("deletes all the source's requirement items + the S3 spec object, returns removed=prior count", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ id: 'R-01' }, { id: 'R-02' }, { id: 'R-03' }] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});

    const counts = await repository.wipeRequirements('publisher');
    expect(counts).toEqual({ discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 3 });

    const { deletes } = batchRequests();
    expect(deletes).toEqual([
      { PK: 'REQ#publisher', SK: 'R#R-01' },
      { PK: 'REQ#publisher', SK: 'R#R-02' },
      { PK: 'REQ#publisher', SK: 'R#R-03' },
    ]);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0); // no snapshotKey passed — no S3 delete
  });

  it('is a no-op delete (removed=0) when the source had no prior requirements', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    s3.on(DeleteObjectCommand).resolves({});
    const counts = await repository.wipeRequirements('consumer');
    expect(counts.removed).toBe(0);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0); // nothing to delete
  });
});

describe('requirements reads (T-28 · R-109, R-110, R-111, R-112)', () => {
  const items = [
    {
      PK: 'REQ#publisher',
      SK: 'R#R-01',
      source: 'publisher',
      id: 'R-01',
      section: 'Contract',
      earsType: 'ubiquitous',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: false,
      sourceVersion: '0.1.0',
      contentHash: 'h1',
      lastCrawledAt: '2026-07-15T00:00:00Z',
    },
    {
      PK: 'REQ#publisher',
      SK: 'R#R-10',
      source: 'publisher',
      id: 'R-10',
      section: 'API',
      earsType: 'event',
      modality: 'SHALL',
      earsConforming: true,
      changedInLastCrawl: true,
      sourceVersion: '0.1.0',
      contentHash: 'h1',
      lastCrawledAt: '2026-07-15T00:00:00Z',
    },
    {
      PK: 'REQ#consumer',
      SK: 'R#R-20',
      source: 'consumer',
      id: 'R-20',
      section: 'Ingest',
      earsType: 'ubiquitous',
      modality: null,
      earsConforming: false,
      changedInLastCrawl: false,
      sourceVersion: '0.1.0',
      contentHash: 'h2',
      lastCrawledAt: '2026-07-15T00:00:00Z',
    },
  ];

  it('listRequirements returns all, and honours source / earsType / conforming filters', async () => {
    ddb.on(ScanCommand).resolves({ Items: items });
    expect(await repository.listRequirements()).toHaveLength(3);
    expect((await repository.listRequirements({ source: 'publisher' })).map((r) => r.id)).toEqual(['R-01', 'R-10']);
    expect((await repository.listRequirements({ earsType: 'event' })).map((r) => r.id)).toEqual(['R-10']);
    expect((await repository.listRequirements({ conforming: false })).map((r) => r.id)).toEqual(['R-20']);
    expect((await repository.listRequirements({ conforming: true })).map((r) => r.id)).toEqual(['R-01', 'R-10']);
  });

  it('getRequirementsForSource returns the set + spec metadata, or undefined when none', async () => {
    ddb.on(QueryCommand).resolves({ Items: items.filter((i) => i.source === 'publisher') });
    const got = await repository.getRequirementsForSource('publisher');
    expect(got).toMatchObject({ source: 'publisher', sourceVersion: '0.1.0', contentHash: 'h1', lastCrawledAt: '2026-07-15T00:00:00Z' });
    expect(got!.requirements.map((r) => r.id)).toEqual(['R-01', 'R-10']);

    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await repository.getRequirementsForSource('nope')).toBeUndefined();
  });

  it('getRequirement returns one, or undefined (feeds AC-112 404)', async () => {
    ddb.on(GetCommand).resolves({ Item: items[0] });
    expect(await repository.getRequirement('publisher', 'R-01')).toMatchObject({ id: 'R-01' });
    ddb.on(GetCommand).resolves({});
    expect(await repository.getRequirement('publisher', 'R-404')).toBeUndefined();
  });
});

describe('EARS conversion cache (JR-23, design §3.4)', () => {
  it('getEarsCache returns null on a cache miss (NoSuchKey)', async () => {
    s3.on(GetObjectCommand).rejects(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));
    expect(await repository.getEarsCache('somehash')).toBeNull();
  });

  it('getEarsCache returns the cached text verbatim on a hit', async () => {
    s3.on(GetObjectCommand).resolves({ Body: s3Body('WHEN x THE system SHALL y') });
    expect(await repository.getEarsCache('somehash')).toBe('WHEN x THE system SHALL y');
  });

  it('getEarsCache rethrows non-NoSuchKey S3 errors', async () => {
    s3.on(GetObjectCommand).rejects(new Error('S3 unavailable'));
    await expect(repository.getEarsCache('somehash')).rejects.toThrow('S3 unavailable');
  });

  it('putEarsCache writes the raw string (not JSON-stringified) under requirements/ears-cache/{hash}.json', async () => {
    s3.on(PutObjectCommand).resolves({});
    await repository.putEarsCache('somehash', 'WHEN x THE system SHALL y');
    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(put.Key).toBe('requirements/ears-cache/somehash.json');
    expect(put.Body).toBe('WHEN x THE system SHALL y');
    expect(put.ContentType).toBe('application/json');
  });

  it('putEarsCache swallows S3 errors rather than throwing', async () => {
    s3.on(PutObjectCommand).rejects(new Error('S3 unavailable'));
    await expect(repository.putEarsCache('somehash', 'text')).resolves.toBeUndefined();
  });

  it('putEarsCache and getEarsCache address the same S3 key for a given hash', async () => {
    s3.on(PutObjectCommand).resolves({});
    await repository.putEarsCache('roundtriphash', 'text');
    const putKey = (s3.commandCalls(PutObjectCommand)[0].args[0].input as any).Key;

    s3.reset();
    s3.on(GetObjectCommand).resolves({ Body: s3Body('text') });
    await repository.getEarsCache('roundtriphash');
    const getKey = (s3.commandCalls(GetObjectCommand)[0].args[0].input as any).Key;

    expect(putKey).toBe(getKey);
  });
});
