import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { repository } from "../src/repository.js";
import type { ParsedRequirement } from "@registry/core";

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

function req(id: string, text: string, over: Partial<ParsedRequirement> = {}): ParsedRequirement {
  return {
    id,
    text,
    section: over.section ?? "Some Section",
    earsType: over.earsType ?? "ubiquitous",
    modality: over.modality ?? "SHALL",
    earsConforming: over.earsConforming ?? true,
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

describe("putRequirements — snapshot replace + change flags (T-28 · R-106, R-107, R-108, R-114)", () => {
  it("first crawl (no prior): all requirements flagged changed, persisted with full fields + raw spec in S3", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior items
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements("publisher", [
      req("R-01", "The system SHALL x"),
      req("R-20", "Before returning, validates", { modality: null, earsConforming: false }),
    ], { specHash: "sha-abc", specVersion: "1.2.3", rawSpec: "# spec bytes" });

    expect(counts).toEqual({ discovered: 2, conforming: 1, nonConforming: 1, changed: 2, removed: 0 });

    const { puts } = batchRequests();
    expect(puts).toHaveLength(2);
    const r01 = puts.find((p) => p.id === "R-01");
    expect(r01).toMatchObject({
      PK: "REQ#publisher", SK: "R#R-01", source: "publisher", id: "R-01",
      text: "The system SHALL x", modality: "SHALL", earsConforming: true,
      changedInLastCrawl: true, specHash: "sha-abc", specVersion: "1.2.3",
    });
    expect(r01.lastCrawledAt).toBeTruthy();

    // raw docs/spec.md stored in S3 at the per-source key (R-114).
    const s3put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(s3put.Key).toBe("requirements/publisher/spec.md");
    expect(s3put.Body).toBe("# spec bytes");
  });

  it("re-crawl: changed text flagged, unchanged not, removed ids deleted, counts correct (AC-107/108)", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { PK: "REQ#publisher", SK: "R#R-01", id: "R-01", text: "t1 OLD" },
        { PK: "REQ#publisher", SK: "R#R-02", id: "R-02", text: "t2 same" },
        { PK: "REQ#publisher", SK: "R#R-99", id: "R-99", text: "going away" },
      ],
    });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements("publisher", [
      req("R-01", "t1 NEW"),        // text changed
      req("R-02", "t2 same"),       // unchanged
      req("R-03", "t3 brand new"),  // new
    ], { specHash: "sha-2", specVersion: "1.2.4", rawSpec: "bytes2" });

    expect(counts).toEqual({ discovered: 3, conforming: 3, nonConforming: 0, changed: 2, removed: 1 });

    const { puts, deletes } = batchRequests();
    const flag = (id: string) => puts.find((p) => p.id === id)?.changedInLastCrawl;
    expect(flag("R-01")).toBe(true);   // changed
    expect(flag("R-02")).toBe(false);  // unchanged
    expect(flag("R-03")).toBe(true);   // new
    expect(deletes).toEqual([{ PK: "REQ#publisher", SK: "R#R-99" }]); // removed
  });
});

describe("putRequirements — de-dups a repeated R-nn within a source (HC · R-106, mirrors R-30a)", () => {
  it("keeps the first occurrence so the batch has no duplicate keys", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements("publisher", [
      req("R-01", "first"),
      req("R-01", "SECOND — duplicate id"),
      req("R-02", "other"),
    ], { specHash: "h", rawSpec: "b" });

    // duplicate id collapsed → discovered counts the de-duped set, collision recorded (D-49)
    expect(counts.discovered).toBe(2);
    expect(counts.collisions).toEqual(["R-01"]);
    const { puts } = batchRequests();
    expect(puts.map((p) => p.id).sort()).toEqual(["R-01", "R-02"]);
    // the FIRST R-01 wins
    expect(puts.find((p) => p.id === "R-01").text).toBe("first");
  });

  it("omits `collisions` when there are no duplicates", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});
    const counts = await repository.putRequirements("publisher", [req("R-01", "a")], { specHash: "h", rawSpec: "b" });
    expect(counts.collisions).toBeUndefined();
  });
});

describe("listRequirements — deterministic natural-id order (HC · R-109)", () => {
  it("sorts by source then natural requirement id, regardless of scan order", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        { PK: "REQ#publisher", SK: "R#R-100", source: "publisher", id: "R-100", earsConforming: true },
        { PK: "REQ#consumer", SK: "R#R-2", source: "consumer", id: "R-2", earsConforming: true },
        { PK: "REQ#publisher", SK: "R#R-2", source: "publisher", id: "R-2", earsConforming: true },
        { PK: "REQ#publisher", SK: "R#R-10", source: "publisher", id: "R-10", earsConforming: true },
      ],
    });
    const out = await repository.listRequirements();
    // R-2 < R-10 < R-100 (natural, not lexicographic); consumer before publisher
    expect(out.map((r) => `${r.source}/${r.id}`)).toEqual([
      "consumer/R-2",
      "publisher/R-2",
      "publisher/R-10",
      "publisher/R-100",
    ]);
  });
});

describe("putRequirements([]) — present-but-empty spec wipes the snapshot (HC · R-105, R-107)", () => {
  it("writes no puts and deletes every prior requirement (discovered 0, removed = prior)", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ id: "R-01", text: "a" }, { id: "R-02", text: "b" }] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});

    const counts = await repository.putRequirements("publisher", [], { specHash: "h", rawSpec: "b" });

    expect(counts).toMatchObject({ discovered: 0, removed: 2 });
    const { puts, deletes } = batchRequests();
    expect(puts).toHaveLength(0);
    expect(deletes.map((d) => d.SK).sort()).toEqual(["R#R-01", "R#R-02"]);
  });
});

describe("putRequirements — retries UnprocessedItems (HC · R-107, NFR-4)", () => {
  it("re-sends items DynamoDB declines until the batch drains", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no prior
    s3.on(PutObjectCommand).resolves({});
    // First BatchWrite leaves one item unprocessed; the retry accepts it.
    const unprocessed = { PutRequest: { Item: { PK: "REQ#publisher", SK: "R#R-01" } } };
    ddb.on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { Registry: [unprocessed] } })
      .resolves({});

    await repository.putRequirements("publisher", [req("R-01", "x")], { specHash: "h", rawSpec: "b" });

    // initial send + a retry that carries the previously-unprocessed item (not the wrong batch)
    const calls = ddb.commandCalls(BatchWriteCommand);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[1].args[0].input as any).RequestItems.Registry).toContainEqual(unprocessed);
  });
});

describe("wipeRequirements — absent docs/spec.md wipes the snapshot (T-28 · R-105, D-45)", () => {
  it("deletes all the source's requirement items + the S3 spec object, returns removed=prior count", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ id: "R-01" }, { id: "R-02" }, { id: "R-03" }] });
    ddb.on(BatchWriteCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});

    const counts = await repository.wipeRequirements("publisher");
    expect(counts).toEqual({ discovered: 0, conforming: 0, nonConforming: 0, changed: 0, removed: 3 });

    const { deletes } = batchRequests();
    expect(deletes).toEqual([
      { PK: "REQ#publisher", SK: "R#R-01" },
      { PK: "REQ#publisher", SK: "R#R-02" },
      { PK: "REQ#publisher", SK: "R#R-03" },
    ]);
    expect(s3.commandCalls(DeleteObjectCommand)[0].args[0].input).toMatchObject({ Key: "requirements/publisher/spec.md" });
  });

  it("is a no-op delete (removed=0) when the source had no prior requirements", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    s3.on(DeleteObjectCommand).resolves({});
    const counts = await repository.wipeRequirements("consumer");
    expect(counts.removed).toBe(0);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0); // nothing to delete
  });
});

describe("requirements reads (T-28 · R-109, R-110, R-111, R-112)", () => {
  const items = [
    { PK: "REQ#publisher", SK: "R#R-01", source: "publisher", id: "R-01", section: "Contract", earsType: "ubiquitous", modality: "SHALL", earsConforming: true, changedInLastCrawl: false, specVersion: "0.1.0", specHash: "h1", lastCrawledAt: "2026-07-15T00:00:00Z" },
    { PK: "REQ#publisher", SK: "R#R-10", source: "publisher", id: "R-10", section: "API", earsType: "event", modality: "SHALL", earsConforming: true, changedInLastCrawl: true, specVersion: "0.1.0", specHash: "h1", lastCrawledAt: "2026-07-15T00:00:00Z" },
    { PK: "REQ#consumer", SK: "R#R-20", source: "consumer", id: "R-20", section: "Ingest", earsType: "ubiquitous", modality: null, earsConforming: false, changedInLastCrawl: false, specVersion: "0.1.0", specHash: "h2", lastCrawledAt: "2026-07-15T00:00:00Z" },
  ];

  it("listRequirements returns all, and honours source / earsType / conforming filters", async () => {
    ddb.on(ScanCommand).resolves({ Items: items });
    expect(await repository.listRequirements()).toHaveLength(3);
    expect((await repository.listRequirements({ source: "publisher" })).map((r) => r.id)).toEqual(["R-01", "R-10"]);
    expect((await repository.listRequirements({ earsType: "event" })).map((r) => r.id)).toEqual(["R-10"]);
    expect((await repository.listRequirements({ conforming: false })).map((r) => r.id)).toEqual(["R-20"]);
    expect((await repository.listRequirements({ conforming: true })).map((r) => r.id)).toEqual(["R-01", "R-10"]);
  });

  it("getRequirementsForSource returns the set + spec metadata, or undefined when none", async () => {
    ddb.on(QueryCommand).resolves({ Items: items.filter((i) => i.source === "publisher") });
    const got = await repository.getRequirementsForSource("publisher");
    expect(got).toMatchObject({ source: "publisher", specVersion: "0.1.0", specHash: "h1", lastCrawledAt: "2026-07-15T00:00:00Z" });
    expect(got!.requirements.map((r) => r.id)).toEqual(["R-01", "R-10"]);

    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await repository.getRequirementsForSource("nope")).toBeUndefined();
  });

  it("getRequirement returns one, or undefined (feeds AC-112 404)", async () => {
    ddb.on(GetCommand).resolves({ Item: items[0] });
    expect(await repository.getRequirement("publisher", "R-01")).toMatchObject({ id: "R-01" });
    ddb.on(GetCommand).resolves({});
    expect(await repository.getRequirement("publisher", "R-404")).toBeUndefined();
  });
});
