import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { repository } from "../src/repository.js";

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  s3.reset();
});

describe("generation-run repository (T-20 · R-89, R-90)", () => {
  it("writeGenRun persists a GEN item with kind=GENERATION (AC-89)", async () => {
    ddb.on(PutCommand).resolves({});
    await repository.writeGenRun({ runId: "g-1", startedAt: "2026-07-09T00:00:00Z" } as any);
    const call = ddb.commandCalls(PutCommand)[0].args[0].input as any;
    expect(call.Item.PK).toBe("GEN#g-1");
    expect(call.Item.SK).toBe("GEN");
    expect(call.Item.kind).toBe("GENERATION");
    expect(call.Item.startedAt).toBe("2026-07-09T00:00:00Z");
  });

  it("listGenRuns queries byKind=GENERATION newest-first (disjoint from CRAWL)", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ runId: "g-2" }, { runId: "g-1" }] });
    const runs = await repository.listGenRuns();
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input as any;
    expect(input.IndexName).toBe("byKind");
    expect(input.ExpressionAttributeValues[":k"]).toBe("GENERATION");
    expect(input.ScanIndexForward).toBe(false);
    expect(runs.map((r: any) => r.runId)).toEqual(["g-2", "g-1"]);
  });

  it("getLatestGenRun returns the first (newest) run, undefined when none", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ runId: "g-9" }, { runId: "g-8" }] });
    expect((await repository.getLatestGenRun()).runId).toBe("g-9");
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await repository.getLatestGenRun()).toBeUndefined();
  });

  it("getGenRun fetches by runId", async () => {
    ddb.on(GetCommand).resolves({ Item: { runId: "g-1", counts: { conformance: 2 } } });
    const run = await repository.getGenRun("g-1");
    const key = (ddb.commandCalls(GetCommand)[0].args[0].input as any).Key;
    expect(key).toEqual({ PK: "GEN#g-1", SK: "GEN" });
    expect(run.counts.conformance).toBe(2);
  });

  it("putArtifacts/getArtifacts round-trip the artifact set as one S3 JSON object (AC-90)", async () => {
    const set = { manifest: { manifestVersion: 1, tests: [], skipped: [] }, files: [{ path: "compat/x.ts", contents: "y" }] };
    s3.on(PutObjectCommand).resolves({});
    const key = await repository.putArtifacts("g-1", set);
    expect(key).toBe("test-artifacts/g-1/artifacts.json");
    const put = s3.commandCalls(PutObjectCommand)[0].args[0].input as any;
    expect(JSON.parse(put.Body)).toEqual(set);

    s3.on(GetObjectCommand).resolves({ Body: { transformToString: async () => JSON.stringify(set) } as any });
    expect(await repository.getArtifacts("g-1")).toEqual(set);
  });

  it("getArtifacts returns undefined for a missing object (feeds AC-90 404)", async () => {
    s3.on(GetObjectCommand).rejects(Object.assign(new Error("nope"), { name: "NoSuchKey" }));
    expect(await repository.getArtifacts("missing")).toBeUndefined();
  });
});
